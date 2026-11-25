import type { PaymentStage } from '../../shared/types';

/** Edit payment stages; "Reset" goes back to the standard terms. */
export function PaymentScheduleEditor({ value, standard, onChange }: {
  value: PaymentStage[] | null | undefined;
  standard: PaymentStage[];
  onChange: (v: PaymentStage[] | null) => void;
}) {
  const stages = value?.length ? value : standard;
  const total = stages.reduce((t, s) => t + (s.pct || 0), 0);
  const set = (next: PaymentStage[]) => onChange(next);
  return (
    <div className="schedule">
      {stages.map((s, i) => (
        <div className="stage" key={i}>
          <input type="number" min={0} max={100} value={s.pct} aria-label="Percentage"
            onChange={(e) => set(stages.map((x, j) => (j === i ? { ...x, pct: +e.target.value } : x)))} />
          <span className="unit">%</span>
          <input value={s.label} aria-label="When it is paid"
            onChange={(e) => set(stages.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <button type="button" className="link danger" aria-label="Remove stage" onClick={() => set(stages.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="schedule-foot">
        <button type="button" className="link" onClick={() => set([...stages, { pct: Math.max(0, 100 - total), label: '' }])}>+ Add stage</button>
        {value?.length ? <button type="button" className="link" onClick={() => onChange(null)}>Reset to standard terms</button> : <span className="muted small">Standard terms</span>}
        <span className={`small ${Math.abs(total - 100) > 0.01 ? 'bad' : 'muted'}`}>Total {total}%</span>
      </div>
    </div>
  );
}
