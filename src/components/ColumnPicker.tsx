import { useMemo, useState, type ReactNode } from 'react'
import { GROUPS, passRate, type Column, type Row } from '../columns'

function useGrouped(columns: Column[], q: string) {
  return useMemo(() => {
    const ql = q.trim().toLowerCase()
    const hits = ql ? columns.filter((c) => c.label.toLowerCase().includes(ql)) : columns
    return GROUPS.map((g) => [g, hits.filter((c) => c.group === g)] as const).filter(([, cs]) => cs.length > 0)
  }, [columns, q])
}

function highlight(text: string, q: string): ReactNode {
  const i = q ? text.toLowerCase().indexOf(q.trim().toLowerCase()) : -1
  if (i < 0) return text
  const n = q.trim().length
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + n)}</mark>{text.slice(i + n)}</>
}

export function ColumnSearchList({ columns, onPick }: { columns: Column[]; onPick: (c: Column) => void }) {
  const [q, setQ] = useState('')
  const grouped = useGrouped(columns, q)
  return (
    <div className="col-search">
      <input autoFocus className="col-search-input" placeholder="Search columns & metrics…" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          const first = grouped[0]?.[1][0]
          if (e.key === 'Enter' && first) onPick(first)
        }} />
      <div className="col-list">
        {grouped.map(([g, cs]) => (
          <div key={g}>
            <div className="col-group-title">{g}</div>
            {cs.map((c) => (
              <button key={c.key} className="col-item" onClick={() => onPick(c)}>{highlight(c.label, q)}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

interface Stat {
  /** Short hint shown next to the column name, e.g. "92% · 7✗" or "40% filled". */
  text: string
  fails: number
  empty: boolean
}

// Per-metric hints so it's obvious which metrics are worth showing for the calls loaded.
function useStats(columns: Column[], rows: Row[]) {
  return useMemo(() => {
    const stats = new Map<string, Stat>()
    if (rows.length === 0) return stats
    for (const c of columns) {
      if (c.group === 'Call') continue
      let pass = 0, fail = 0, filled = 0
      for (const r of rows) {
        const v = r.v[c.key]
        if (v == null) continue
        filled++
        if (v === 'pass') pass++
        else if (v === 'fail') fail++
      }
      if (c.kind === 'binary') {
        const n = pass + fail
        stats.set(c.key, { text: n ? `${passRate(pass, fail)}%` : 'all N/A', fails: fail, empty: n === 0 })
      } else {
        const pct = Math.round((filled / rows.length) * 100)
        stats.set(c.key, { text: filled ? `${pct}% filled` : 'empty', fails: 0, empty: filled === 0 })
      }
    }
    return stats
  }, [columns, rows])
}

interface PickerProps {
  columns: Column[]
  visible: string[]
  defaultVisible: string[]
  rows: Row[]
  onChange: (v: string[]) => void
}

export function ColumnPicker({ columns, visible, defaultVisible, rows, onChange }: PickerProps) {
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const grouped = useGrouped(columns, q)
  const stats = useStats(columns, rows)
  const vis = new Set(visible)
  const colMap = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns])

  const toggle = (key: string) => onChange(vis.has(key) ? visible.filter((k) => k !== key) : [...visible, key])
  const setMany = (keys: string[], on: boolean) =>
    onChange(on ? [...visible, ...keys.filter((k) => !vis.has(k))] : visible.filter((k) => !keys.includes(k)))
  const failing = columns.filter((c) => (stats.get(c.key)?.fails ?? 0) > 0 && !vis.has(c.key)).map((c) => c.key)
  const searching = q.trim().length > 0

  return (
    <div className="col-picker">
      <div className="col-picker-left">
        <div className="col-picker-toolbar">
          <input autoFocus className="col-search-input" placeholder="Search columns & metrics…  (Enter toggles first match)" value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              const first = grouped[0]?.[1][0]
              if (e.key === 'Enter' && first) toggle(first.key)
            }} />
        </div>
        {failing.length > 0 && !searching && (
          <button className="col-quick" onClick={() => setMany(failing, true)}>
            + Show the {failing.length} metric{failing.length > 1 ? 's' : ''} with failures in the current calls
          </button>
        )}
        <div className="col-list">
          {grouped.length === 0 && <div className="muted col-empty">No columns match “{q}”.</div>}
          {grouped.map(([g, cs]) => {
            const isCollapsed = collapsed.has(g) && !searching
            const shown = cs.filter((c) => vis.has(c.key)).length
            return (
              <div key={g} className="col-group">
                <div className="col-group-head">
                  <button className="col-group-toggle" onClick={() => {
                    const next = new Set(collapsed)
                    if (next.has(g)) next.delete(g)
                    else next.add(g)
                    setCollapsed(next)
                  }}>
                    <span className="json-caret">{isCollapsed ? '▸' : '▾'}</span>
                    {g}
                    <span className="col-group-count">{shown}/{cs.length}</span>
                  </button>
                  <span className="spacer" />
                  <button className="link" onClick={() => setMany(cs.map((c) => c.key), true)}>Show all</button>
                  <button className="link" onClick={() => setMany(cs.map((c) => c.key), false)}>Hide all</button>
                </div>
                {!isCollapsed && cs.map((c) => {
                  const s = stats.get(c.key)
                  return (
                    <label key={c.key} className={`col-row ${vis.has(c.key) ? 'on' : ''} ${s?.empty ? 'dim' : ''}`}>
                      <input type="checkbox" checked={vis.has(c.key)} onChange={() => toggle(c.key)} />
                      <span className="col-row-label" title={c.label}>{highlight(c.label, q)}</span>
                      {s && (
                        <span className="col-row-stat">
                          {s.text}
                          {s.fails > 0 && <span className="bad"> · {s.fails}✗</span>}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <ShownList visible={visible} defaultVisible={defaultVisible} colMap={colMap} onChange={onChange} />
    </div>
  )
}

function ShownList({ visible, defaultVisible, colMap, onChange }: { visible: string[]; defaultVisible: string[]; colMap: Map<string, Column>; onChange: (v: string[]) => void }) {
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)

  const move = (key: string, to: number) => {
    const next = visible.filter((k) => k !== key)
    next.splice(Math.max(0, Math.min(next.length, to)), 0, key)
    onChange(next)
  }

  return (
    <div className="col-picker-right">
      <div className="col-shown-head">
        <span>Shown <span className="col-group-count">{visible.length}</span></span>
        <span className="spacer" />
        <button className="link" onClick={() => onChange(defaultVisible)}>Reset</button>
        <button className="link" onClick={() => onChange([])}>Clear</button>
      </div>
      <div className="muted small col-shown-hint">Drag to reorder — top of the list is the leftmost column.</div>
      <div className="col-list">
        {visible.length === 0 && <div className="muted col-empty">No columns shown. Tick some on the left.</div>}
        {visible.map((k, i) => (
          <div key={k} draggable
            className={`col-shown ${dragKey === k ? 'dragging' : ''} ${overKey === k && dragKey !== k ? 'drop-target' : ''}`}
            onDragStart={(e) => { setDragKey(k); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => { e.preventDefault(); setOverKey(k) }}
            onDrop={() => { if (dragKey && dragKey !== k) move(dragKey, visible.indexOf(k)); setDragKey(null); setOverKey(null) }}
            onDragEnd={() => { setDragKey(null); setOverKey(null) }}>
            <span className="grip">⠿</span>
            <span className="col-shown-label" title={colMap.get(k)?.label ?? k}>{colMap.get(k)?.label ?? k}</span>
            <span className="col-shown-actions">
              <button title="Move up" disabled={i === 0} onClick={() => move(k, i - 1)}>↑</button>
              <button title="Move down" disabled={i === visible.length - 1} onClick={() => move(k, i + 1)}>↓</button>
              <button title="Hide" onClick={() => onChange(visible.filter((x) => x !== k))}>×</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
