import type { Board, Proof, ProofReason, ProofStep } from "../../../shared/types";
import { neighbors, coordinate } from "../../../shared/geometry";

/**
 * 无猜测求解器：只使用公开信息（已揭开的数字）、求解器自己证明的
 * 安全/危险集合，以及给定的道具预算。从不读取玩家旗标，也从不把
 * 隐藏答案伪装成推导——道具结果是唯一合法的"神谕"，且计入预算。
 *
 * 同一份 deduce 逻辑同时用于生成证明与复核证明，保证两边强度一致。
 */

export interface SolveState {
  revealed: Uint8Array;
  safe: Uint8Array;
  danger: Uint8Array;
  /** 道具确认过的格子（用于把"探针确认"写进证明，而非伪装成数字推导） */
  intelSafe: Uint8Array;
  intelDanger: Uint8Array;
}

interface Constraint {
  cells: number[];
  remaining: number;
  sources: number[];
  facts: number[];
  derived: boolean;
}

export const PROOF_BUDGET = { probe: 2, flare: 1 } as const;

const MAX_CONSTRAINTS = 4000;
const MAX_STEPS = 400;

function newState(total: number): SolveState {
  return {
    revealed: new Uint8Array(total),
    safe: new Uint8Array(total),
    danger: new Uint8Array(total),
    intelSafe: new Uint8Array(total),
    intelDanger: new Uint8Array(total),
  };
}

function cloneState(s: SolveState): SolveState {
  return {
    revealed: s.revealed.slice(),
    safe: s.safe.slice(),
    danger: s.danger.slice(),
    intelSafe: s.intelSafe.slice(),
    intelDanger: s.intelDanger.slice(),
  };
}

function minesOf(board: Board): Uint8Array {
  const out = new Uint8Array(board.cells.length);
  board.cells.forEach((c, i) => {
    out[i] = c.mine ? 1 : 0;
  });
  return out;
}

function adjacentOf(board: Board): Uint8Array {
  const out = new Uint8Array(board.cells.length);
  board.cells.forEach((c, i) => {
    out[i] = c.adjacent;
  });
  return out;
}

/** 揭开已证明安全的格子；空白（0）按游戏规则连锁展开。返回新揭开的格子。 */
function floodReveal(
  board: Board,
  mine: Uint8Array,
  adj: Uint8Array,
  st: SolveState,
  seeds: number[],
): number[] | null {
  const queue = [...seeds];
  const opened: number[] = [];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.pop()!;
    if (st.revealed[id]) continue;
    if (mine[id]) return null; // 证明绝不能揭开危险格
    st.revealed[id] = 1;
    st.safe[id] = 1;
    opened.push(id);
    if (adj[id] === 0)
      for (const n of neighbors(id, board.width, board.height))
        if (!st.revealed[n] && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
  }
  return opened;
}

interface Conclusion {
  safe: Map<number, ProofReason>;
  danger: Map<number, ProofReason>;
}

function coords(board: Board, ids: number[]): string {
  return ids.map((id) => coordinate(id, board.width)).join("、");
}

/**
 * 一轮推导：由公开数字建立约束，做子集相减闭包，再加上全局计数规则，
 * 得出本轮所有可直接证明的结论。返回 null 表示约束矛盾（地图数据损坏）。
 */
