import { useMemo, useState } from 'react'
import { isSetKind, type Column, type Row } from '../columns'
import { facetCounts, type Filter } from '../filters'
import type { SavedView } from '../views'
import { ColumnSearchList } from './ColumnPicker'
import { Popover } from './Popover'

const TOP_VALUES = 6

interface Props {
  collapsed: boolean
  onToggleCollapsed: () => void
  views: SavedView[]
  activeViewId: string | null
  viewModified: boolean
  onApplyView: (v: SavedView) => void
  onManageViews: () => void
  columns: Column[]
  facetKeys: string[]
  filters: Filter[]
  facetRowsFor: (col: string) => Row[]
  onSetFilter: (col: string, f: Filter | null) => void
  onSetFacetKeys: (keys: string[]) => void
}

export function Sidebar(p: Props) {
  const [adding, setAdding] = useState(false)
  const colMap = useMemo(() => new Map(p.columns.map((c) => [c.key, c])), [p.columns])

  if (p.collapsed) {
    return (
      <aside className="sidebar collapsed">
        <div className="side-collapse"><button title="Show sidebar" onClick={p.onToggleCollapsed}>»</button></div>
      </aside>
    )
  }

  const facetCols = p.facetKeys.map((k) => colMap.get(k)).filter((c): c is Column => !!c)
  const addable = p.columns.filter((c) => isSetKind(c.kind) && !p.facetKeys.includes(c.key))

  return (
    <aside className="sidebar">
      <div className="side-collapse"><button title="Hide sidebar" onClick={p.onToggleCollapsed}>«</button></div>

      <div className="side-sec">
        <span className="side-sec-label">Saved views</span>
        <button title="Save or manage views" onClick={p.onManageViews}>+</button>
      </div>
      {p.views.length === 0 && <div className="side-empty">None yet. Use + to save the current setup.</div>}
      {p.views.map((v) => (
        <button key={v.id} className={`side-view ${v.id === p.activeViewId ? 'on' : ''}`} onClick={() => p.onApplyView(v)} title={v.name}>
          <span className="ellipsis" style={{ flex: 1 }}>{v.name}</span>
          {v.id === p.activeViewId && p.viewModified && <span className="view-dot" title="Unsaved changes" />}
        </button>
      ))}

      {facetCols.map((c) => (
        <FacetSection key={c.key} col={c} rows={p.facetRowsFor(c.key)} filter={p.filters.find((f) => f.col === c.key)}
          onSetFilter={(f) => p.onSetFilter(c.key, f)} onRemove={() => p.onSetFacetKeys(p.facetKeys.filter((k) => k !== c.key))} />
      ))}

      <div className="popover-anchor side-add">
        <button className="link" onClick={() => setAdding(true)}>+ Add filter section</button>
        {adding && (
          <Popover onClose={() => setAdding(false)} className="wide">
            <ColumnSearchList columns={addable} onPick={(c) => { setAdding(false); p.onSetFacetKeys([...p.facetKeys, c.key]) }} />
          </Popover>
        )}
      </div>
    </aside>
  )
}

function valueLabel(col: Column, v: string | null) {
  if (col.kind === 'binary') {
    const isSuccess = col.key === 'success'
    if (v === 'pass') return isSuccess ? 'Passed' : 'Pass'
    if (v === 'fail') return isSuccess ? 'Failed' : 'Fail'
    return isSuccess ? 'Evaluating' : 'N/A'
  }
  return v ?? '(empty)'
}

function FacetSection({ col, rows, filter, onSetFilter, onRemove }: {
  col: Column
  rows: Row[]
  filter: Filter | undefined
  onSetFilter: (f: Filter | null) => void
  onRemove: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const counts = useMemo(() => facetCounts(rows, col.key), [rows, col.key])
  const setFilter = filter?.type === 'set' ? filter : undefined
  const selected = new Set(setFilter?.values ?? [])

  // Selected values stay listed even when the other filters leave them with no rows.
  const values = [...new Set<string | null>([...counts.keys(), ...selected])].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
  const max = Math.max(1, ...counts.values())
  const shown = showAll ? values : values.slice(0, TOP_VALUES).concat(values.slice(TOP_VALUES).filter((v) => selected.has(v)))

  const toggle = (v: string | null) => {
    // Checking a value narrows to it; a non-checkbox filter on this column is replaced.
    const base = setFilter && !setFilter.exclude ? new Set(setFilter.values) : new Set<string | null>()
    if (base.has(v)) base.delete(v)
    else base.add(v)
    onSetFilter(base.size ? { col: col.key, type: 'set', values: [...base] } : null)
  }

  return (
    <div>
      <div className="side-sec">
        <span className="side-sec-label" title={col.label}>{col.label}</span>
        {filter && <button title="Clear" onClick={() => onSetFilter(null)}>⟲</button>}
        <button className="side-x" title="Remove section" onClick={onRemove}>×</button>
      </div>
      {values.length === 0 && <div className="side-empty">No values</div>}
      {shown.map((v) => {
        const n = counts.get(v) ?? 0
        const on = selected.has(v) && !setFilter?.exclude
        const excluded = selected.has(v) && !!setFilter?.exclude
        return (
          <div key={String(v)} className={`facet-item ${on ? 'on' : ''} ${excluded ? 'excluded' : ''} ${n === 0 ? 'zero' : ''}`} onClick={() => toggle(v)}>
            <span className="cb">{on ? '✓' : excluded ? '−' : ''}</span>
            <span className="facet-name" title={valueLabel(col, v)}>{valueLabel(col, v)}</span>
            <span className="facet-n">{n.toLocaleString()}</span>
            <span className="facet-bar"><i style={{ width: `${(n / max) * 100}%` }} /></span>
          </div>
        )
      })}
      {values.length > TOP_VALUES && (
        <button className="facet-more" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${values.length}`}</button>
      )}
    </div>
  )
}
