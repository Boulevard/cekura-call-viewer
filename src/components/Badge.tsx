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

export function StatusDot({ value, progress }: { value: CellValue; progress?: 'live' | 'evaluating' | null }) {
  if (value == null && progress) {
    return (
      <span className={`status busy ${progress}`} title={progress === 'live' ? 'The call is still going' : 'Waiting for the evaluation; reload to see the result'}>
        <i className="spinner" />{progress === 'live' ? 'In call' : 'Evaluating'}
      </span>
    )
  }
  const cls = value === 'pass' ? 'pass' : value === 'fail' ? 'fail' : 'na'
  return <span className={`status ${cls}`}><i />{value === 'pass' ? 'Passed' : value === 'fail' ? 'Failed' : 'No result'}</span>
}
