import { useState } from 'react'

/** Strings that hold serialized JSON (tool args/results) are expanded inline so they're readable. */
export function tryParseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return v
  try {
    return JSON.parse(t)
  } catch {
    return v
  }
}

export function JsonView({ value, name, depth = 0, defaultOpen = 1 }: { value: unknown; name?: string; depth?: number; defaultOpen?: number }) {
  const v = tryParseJson(value)
  const [open, setOpen] = useState(depth < defaultOpen)
  const label = name != null && <span className="json-key">{name}: </span>

  if (v === null || typeof v !== 'object') {
    const cls = v === null ? 'json-null' : typeof v === 'string' ? 'json-str' : typeof v === 'number' ? 'json-num' : 'json-bool'
    return <div className="json-line">{label}<span className={cls}>{typeof v === 'string' ? `"${v}"` : String(v)}</span></div>
  }

  const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v)
  const [o, c] = Array.isArray(v) ? ['[', ']'] : ['{', '}']
  if (entries.length === 0) return <div className="json-line">{label}{o}{c}</div>

  return (
    <div className="json-node">
      <div className="json-line json-toggle" onClick={() => setOpen(!open)}>
        <span className="json-caret">{open ? '▾' : '▸'}</span>{label}{o}{!open && <span className="muted"> {entries.length} {Array.isArray(v) ? 'items' : 'keys'} {c}</span>}
      </div>
      {open && (
        <div className="json-children">
          {entries.map(([k, x]) => <JsonView key={k} name={k} value={x} depth={depth + 1} defaultOpen={defaultOpen} />)}
          <div className="json-line">{c}</div>
        </div>
      )}
    </div>
  )
}
