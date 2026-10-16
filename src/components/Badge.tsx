import type { CellValue } from '../columns'

export function BinaryBadge({ value, naLabel = 'N/A' }: { value: CellValue; naLabel?: string }) {
  if (value === 'pass') return <span className="badge pass">✓ pass</span>
  if (value === 'fail') return <span className="badge fail">✗ fail</span>
  return <span className="badge na">{naLabel}</span>
}

/** Compact table form of a pass/fail metric, so a dozen metric columns stay scannable. */
export function MetricIcon({ value }: { value: CellValue }) {
  if (value === 'pass') return <span className="mi pass" title="pass">✓</span>
  if (value === 'fail') return <span className="mi fail" title="fail">✗</span>
  return <span className="mi na" title="N/A">–</span>
}

export function StatusDot({ value }: { value: CellValue }) {
  const cls = value === 'pass' ? 'pass' : value === 'fail' ? 'fail' : 'na'
  return <span className={`status ${cls}`}><i />{value === 'pass' ? 'Passed' : value === 'fail' ? 'Failed' : 'Evaluating'}</span>
}
