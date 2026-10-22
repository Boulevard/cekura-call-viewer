import { useMemo, useState } from 'react'
import type { Column, Row } from '../columns'
import { facetCounts, type Filter } from '../filters'
import { Popover } from './Popover'

const MAX_LISTED = 200

/**
 * Toolbar shortcuts for the filters used most. They read and write the same filters as the query
 * bar and sidebar, so a business picked here shows up as a pill and vice versa.
 */

const findMetric = (columns: Column[], name: string) =>
  columns.find((c) => c.metricId != null && c.label.toLowerCase() === name.toLowerCase())

interface BusinessProps {
  columns: Column[]
  filters: Filter[]
  facetRowsFor: (col: string) => Row[]
  onSetFilter: (col: string, f: Filter | null) => void
}

export function BusinessFilter(p: BusinessProps) {
  return <MultiValueFilter {...p} col={findMetric(p.columns, 'Info: Business Name')} one="business" many="businesses" />
}

export function AgentFilter(p: BusinessProps) {
  return <MultiValueFilter {...p} col={p.columns.find((c) => c.key === 'agent_name')} one="agent" many="agents" />
}

/** Searchable multi-select over one column's values, written as an ordinary "is any of" filter. */
function MultiValueFilter({ col, one, many, filters, facetRowsFor, onSetFilter }: BusinessProps & { col: Column | undefined; one: string; many: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const filter = col ? filters.find((f) => f.col === col.key) : undefined
  // A pattern or "is not" filter from the query bar isn't a plain selection, so it's shown as custom.
  const selected = filter?.type === 'set' && !filter.exclude ? filter.values.filter((v): v is string => v != null) : []
  const custom = !!filter && selected.length === 0

  const options = useMemo(() => {
    if (!col || !open) return []
    const counts = facetCounts(facetRowsFor(col.key), col.key)
    const ql = q.trim().toLowerCase()
    return [...counts.entries()]
      .filter((e): e is [string, number] => e[0] != null && (!ql || e[0].toLowerCase().includes(ql)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_LISTED)
  }, [col, open, q, facetRowsFor])
  // Picked values come first so the current selection is always visible.
  const ordered = (sel: string[]) => [...options.filter(([v]) => sel.includes(v)), ...options.filter(([v]) => !sel.includes(v))]

  if (!col) return null
  const set = (values: string[]) => onSetFilter(col.key, values.length ? { col: col.key, type: 'set', values } : null)
  const toggle = (v: string) => set(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  // Selected values stay listed (at the top) even when the search or other filters hide them.
  const shownSelected = selected.filter((v) => !options.some(([o]) => o === v))

  const label = custom ? `${one[0].toUpperCase()}${one.slice(1)}: custom` : selected.length === 0 ? `All ${many}` : selected.length === 1 ? selected[0] : `${selected.length} ${many}`

  return (
    <div className="popover-anchor">
      <button className={`btn quick-btn ${filter ? 'active' : ''}`} onClick={() => setOpen(true)} title={selected.join('\n') || `Filter by ${one}`}>
        <span className="ellipsis">{label}</span><span className="muted">▾</span>
      </button>
      {open && (
        <Popover onClose={() => { setOpen(false); setQ('') }} className="quick-popover">
          <input autoFocus className="quick-search" placeholder={`Search ${many}…`} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && options[0]) { toggle(options[0][0]); setQ('') } }} />
          <div className="quick-list">
            {[...shownSelected.map((v) => [v, 0] as [string, number]), ...ordered(selected)].map(([v, n]) => (
              <label key={v} className={`quick-item ${selected.includes(v) ? 'on' : ''}`}>
                <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} />
                <span className="ellipsis" title={v}>{v}</span>
                <span className="quick-count">{n ? n.toLocaleString() : ''}</span>
              </label>
            ))}
            {options.length === 0 && shownSelected.length === 0 && <div className="muted quick-empty">No {many} match.</div>}
          </div>
          <div className="quick-footer">
            <span className="muted small">{selected.length ? `${selected.length} selected` : `Showing all ${many}`}</span>
            <span className="spacer" />
            {filter && <button className="link" onClick={() => set([])}>Clear</button>}
          </div>
        </Popover>
      )}
    </div>
  )
}

export function QualifiedFilter({ columns, filters, onSetFilter }: Omit<BusinessProps, 'facetRowsFor'>) {
  const col = findMetric(columns, 'Qualified Call')
  if (!col) return null
  const filter = filters.find((f) => f.col === col.key)
  const qualifiedOnly = filter?.type === 'set' && !filter.exclude && filter.values.length === 1 && filter.values[0] === 'pass'
  return (
    <div className="seg quick-seg" title="Qualified Call metric">
      <button className={!filter ? 'on' : ''} onClick={() => onSetFilter(col.key, null)}>All</button>
      <button className={qualifiedOnly ? 'on' : ''} onClick={() => onSetFilter(col.key, { col: col.key, type: 'set', values: ['pass'] })}>Qualified</button>
    </div>
  )
}

/** Any run of digits is an ID, so lists pasted from a sheet, Slack or a CSV column all work. */
export const parseIds = (text: string) => [...new Set((text.match(/\d+/g) ?? []).map(Number))]

interface ResultIdsProps {
  filters: Filter[]
  /** Result IDs present in the loaded data, to point out pasted IDs that don't exist. */
  loadedResultIds: Set<number>
  loading: boolean
  onApply: (ids: number[]) => void
}

export function ResultIdsFilter({ filters, loadedResultIds, loading, onApply }: ResultIdsProps) {
  const filter = filters.find((f) => f.col === 'result_id')
  const active = filter?.type === 'set' && !filter.exclude ? filter.values.filter((v): v is string => v != null).map(Number) : []
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const ids = parseIds(text)
  const notFound = loading ? [] : active.filter((id) => !loadedResultIds.has(id))

  const label = active.length === 0 ? 'Results' : active.length === 1 ? `Result ${active[0]}` : `${active.length} results`
  return (
    <div className="popover-anchor">
      <button className={`btn quick-btn ${active.length ? 'active' : ''}`} title="Show only specific simulation results"
        onClick={() => { setText(active.join('\n')); setOpen(true) }}>
        <span className="ellipsis">{label}</span>
        {notFound.length > 0 && <span className="view-dot" title={`${notFound.length} not found`} />}
        <span className="muted">▾</span>
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="quick-popover">
          <textarea autoFocus className="ids-input" rows={8} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'Paste result IDs: one per line, or separated by commas or spaces'}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { onApply(ids); setOpen(false) } }} />
          {notFound.length > 0 && (
            <div className="ids-missing">Not found in this project: {notFound.join(', ')}</div>
          )}
          <div className="quick-footer">
            <span className="muted small">{ids.length ? `${ids.length} ID${ids.length > 1 ? 's' : ''}` : 'No IDs yet'} · ⌘↵ to apply</span>
            <span className="spacer" />
            {active.length > 0 && <button className="link" onClick={() => { onApply([]); setOpen(false) }}>Clear</button>}
            <button className="btn primary" disabled={!ids.length} onClick={() => { onApply(ids); setOpen(false) }}>Show these results</button>
          </div>
        </Popover>
      )}
    </div>
  )
}
