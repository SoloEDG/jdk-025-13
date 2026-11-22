import type { Board, Proof } from "../../../shared/types";
import { generateBoard } from "../../terrain/lib/generator";
import { solveBoard, verifyProof, PROOF_BUDGET } from "./solver";

/**
 * 无猜测地图的生成策略：带预算的随机重试。
 *
 * 选择随机重试而非"逐步调整陷阱"的原因：每个候选布局都独立完整求解，
 * 证明始终针对最终交付的整张地图一次性算出，不存在"调整破坏已证明区域"
 * 的问题——证明有效性由构造过程本身维护。每个候选通过 verifyProof 复核
 * 后才会交付。预算耗尽时返回明确的失败结果，由界面决定重试或回退。
 */

export interface SearchHandle {
  cancelled: boolean;
}

/** 每轮重试的候选预算：60 → 240 → 960（实测单候选成功率约 48%–98%） */
export function proofBudget(round: number): number {
  return Math.min(960, 60 * 4 ** Math.max(0, round));
}

function proofSalt(round: number, attempt: number): string {
  return `proof:${round}:${attempt}`;
}

export type SearchResult =
  | { ok: true; board: Board; proof: Proof }
  | { ok: false; attempts: number };

export async function runProofSearch(opts: {
  board: Board;
  first: number;
  round: number;
  handle: SearchHandle;
  onProgress: (attempts: number) => void;
}): Promise<SearchResult> {
  const budget = proofBudget(opts.round);
  for (let attempt = 0; attempt < budget; attempt++) {
    if (opts.handle.cancelled) return { ok: false, attempts: attempt };
    const candidate = generateBoard(
      opts.board,
      opts.first,
      proofSalt(opts.round, attempt),
    );
    const proof = solveBoard(candidate, opts.first, PROOF_BUDGET);
    if (proof && verifyProof(candidate, proof)) {
      proof.attempts = attempt + 1;
      return { ok: true, board: candidate, proof };
    }
    // 时间分片，保持界面可响应、可取消
    if (attempt % 12 === 11) {
      opts.onProgress(attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  opts.onProgress(budget);
  return { ok: false, attempts: budget };
}