function deduce(board: Board, adj: Uint8Array, st: SolveState): Conclusion | null {
  const total = board.cells.length;
  const constraints = new Map<string, Constraint>();
  for (let c = 0; c < total; c++) {
    if (!st.revealed[c]) continue;
    const around = neighbors(c, board.width, board.height);
    const known: number[] = [];
    const unknown: number[] = [];
    for (const id of around) {
      if (st.danger[id]) known.push(id);
      else if (!st.revealed[id] && !st.safe[id]) unknown.push(id);
    }
    const remaining = adj[c] - known.length;
    if (!unknown.length) continue;
    if (remaining < 0 || remaining > unknown.length) return null;
    const key = unknown.slice().sort((a, b) => a - b).join(",");
    const prev = constraints.get(key);
    if (prev) {
      if (prev.remaining !== remaining) return null;
      prev.sources = [...new Set([...prev.sources, c])];
      prev.facts = [...new Set([...prev.facts, ...known])];
    } else {
      constraints.set(key, {
        cells: unknown.slice().sort((a, b) => a - b),
        remaining,
        sources: [c],
        facts: known,
        derived: false,
      });
    }
  }
  // 子集相减闭包：A ⊆ B 时推出 B\A 的约束
  let list = [...constraints.values()];
  let changed = true;
  let rounds = 0;
  while (changed && rounds++ < 60) {
    changed = false;
    const byKey = new Map(list.map((c) => [c.cells.join(","), c]));
    const added: Constraint[] = [];
    for (let i = 0; i < list.length; i++)
      for (let j = 0; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.cells.length >= b.cells.length) continue;
        if (!a.cells.every((id) => b.cells.includes(id))) continue;
        const cells = b.cells.filter((id) => !a.cells.includes(id));
        const remaining = b.remaining - a.remaining;
        if (remaining < 0 || remaining > cells.length) continue;
        const key = cells.join(",");
        if (!byKey.has(key)) {
          const nc: Constraint = {
            cells,
            remaining,
            sources: [...new Set([...a.sources, ...b.sources])],
            facts: [...new Set([...a.facts, ...b.facts])],
            derived: true,
          };
          byKey.set(key, nc);
          added.push(nc);
          changed = true;
        }
      }
    list = list.concat(added);
    if (list.length > MAX_CONSTRAINTS) break;
  }
  const safe = new Map<number, ProofReason>();
  const danger = new Map<number, ProofReason>();
  const put = (
    map: Map<number, ProofReason>,
    c: Constraint,
    rule: ProofReason["rule"],
    text: (cell: number) => string,
  ) => {
    for (const id of c.cells)
      if (!map.has(id))
        map.set(id, {
          cell: id,
          rule,
          sources: c.sources,
          facts: c.facts,
          text: text(id),
        });
  };
  for (const c of list) {
    if (c.remaining === 0)
      put(safe, c, c.derived ? "subset" : "remaining-zero", () =>
        c.derived
          ? `由 ${coords(board, c.sources)} 的数字约束相减，剩余危险为 0。`
          : `${coords(board, c.sources)} 的剩余危险为 0，周围未知格全部安全。`,
      );
    else if (c.remaining === c.cells.length)
      put(danger, c, c.derived ? "subset" : "all-danger", () =>
        c.derived
          ? `由 ${coords(board, c.sources)} 的数字约束相减，剩余格恰好承载全部危险。`
          : `${coords(board, c.sources)} 的剩余未知格恰好承载全部危险。`,
      );
  }
  // 全局规则：危险已全部确认 ⇒ 其余安全；安全已全部找到 ⇒ 其余危险
  let dangerCount = 0;
  let safeCount = 0;
  for (let i = 0; i < total; i++) {
    if (st.danger[i]) dangerCount++;
    if (st.safe[i]) safeCount++;
  }
  const totalSafe = total - board.mines;
  if (dangerCount === board.mines)
    for (let i = 0; i < total; i++)
      if (!st.revealed[i] && !st.safe[i] && !st.danger[i] && !safe.has(i))
        safe.set(i, {
          cell: i,
          rule: "global-mines",
          sources: [],
          facts: [],
          text: `已确认全部 ${board.mines} 处危险，其余未知格必为安全。`,
        });
  if (safeCount === totalSafe)
    for (let i = 0; i < total; i++)
      if (!st.safe[i] && !st.danger[i] && !danger.has(i))
        danger.set(i, {
          cell: i,
          rule: "global-safe",
          sources: [],
          facts: [],
          text: `已找到全部 ${totalSafe} 块安全石板，其余未知格必为危险。`,
        });
  return { safe, danger };
}

