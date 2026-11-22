import { useMemo, useState } from "react";
import {
  ScrollText,
  ShieldCheck,
  Flag,
  Pickaxe,
  ScanLine,
  Flame,
  ChevronDown,
  BadgeCheck,
  TriangleAlert,
} from "lucide-react";
import type { Expedition, ProofStep } from "../../../shared/types";
import { coordinate } from "../../../shared/geometry";
import { verifyProof } from "../lib/solver";

function StepIcon({ step }: { step: ProofStep }) {
  if (step.kind === "start") return <Pickaxe size={13} />;
  if (step.kind === "tool")
    return step.tool === "probe" ? <ScanLine size={13} /> : <Flame size={13} />;
  return step.danger.length && !step.safe.length ? (
    <Flag size={13} />
  ) : (
    <ShieldCheck size={13} />
  );
}

export function ProofPanel({
  expedition: e,
  onLocate,
}: {
  expedition: Expedition;
  onLocate: (id: number) => void;
}) {
  const proof = e.proof;
  const [open, setOpen] = useState<number | null>(null);
  const verified = useMemo(
    () => (proof ? verifyProof(e.board, proof) : false),
    [e.board, proof],
  );
  if (!proof) return null;
  const toolsUsed = proof.steps.filter((s) => s.kind === "tool").length;
  const chip = (id: number) => (
    <button
      key={id}
      className="coord-chip"
      onClick={(ev) => {
        ev.stopPropagation();
        onLocate(id);
      }}
    >
      {coordinate(id, e.board.width)}
    </button>
  );
  return (
    <section className="proof-panel">
      <div className="panel-heading">
        <ScrollText size={15} />
        <h2>无猜测证明</h2>
        <span>PROOF v{proof.version}</span>
      </div>
      <div className={"proof-status " + (verified ? "ok" : "bad")}>
        {verified ? <BadgeCheck size={16} /> : <TriangleAlert size={16} />}
        <p>
          {verified
            ? `已逐步复核：${proof.steps.length} 步推导、${toolsUsed} 次道具，即可凭公开数字找齐全部安全格。`
            : "证明复核未通过，本局仍可游玩，但不计入有证明的探险。"}
        </p>
      </div>
      <div className="proof-meta">
        <span>第 {proof.attempts} 个候选布局</span>
        <span>
          道具预算 探针×{proof.budget.probe} 火把×{proof.budget.flare}
        </span>
      </div>
      <ol className="proof-steps">
        {proof.steps.map((s) => (
          <li key={s.id} className={open === s.id ? "open" : ""}>
            <button
              className="proof-step-head"
              onClick={() => setOpen(open === s.id ? null : s.id)}
              aria-expanded={open === s.id}
            >
              <i className={"step-kind kind-" + s.kind}>
                <StepIcon step={s} />
              </i>
              <span>
                <b>
                  {String(s.id).padStart(2, "0")} · {s.text}
                </b>
              </span>
              <ChevronDown size={12} />
            </button>
            {open === s.id && (
              <div className="proof-step-body">
                {s.reasons.slice(0, 24).map((r, i) => (
                  <p key={r.cell + "-" + i}>
                    {chip(r.cell)}
                    <span>{r.text}</span>
                    {r.facts.length > 0 && (
                      <small>
                        依据已证危险：
                        {r.facts
                          .map((id) => coordinate(id, e.board.width))
                          .join("、")}
                      </small>
                    )}
                  </p>
                ))}
                {s.reasons.length > 24 && (
                  <p>
                    <span>……共 {s.reasons.length} 条结论，规则相同。</span>
                  </p>
                )}
                {s.opened.length > 0 && (
                  <p className="proof-opened">
                    <span>本步揭开 {s.opened.length} 格：</span>
                    <span className="chip-row">
                      {s.opened.slice(0, 12).map(chip)}
                      {s.opened.length > 12 && (
                        <small>等 {s.opened.length} 格</small>
                      )}
                    </span>
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="proof-caution">
        <ShieldCheck size={11} />
        证明只使用公开数字与道具结果，不读取隐藏答案，也不依赖任何旗标。
      </p>
    </section>
  );
}
