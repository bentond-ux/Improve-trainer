import { evaluateSet } from "../lib/constraints.js";

export default function ConstraintChecklist({ set, metrics }) {
  if (!set) return null;
  const { rules, passed, total } = evaluateSet(set, metrics || {});
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>
          {set.name}{" "}
          <span className={set.personality === "garcia" ? "tag-g" : "tag-z"}>
            → {set.personality}
          </span>
        </b>
        <span style={{ color: passed === total ? "var(--garcia)" : "var(--dim)" }}>
          {passed}/{total}
        </span>
      </div>
      <p className="sub" style={{ margin: "4px 0 10px" }}>{set.desc}</p>
      {rules.map((r) => (
        <div key={r.key + r.label} className="ckrow">
          <span>
            <span className={r.pass ? "ok" : "no"}>{r.pass ? "✓" : "✗"}</span>{" "}
            {r.label}
          </span>
          <span style={{ color: r.pass ? "var(--garcia)" : "var(--dim)" }}>
            {r.value == null ? "—" : Number(r.value).toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}
