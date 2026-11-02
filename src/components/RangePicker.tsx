import { useState } from 'react'
import { Popover } from './Popover'

export const PRESETS = [
  { key: '1h', title: 'Last hour', ms: 3600e3 },
  { key: '6h', title: 'Last 6 hours', ms: 6 * 3600e3 },
  { key: '24h', title: 'Last 24 hours', ms: 24 * 3600e3 },
  { key: '3d', title: 'Last 3 days', ms: 3 * 86400e3 },
  { key: '7d', title: 'Last 7 days', ms: 7 * 86400e3 },
  { key: '30d', title: 'Last 30 days', ms: 30 * 86400e3 },
]

/** ISO timestamp -> the local `YYYY-MM-DDTHH:mm` a datetime-local input takes. */
const toLocalInput = (iso: string) => new Date(Date.parse(iso) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)

const short = (local: string) => {
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return '?'
  // "Oct 20, 9 AM" rather than "Oct 20, 9:00 AM" when it's on the hour, to keep the button short.
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', ...(d.getMinutes() ? { minute: '2-digit' } : {}) })
}

interface Props {
  range: string
  from: string
  to: string
  /** The range currently loaded, to start a custom range from. */
  current: { from: string; to: string }
  onChange: (r: { range: string; from: string; to: string }) => void
}

/**
 * The time range as one compact button. A custom range used to put two date inputs in the
 * toolbar, which pushed it off narrower screens; they live in the menu now.
 */
export function RangePicker({ range, from, to, current, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ from, to })
  const preset = PRESETS.find((p) => p.key === range)
  const label = preset ? preset.title : `${short(from)} → ${short(to)}`
  const valid = !!draft.from && !!draft.to && Date.parse(draft.from) < Date.parse(draft.to)

  return (
    <div className="popover-anchor">
      <button className="btn quick-btn range-btn" title="Time range"
        onClick={() => { setDraft(from && to ? { from, to } : { from: toLocalInput(current.from), to: toLocalInput(current.to) }); setOpen(true) }}>
        <span className="ellipsis">{label}</span><span className="muted">▾</span>
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="quick-popover range-popover">
          <div className="quick-list">
            {PRESETS.map((p) => (
              <button key={p.key} className={`quick-item range-item ${p.key === range ? 'on' : ''}`}
                onClick={() => { setOpen(false); onChange({ range: p.key, from, to }) }}>
                {p.title}
              </button>
            ))}
          </div>
          <div className="quick-heading">Custom range</div>
          <div className="range-custom">
            <input type="datetime-local" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            <span className="muted">to</span>
            <input type="datetime-local" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </div>
          <div className="quick-footer">
            <span className="muted small">{valid ? 'Up to 33 days' : 'Start has to be before end'}</span>
            <span className="spacer" />
            <button className="btn primary" disabled={!valid} onClick={() => { setOpen(false); onChange({ range: 'custom', ...draft }) }}>Apply</button>
          </div>
        </Popover>
      )}
    </div>
  )
}