/** 应用一轮结论并揭开新证明的安全格；返回本步新揭开的格子。 */
function apply(
  board: Board,
  mine: Uint8Array,
  adj: Uint8Array,
  st: SolveState,
  concl: Conclusion,
): number[] | null {
  for (const id of concl.danger.keys()) st.danger[id] = 1;
  for (const id of concl.safe.keys()) st.safe[id] = 1;
  const pending: number[] = [];
  for (let i = 0; i < board.cells.length; i++)
    if (st.safe[i] && !st.revealed[i]) pending.push(i);
  return floodReveal(board, mine, adj, st, pending);
}

function revealedCount(st: SolveState): number {
  let n = 0;
  for (const v of st.revealed) n += v;
  return n;
}

function provenCount(st: SolveState): number {
  let n = 0;
  for (let i = 0; i < st.revealed.length; i++) n += st.safe[i] || st.danger[i] ? 1 : 0;
  return n;
}

function solveToFixpoint(
  board: Board,
  mine: Uint8Array,
  adj: Uint8Array,
  st: SolveState,
): boolean {
  for (let guard = 0; guard < MAX_STEPS; guard++) {
    const concl = deduce(board, adj, st);
    if (!concl) return false;
    if (!concl.safe.size && !concl.danger.size) return true;
    if (apply(board, mine, adj, st, concl) === null) return false;
  }
  return false;
}

interface ToolMove {
  cell: number;
  tool: "probe" | "flare";
  result: "safe" | "danger";
}

/** 卡住时选择一次道具使用：在候选格上模拟两种道具，挑解锁进展最多的。 */
function chooseTool(
  board: Board,
  mine: Uint8Array,
  adj: Uint8Array,
  st: SolveState,
  left: { probe: number; flare: number },
): ToolMove | null {
  const total = board.cells.length;
  const frontier: number[] = [];
  const rest: number[] = [];
  for (let i = 0; i < total; i++) {
    if (st.revealed[i] || st.safe[i] || st.danger[i]) continue;
    const near = neighbors(i, board.width, board.height).some((n) => st.revealed[n]);
    (near ? frontier : rest).push(i);
  }
  const candidates = frontier.length ? frontier : rest;
  const base = provenCount(st);
  let best: (ToolMove & { score: number }) | null = null;
  for (const cell of candidates) {
    for (const tool of ["flare", "probe"] as const) {
      if (!left[tool]) continue;
      const sim = cloneState(st);
      const isMine = !!mine[cell];
      if (tool === "flare" && !isMine) {
        sim.intelSafe[cell] = 1;
        if (floodReveal(board, mine, adj, sim, [cell]) === null) continue;
      } else if (isMine) {
        sim.intelDanger[cell] = 1;
        sim.danger[cell] = 1;
      } else {
        sim.intelSafe[cell] = 1;
        sim.safe[cell] = 1;
      }
      if (!solveToFixpoint(board, mine, adj, sim)) continue;
      const gain = provenCount(sim) - base;
      // 确定性 tie-break：先比进展，再比格子编号，火把优先于探针
      const score = gain * 1000 - cell * 2 + (tool === "flare" ? 1 : 0);
      if (!best || score > best.score)
        best = { cell, tool, result: isMine ? "danger" : "safe", score };
    }
  }
  return best;
}

function reasonText(board: Board, r: ProofReason): ProofReason {
  return { ...r, text: r.text || coords(board, r.sources) };
}

/**
 * 尝试为给定地图与首步构造一份完整解题证明。
 * 成功返回 Proof；无法在道具预算内无猜测解开时返回 null。
 */
