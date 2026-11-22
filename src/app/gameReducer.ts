import type { Workspace } from "../shared/types";
import type { Command } from "../shared/commands";
import { isTerminal, emptyArchive, logAction } from "../shared/initial";
import { blankBoard, generateBoard } from "../features/terrain";
import {
  createExpedition,
  mayAct,
  revealCells,
  cycleMark,
  chordCells,
} from "../features/exploration";
import { inspectCell, activateShield } from "../features/tools";
import { settle } from "../features/chronicle";
import { verifyProof } from "../features/proof";
export function initialGame(): Workspace {
  return {
    doc: {
      version: 1,
      expedition: createExpedition(
        blankBoard("scout", "RUIN-025"),
        crypto.randomUUID(),
        Date.now(),
      ),
      archive: emptyArchive(),
    },
    notice: "",
  };
}
export function gameReducer(state: Workspace, c: Command): Workspace {
  let e = state.doc.expedition;
  let archive = state.doc.archive;
  switch (c.type) {
    case "new": {
      const seed = c.seed.trim().slice(0, 40) || "RUIN-025";
      return {
        ...state,
        doc: {
          ...state.doc,
          expedition: createExpedition(
            blankBoard(c.difficulty, seed, c.proved),
            crypto.randomUUID(),
            Date.now(),
          ),
        },
        notice: c.proved
          ? "无猜测探险已就绪，第一步将触发地图推演与证明。"
          : "新的石板地图已准备好，第一步由你决定。",
      };
    }
    case "mode":
      if (mayAct(e)) e = { ...e, mode: c.mode };
      break;
    case "pause":
      if (e.status === "active") e = { ...e, paused: c.paused ?? !e.paused };
      break;
    case "tick":
      if (e.status === "active" && !e.paused)
        e = { ...e, elapsed: e.elapsed + 1 };
      break;
    case "shield":
      e = activateShield(e);
      break;
    case "extract":
      if (e.status === "active" && !e.paused)
        e = logAction(
          { ...e, status: "extracted", mode: "reveal" },
          "extract",
          null,
          "携带本次发现平安撤离，探险已归档。",
        );
      break;
    case "chord":
      e = chordCells(e, c.id);
      break;
    case "prove-progress":
      if (e.proving && e.proving.token === c.token)
        e = { ...e, proving: { ...e.proving, attempts: c.attempts } };
      break;
    case "prove-cancel":
      if (e.proving || e.proofFailure)
        return {
          ...state,
          doc: {
            ...state.doc,
            expedition: { ...e, proving: null, proofFailure: null },
          },
          notice: "已取消推演，地图仍未布雷，可重新选择首步。",
        };
      break;
    case "prove-retry":
      if (e.proofFailure && !e.board.generated)
        e = {
          ...e,
          proofFailure: null,
          proofRound: e.proofRound + 1,
          proving: {
            first: e.proofFailure.first,
            token: (e.proving?.token ?? 0) + 1,
            attempts: 0,
          },
        };
      break;
    case "prove-random": {
      if (!e.proofFailure || e.board.generated) break;
      const first = e.proofFailure.first;
      const board = generateBoard({ ...e.board, proved: false }, first);
      e = revealCells(
        {
          ...e,
          board,
          proof: null,
          proving: null,
          proofFailure: null,
          status: "active",
        },
        [first],
      );
      return {
        ...state,
        doc: { ...state.doc, expedition: e },
        notice: "已改用随机地图，本局不附带无猜测证明。",
      };
    }
    case "prove-fail":
      if (e.proving && e.proving.token === c.token)
        e = {
          ...e,
          proving: null,
          proofFailure: {
            first: e.proving.first,
            attempts: c.attempts,
            budget: c.attempts,
          },
        };
      break;
    case "prove-done": {
      // 令牌校验：取消、改首步或换局之后，旧任务的结果一律作废
      if (!e.proving || e.proving.token !== c.token || e.board.generated)
        break;
      const first = e.proving.first;
      const sameMap =
        c.board.proved &&
        c.board.generated &&
        c.board.seed === e.board.seed &&
        c.board.difficulty === e.board.difficulty &&
        c.board.width === e.board.width &&
        c.board.height === e.board.height &&
        c.board.mines === e.board.mines;
      if (!sameMap || !verifyProof(c.board, c.proof))
        return {
          ...state,
          doc: {
            ...state.doc,
            expedition: { ...e, proving: null },
          },
          notice: "候选地图未通过证明复核，请重新选择首步。",
        };
      e = revealCells(
        {
          ...e,
          board: c.board,
          proof: c.proof,
          proving: null,
          proofFailure: null,
          status: "active",
        },
        [first],
      );
      return {
        ...state,
        doc: { ...state.doc, expedition: e },
        notice: `无猜测地图已确认：第 ${c.proof.attempts} 个候选通过证明，全程可靠数字与道具解开。`,
      };
    }
    case "cell": {
      const cell = e.board.cells[c.id];
      if (!mayAct(e) || !cell) break;
      if (c.mark || e.mode === "mark") {
        e = cycleMark(e, c.id);
        break;
      }
      if (cell.revealed || cell.mark === "flag") break;
      if (e.mode === "probe" || e.mode === "flare") {
        const result = inspectCell(e, c.id, e.mode);
        e = result.reveal.length
          ? revealCells(result.expedition, result.reveal)
          : result.expedition;
        break;
      }
      if (!e.board.generated) {
        if (e.board.proved) {
          // 无猜测模式：首步（或改首步）触发异步推演，令牌随任务递增
          e = {
            ...e,
            proofFailure: null,
            proving: {
              first: c.id,
              token: (e.proving?.token ?? 0) + 1,
              attempts: 0,
            },
          };
          break;
        }
        e = { ...e, status: "active", board: generateBoard(e.board, c.id) };
      }
      e = revealCells(e, [c.id]);
      break;
    }
  }
  if (e === state.doc.expedition) return state;
  if (isTerminal(e.status)) archive = settle(archive, e, Date.now());
  return { ...state, doc: { ...state.doc, expedition: e, archive } };
}
