import type { CellValue } from '../columns'

export function BinaryBadge({ value, naLabel = 'N/A' }: { value: CellValue; naLabel?: string }) {
  if (value === 'pass') return <span className="badge pass">✓ pass</span>
  if (value === 'fail') return <span className="badge fail">✗ fail</span>
  return <span className="badge na">{naLabel}</span>
}