export function solveBoard(
  board: Board,
  first: number,
  budget: { probe: number; flare: number } = PROOF_BUDGET,
): Proof | null {
  const total = board.cells.length;
  const totalSafe = total - board.mines;
  const mine = minesOf(board);
  const adj = adjacentOf(board);
  if (mine[first]) return null;
  for (const n of neighbors(first, board.width, board.height)) if (mine[n]) return null;
  const st = newState(total);
  const steps: ProofStep[] = [];
  let stepId = 1;

  const opened = floodReveal(board, mine, adj, st, [first]);
  if (!opened) return null;
  steps.push({
    id: stepId++,
    kind: "start",
    tool: null,
    result: null,
    left: null,
    safe: [],
    danger: [],
    opened,
    reasons: opened.map((id) => ({
      cell: id,
      rule: id === first ? "protect" : "flood",
      sources: id === first ? [] : [first],
      facts: [],
      text:
        id === first
          ? "首步保护范围，必为安全。"
          : "首步保护范围内，或由空白（0）连锁展开，必为安全。",
    })),
    text: `首步保护：揭开 ${coordinate(first, board.width)} 等 ${opened.length} 格。`,
  });

  const left = { ...budget };
  for (let guard = 0; guard < MAX_STEPS; guard++) {
    if (revealedCount(st) === totalSafe) break;
    const concl = deduce(board, adj, st);
    if (!concl) return null;
    if (concl.safe.size || concl.danger.size) {
      const newlySafe = [...concl.safe.keys()].filter((id) => !st.safe[id]);
      const newlyDanger = [...concl.danger.keys()].filter((id) => !st.danger[id]);
      const openedNow = apply(board, mine, adj, st, concl);
      if (openedNow === null) return null;
      const reasons: ProofReason[] = [
        ...[...concl.safe.values()],
        ...[...concl.danger.values()],
      ]
        .filter((r) => newlySafe.includes(r.cell) || newlyDanger.includes(r.cell))
        .map((r) => reasonText(board, r));
      for (const id of openedNow)
        if (!concl.safe.has(id))
          reasons.push({
            cell: id,
            rule: st.intelSafe[id] ? "intel" : "flood",
            sources: [],
            facts: [],
            text: st.intelSafe[id]
              ? "道具已确认此格安全，直接探索。"
              : "由空白（0）连锁展开，必为安全。",
          });
      steps.push({
        id: stepId++,
        kind: "deduce",
        tool: null,
        result: null,
        left: null,
        safe: newlySafe,
        danger: newlyDanger,
        opened: openedNow,
        reasons,
        text: `数字推导：${newlySafe.length} 格安全、${newlyDanger.length} 格危险。`,
      });
      continue;
    }
    // 推导停滞：在预算内使用一次道具
    if (!left.probe && !left.flare) return null;
    const move = chooseTool(board, mine, adj, st, left);
    if (!move) return null;
    left[move.tool]--;
    let openedByTool: number[] = [];
    if (move.result === "safe") {
      st.intelSafe[move.cell] = 1;
      st.safe[move.cell] = 1;
      const openedSafe = floodReveal(board, mine, adj, st, [move.cell]);
      if (openedSafe === null) return null;
      openedByTool = openedSafe;
    } else {
      st.intelDanger[move.cell] = 1;
      st.danger[move.cell] = 1;
    }
    steps.push({
      id: stepId++,
      kind: "tool",
      tool: move.tool,
      result: move.result,
      left: { ...left },
      safe: move.result === "safe" ? [move.cell] : [],
      danger: move.result === "danger" ? [move.cell] : [],
      opened: openedByTool,
      reasons: [
        {
          cell: move.cell,
          rule: "intel",
          sources: [],
          facts: [],
          text: `数字推导暂时停滞，投入${move.tool === "probe" ? "勘探探针" : "照明火把"}确认此格。`,
        },
      ],
      text: `${move.tool === "probe" ? "探针" : "火把"} → ${coordinate(move.cell, board.width)}：${move.result === "safe" ? "安全" : "危险"}（余 探针×${left.probe} 火把×${left.flare}）。`,
    });
  }
  if (revealedCount(st) !== totalSafe) return null;
  return {
    version: 1,
    first,
    attempts: 1,
    budget: { ...budget },
    steps,
  };
}

/**
 * 逐步复核一份证明：从首步开始重放，每一步推导都用公开数字重新计算，
 * 每一次道具使用都核对预算与结果真伪。任何"读取隐藏答案伪装成推导"
 * 或依赖玩家旗标的证明都无法通过复核。
 */
