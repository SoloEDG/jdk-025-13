export type Difficulty = "scout" | "scholar" | "legend";
export type Mode = "reveal" | "mark" | "probe" | "flare";
export type Status = "ready" | "active" | "won" | "lost" | "extracted";
export type Mark = "none" | "flag" | "question";
export type RelicId = "sun" | "vessel" | "tablet";
export interface Cell {
  id: number;
  mine: boolean;
  adjacent: number;
  revealed: boolean;
  mark: Mark;
  intel: "unknown" | "safe" | "danger";
  relic: RelicId | null;
  terrain: "moss" | "stone" | "water";
}
export interface Board {
  width: number;
  height: number;
  mines: number;
  seed: string;
  difficulty: Difficulty;
  generated: boolean;
  /** 无猜测模式：地图附带可复核的解题证明 */
  proved: boolean;
  cells: Cell[];
}
export type ProofRule =
  | "protect"
  | "flood"
  | "remaining-zero"
  | "all-danger"
  | "subset"
  | "global-mines"
  | "global-safe"
  | "intel";
export interface ProofReason {
  cell: number;
  rule: ProofRule;
  /** 参与推导的已公开数字格 */
  sources: number[];
  /** 推导所依赖的、此前已证明的危险格 */
  facts: number[];
  text: string;
}
export interface ProofStep {
  id: number;
  kind: "start" | "deduce" | "tool";
  tool: "probe" | "flare" | null;
  result: "safe" | "danger" | null;
  /** 道具步骤执行后的剩余预算 */
  left: { probe: number; flare: number } | null;
  safe: number[];
  danger: number[];
  opened: number[];
  reasons: ProofReason[];
  text: string;
}
export interface Proof {
  version: 1;
  first: number;
  /** 找到该布局前尝试的候选数量 */
  attempts: number;
  budget: { probe: number; flare: number };
  steps: ProofStep[];
}
export interface ActionEntry {
  id: number;
  kind: "reveal" | "mark" | "probe" | "flare" | "hit" | "shield" | "extract";
  cell: number | null;
  message: string;
  second: number;
}
export interface Expedition {
  id: string;
  board: Board;
  status: Status;
  mode: Mode;
  lives: number;
  shield: boolean;
  tools: { probe: number; flare: number; shield: number };
  used: number;
  mistakes: number;
  elapsed: number;
  paused: boolean;
  actions: ActionEntry[];
  nextAction: number;
  selected: number | null;
  startedAt: number;
  /** 已确认地图附带的解题证明（仅无猜测模式） */
  proof: Proof | null;
  /** 进行中的证明搜索任务（瞬态，不持久化） */
  proving: { first: number; token: number; attempts: number } | null;
  /** 搜索预算不足的结果（瞬态，不持久化） */
  proofFailure: { first: number; attempts: number; budget: number } | null;
  /** 重试轮次，决定候选种子与搜索预算 */
  proofRound: number;
}
export interface Report {
  id: string;
  seed: string;
  difficulty: Difficulty;
  outcome: Status;
  safe: number;
  totalSafe: number;
  relics: RelicId[];
  score: number;
  seconds: number;
  used: number;
  mistakes: number;
  /** 是否为附带证明的无猜测探险 */
  proved: boolean;
  endedAt: number;
}
export interface Archive {
  reports: Report[];
  discoveries: Partial<Record<RelicId, number>>;
  totalScore: number;
}
export interface GameDocument {
  version: 1;
  expedition: Expedition;
  archive: Archive;
}
export interface PublicCell {
  id: number;
  revealed: boolean;
  mark: Mark;
  adjacent: number | null;
  intel: Cell["intel"];
  exploded: boolean;
}
export interface PublicBoard {
  width: number;
  height: number;
  mines: number;
  cells: PublicCell[];
}
export interface Deduction {
  cell: number;
  kind: "safe" | "danger";
  reasons: number[];
  text: string;
}
export interface Analysis {
  safe: Deduction[];
  danger: Deduction[];
  conflicts: number[];
  constraints: number;
}
export interface Workspace {
  doc: GameDocument;
  notice: string;
}
