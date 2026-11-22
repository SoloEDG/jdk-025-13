import { useEffect, useReducer, useRef, useState } from "react";
import { gameReducer } from "./gameReducer";
import { loadGame, saveGame } from "./storage";
import { runProofSearch } from "../features/proof";
export function useGame() {
  const loaded = useRef<ReturnType<typeof loadGame> | null>(null);
  if (!loaded.current) loaded.current = loadGame();
  const [state, send] = useReducer(gameReducer, loaded.current);
  const [saved, setSaved] = useState(!("recovery" in loaded.current));
  const recovery = useRef("recovery" in loaded.current);
  useEffect(() => {
    if (recovery.current) {
      setSaved(false);
      return;
    }
    setSaved(saveGame(state.doc));
  }, [state.doc]);
  // 无猜测地图的异步推演：令牌绑定当前任务；取消、改首步或换局时
  // 旧任务被标记作废，其结果永远无法覆盖新地图。
  const proving = state.doc.expedition.proving;
  const provingToken = proving?.token;
  useEffect(() => {
    if (!proving) return;
    const handle = { cancelled: false };
    const { board, proofRound } = state.doc.expedition;
    runProofSearch({
      board,
      first: proving.first,
      round: proofRound,
      handle,
      onProgress: (attempts) =>
        send({ type: "prove-progress", token: proving.token, attempts }),
    }).then((result) => {
      if (handle.cancelled) return;
      if (result.ok)
        send({
          type: "prove-done",
          token: proving.token,
          board: result.board,
          proof: result.proof,
        });
      else
        send({
          type: "prove-fail",
          token: proving.token,
          attempts: result.attempts,
        });
    });
    return () => {
      handle.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provingToken]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) send({ type: "tick" });
    }, 1000);
    const hide = () => {
      if (document.hidden) send({ type: "pause", paused: true });
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  return { state, send, saved };
}