export function verifyProof(board: Board, proof: Proof): boolean {
  const total = board.cells.length;
  if (!board.generated || !board.proved) return false;
  if (!proof || proof.version !== 1) return false;
  if (!Number.isInteger(proof.first) || proof.first < 0 || proof.first >= total)
    return false;
  if (
    !Number.isInteger(proof.budget?.probe) ||
    !Number.isInteger(proof.budget?.flare) ||
    proof.budget.probe < 0 ||
    proof.budget.flare < 0 ||
    proof.budget.probe > PROOF_BUDGET.probe ||
    proof.budget.flare > PROOF_BUDGET.flare
  )
    return false;
  // 地图自洽：危险总数与每格数字必须与布雷一致
  const mine = minesOf(board);
  const adj = adjacentOf(board);
  let mineCount = 0;
  for (let i = 0; i < total; i++) {
    mineCount += mine[i];
    const expect = neighbors(i, board.width, board.height).filter(
      (n) => mine[n],
    ).length;
    if (adj[i] !== expect) return false;
  }
  if (mineCount !== board.mines) return false;
  // 首步保护范围不变：首步及周围八格必无危险
  if (mine[proof.first]) return false;
  for (const n of neighbors(proof.first, board.width, board.height))
    if (mine[n]) return false;

  const inBounds = (id: number) => Number.isInteger(id) && id >= 0 && id < total;
  const st = newState(total);
  const left = { ...proof.budget };
  const totalSafe = total - board.mines;
  let stepsChecked = 0;

  for (const step of proof.steps) {
    if (stepsChecked++ > MAX_STEPS) return false;
    if (![...step.safe, ...step.danger, ...step.opened].every(inBounds)) return false;
    if (step.kind === "start") {
      if (step !== proof.steps[0]) return false;
      const expect = floodReveal(board, mine, adj, newState(total), [proof.first]);
      if (!expect) return false;
      if (
        step.opened.length !== expect.length ||
        !step.opened.every((id) => expect.includes(id))
      )
        return false;
      floodReveal(board, mine, adj, st, [proof.first]);
      continue;
    }
    if (step.kind === "deduce") {
      // 用当前公开状态重算可证明结论，证明声明的每格都必须真的可推导
      const concl = deduce(board, adj, st);
      if (!concl) return false;
      for (const id of step.safe)
        if (!st.safe[id] && !concl.safe.has(id)) return false;
      for (const id of step.danger)
        if (!st.danger[id] && !concl.danger.has(id)) return false;
      for (const id of step.safe) st.safe[id] = 1;
      for (const id of step.danger) st.danger[id] = 1;
      // 揭开本步声明揭开的格子：必须全部已证明安全
      for (const id of step.opened) {
        if (!st.safe[id]) return false;
        if (floodReveal(board, mine, adj, st, [id]) === null) return false;
      }
      continue;
    }
    if (step.kind === "tool") {
      if (step.tool !== "probe" && step.tool !== "flare") return false;
      if (left[step.tool] <= 0) return false; // 超出道具预算
      if (st.revealed[step.safe[0] ?? step.danger[0] ?? -1]) return false;
      const cell = (step.safe[0] ?? step.danger[0])!;
      if (!inBounds(cell)) return false;
      const truth = mine[cell] ? "danger" : "safe";
      if (step.result !== truth) return false; // 道具结果必须与地图一致
      left[step.tool]--;
      if (
        !step.left ||
        step.left.probe !== left.probe ||
        step.left.flare !== left.flare
      )
        return false;
      if (truth === "safe") {
        st.intelSafe[cell] = 1;
        st.safe[cell] = 1;
        if (step.tool === "flare" || step.opened.includes(cell)) {
          if (floodReveal(board, mine, adj, st, [cell]) === null) return false;
        }
      } else {
        st.intelDanger[cell] = 1;
        st.danger[cell] = 1;
      }
      continue;
    }
    return false;
  }
  // 终点核验：所有安全格都被证明并揭开，且从未揭开危险格
  if (revealedCount(st) !== totalSafe) return false;
  for (let i = 0; i < total; i++) if (st.revealed[i] && mine[i]) return false;
  return true;
}
