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

/**
 * Searchable multi-select over one column's values, written as an ordinary "is any of" filter, or
 * as "is not" once a value is excluded (everything else stays in, including values that show up
 * after a reload).
 */
function MultiValueFilter({ col, one, many, filters, facetRowsFor, onSetFilter }: BusinessProps & { col: Column | undefined; one: string; many: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const filter = col ? filters.find((f) => f.col === col.key) : undefined
  const listed = filter?.type === 'set' ? filter.values.filter((v): v is string => v != null) : []
  const excludeMode = filter?.type === 'set' && !!filter.exclude && listed.length > 0
  const selected = filter?.type === 'set' && !filter.exclude ? listed : []
  const excluded = excludeMode ? listed : []
  // A pattern from the query bar isn't a plain selection, so it's shown as custom.
  const custom = !!filter && selected.length === 0 && excluded.length === 0

  const options = useMemo(() => {
    if (!col || !open) return []
    const counts = facetCounts(facetRowsFor(col.key), col.key)
    const ql = q.trim().toLowerCase()
    return [...counts.entries()]
      .filter((e): e is [string, number] => e[0] != null && (!ql || e[0].toLowerCase().includes(ql)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_LISTED)
  }, [col, open, q, facetRowsFor])
  // Picked (or excluded) values come first so the current selection is always visible.
  const pinned = excludeMode ? excluded : selected
  const ordered = [...options.filter(([v]) => pinned.includes(v)), ...options.filter(([v]) => !pinned.includes(v))]

  if (!col) return null
  const include = (values: string[]) => onSetFilter(col.key, values.length ? { col: col.key, type: 'set', values } : null)
  const exclude = (values: string[]) => onSetFilter(col.key, values.length ? { col: col.key, type: 'set', values, exclude: true } : null)
  const isOn = (v: string) => (excludeMode ? !excluded.includes(v) : selected.includes(v))
  const toggle = (v: string) => {
    if (excludeMode) exclude(excluded.includes(v) ? excluded.filter((x) => x !== v) : [...excluded, v])
    else include(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  }
  // Excluding replaces a plain selection: it means "everything but these".
  const excludeOne = (v: string) => exclude(excludeMode ? [...new Set([...excluded, v])] : [v])
  // Picked/excluded values stay listed (at the top) even when the search or other filters hide them.
  const shownPinned = pinned.filter((v) => !options.some(([o]) => o === v))

  const cap = `${one[0].toUpperCase()}${one.slice(1)}`
  const label = custom ? `${cap}: custom`
    : excludeMode ? (excluded.length === 1 ? `All but ${excluded[0]}` : `All but ${excluded.length} ${many}`)
      : selected.length === 0 ? `All ${many}` : selected.length === 1 ? selected[0] : `${selected.length} ${many}`
  const title = excludeMode ? `Excluding:\n${excluded.join('\n')}` : selected.join('\n') || `Filter by ${one}`

  return (
    <div className="popover-anchor">
      <button className={`btn quick-btn ${filter ? 'active' : ''}`} onClick={() => setOpen(true)} title={title}>
        <span className="ellipsis">{label}</span><span className="muted">▾</span>
      </button>
      {open && (
        <Popover onClose={() => { setOpen(false); setQ('') }} className="quick-popover">
          <input autoFocus className="quick-search" placeholder={`Search ${many}…`} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && options[0]) { toggle(options[0][0]); setQ('') } }} />
          <div className="quick-list">
            {[...shownPinned.map((v) => [v, 0] as [string, number]), ...ordered].map(([v, n]) => (
              <label key={v} className={`quick-item ${isOn(v) && (excludeMode || selected.length) ? 'on' : ''} ${excluded.includes(v) ? 'excluded' : ''}`}>
                <input type="checkbox" checked={isOn(v)} onChange={() => toggle(v)} />
                <span className="ellipsis" title={v}>{v}</span>
                <button className="link quick-exclude" title={`Show every ${one} except this one`}
                  onClick={(e) => { e.preventDefault(); excludeOne(v) }}>Exclude</button>
                <span className="quick-count">{n ? n.toLocaleString() : ''}</span>
              </label>
            ))}
            {options.length === 0 && shownPinned.length === 0 && <div className="muted quick-empty">No {many} match.</div>}
          </div>
          <div className="quick-footer">
            <span className="muted small">
              {excludeMode ? `Excluding ${excluded.length}` : selected.length ? `${selected.length} selected` : `Showing all ${many}`}
            </span>
            <span className="spacer" />
            {filter && <button className="link" onClick={() => onSetFilter(col.key, null)}>Clear</button>}
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

// ElevenLabs conversation IDs and Retell call IDs; any other run of digits is a result ID, so lists
// pasted from a sheet, Slack or a CSV column all work.
const CALL_ID = /\b(?:conv|call)_[a-z0-9]+/gi

export const pastedCallIds = (values: string[]) => [...new Set(values.join(' ').match(CALL_ID) ?? [])]

export function parseIds(text: string): { results: number[]; calls: string[] } {
  const calls = pastedCallIds([text])
  const results = [...new Set((text.replace(CALL_ID, ' ').match(/\d+/g) ?? []).map(Number))]
  return { results, calls }
}

interface IdsProps {
  filters: Filter[]
  /** IDs present in the loaded data, to point out pasted IDs that don't exist. */
  loadedResultIds: Set<number>
  loadedCallIds: Set<string>
  loading: boolean
  onApply: (ids: { results: number[]; calls: string[] }) => void
}

const short = (id: string) => (id.length > 14 ? `${id.slice(0, 13)}…` : id)

/** Paste result IDs or provider call IDs to show only those. */
export function IdsFilter({ filters, loadedResultIds, loadedCallIds, loading, onApply }: IdsProps) {
  const setValues = (col: string) => {
    const f = filters.find((x) => x.col === col)
    return f?.type === 'set' && !f.exclude ? f.values.filter((v): v is string => v != null) : []
  }
  const activeResults = setValues('result_id').map(Number)
  const activeCalls = pastedCallIds(setValues('call_id'))
  const active = [...activeResults.map(String), ...activeCalls]
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const ids = parseIds(text)
  const count = ids.results.length + ids.calls.length
  // Filters combine with AND, so results and calls together would match nothing.
  const mixed = ids.results.length > 0 && ids.calls.length > 0
  const notFound = loading ? [] : [
    ...activeResults.filter((id) => !loadedResultIds.has(id)).map(String),
    ...activeCalls.filter((id) => !loadedCallIds.has(id)),
  ]
  const apply = () => { if (!mixed) { onApply(ids); setOpen(false) } }

  const label = active.length === 0 ? 'IDs'
    : active.length > 1 ? `${active.length} ${activeCalls.length ? 'calls' : 'results'}`
      : activeCalls.length ? short(activeCalls[0]) : `Result ${activeResults[0]}`
  return (
    <div className="popover-anchor">
      <button className={`btn quick-btn ${active.length ? 'active' : ''}`} title="Show only specific results or calls"
        onClick={() => { setText(active.join('\n')); setOpen(true) }}>
        <span className="ellipsis">{label}</span>
        {notFound.length > 0 && <span className="view-dot" title={`${notFound.length} not found`} />}
        <span className="muted">▾</span>
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="quick-popover">
          <textarea autoFocus className="ids-input" rows={8} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'Paste simulation result IDs, or ElevenLabs conversation / Retell call IDs: one per line, or separated by commas or spaces'}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) apply() }} />
          {mixed && <div className="ids-missing">Paste either result IDs or call IDs, not both.</div>}
          {notFound.length > 0 && (
            <div className="ids-missing">Not found in this project: {notFound.join(', ')}</div>
          )}
          <div className="quick-footer">
            <span className="muted small">
              {count ? [ids.results.length && `${ids.results.length} result${ids.results.length > 1 ? 's' : ''}`, ids.calls.length && `${ids.calls.length} call${ids.calls.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ') : 'No IDs yet'} · ⌘↵ to apply
            </span>
            <span className="spacer" />
            {active.length > 0 && <button className="link" onClick={() => { onApply({ results: [], calls: [] }); setOpen(false) }}>Clear</button>}
            <button className="btn primary" disabled={!count || mixed} onClick={apply}>Show these</button>
          </div>
        </Popover>
      )}
    </div>
  )
}
