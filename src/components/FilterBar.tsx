import { useState } from 'react'
import { formatCell, type Column, type Row } from '../columns'
import { applyFilters, describeFilter, type Filter } from '../filters'
import { FilterEditor } from './FilterEditor'
import { Popover } from './Popover'
import { ColumnSearchList } from './ColumnPicker'

interface Props {
  columns: Column[]
  colMap: Map<string, Column>
  rows: Row[]
  filters: Filter[]
  search: string
  onSetFilter: (col: string, f: Filter | null) => void
  onClearAll: () => void
}

export function FilterBar({ columns, colMap, rows, filters, search, onSetFilter, onClearAll }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // A filter started from "+ Filter" keeps its popover by the button even after it becomes a chip,
  // so the editor doesn't remount mid-typing.
  const [editingNew, setEditingNew] = useState(false)
  const close = () => { setEditing(null); setEditingNew(false) }

  const facetRowsFor = (colKey: string) =>
    applyFilters(rows, filters, search, filters.findIndex((f) => f.col === colKey))

  return (
    <div className="filter-bar">
      {filters.map((f) => {
        const col = colMap.get(f.col)
        return (
          <div key={f.col} className="chip-wrap">
            <span className={`chip ${col ? '' : 'stale'}`} onClick={() => col && setEditing(f.col)} title={col ? 'Edit filter' : 'Column not present in loaded data'}>
              {describeFilter(f, col, (v) => (col ? formatCell(col, v) : String(v)))}
              <button className="chip-x" onClick={(e) => { e.stopPropagation(); onSetFilter(f.col, null) }}>×</button>
            </span>
            {editing === f.col && !editingNew && col && (
              <Popover onClose={close}>
                <FilterEditor col={col} filter={f} facetRows={facetRowsFor(f.col)} onChange={(nf) => onSetFilter(f.col, nf)} />
              </Popover>
            )}
          </div>
        )
      })}
      <div className="chip-wrap">
        <button className="btn ghost" onClick={() => setAdding(true)}>+ Filter</button>
        {adding && (
          <Popover onClose={() => setAdding(false)} className="wide">
            <ColumnSearchList
              columns={columns.filter((c) => c.kind !== 'links')}
              onPick={(c) => { setAdding(false); setEditing(c.key); setEditingNew(true) }}
            />
          </Popover>
        )}
        {editing && editingNew && colMap.get(editing) && (
          <Popover onClose={close}>
            <FilterEditor col={colMap.get(editing)!} filter={filters.find((f) => f.col === editing)} facetRows={facetRowsFor(editing)} onChange={(nf) => onSetFilter(editing, nf)} />
          </Popover>
        )}
      </div>
      {filters.length > 0 && <button className="link" onClick={onClearAll}>Clear all</button>}
    </div>
  )
}
