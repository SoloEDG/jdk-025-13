import type { Difficulty, Mode, Board, Proof } from "./types";
export type Command =
  | { type: "cell"; id: number; mark?: boolean }
  | { type: "chord"; id: number }
  | { type: "mode"; mode: Mode }
  | { type: "shield" }
  | { type: "pause"; paused?: boolean }
  | { type: "tick" }
  | { type: "extract" }
  | { type: "new"; difficulty: Difficulty; seed: string; proved: boolean }
  | { type: "prove-progress"; token: number; attempts: number }
  | { type: "prove-done"; token: number; board: Board; proof: Proof }
  | { type: "prove-fail"; token: number; attempts: number }
  | { type: "prove-cancel" }
  | { type: "prove-retry" }
  | { type: "prove-random" };
