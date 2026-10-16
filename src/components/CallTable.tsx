import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BRANCH_PENDING, formatCell, isRangeKind, passRate, type Column, type Row } from '../columns'
import { summarize, type Filter, type SortSpec } from '../filters'
import { cekuraLink, providerLink, type Settings } from '../settings'
import type { DisplayItem } from '../grouping'
import { MetricIcon, StatusDot } from './Badge'
import { CopyIcon, isPhoneNumber } from './CopyIcon'
import { FilterEditor } from './FilterEditor'
import { Popover } from './Popover'

export const ROW_HEIGHT = 38

interface Props {
  columns: Column[]
  /** Every filtered row; header summaries are computed over these. */
  rows: Row[]
  /** What's rendered: rows plus foldable result groups. */
  items: DisplayItem[]
  sort: SortSpec[]
  filters: Filter[]
  widths: Record<string, number>
  selectedId: string | null
  cursorId: string | null
  settings: Settings
  facetRowsFor: (col: string) => Row[]
  onSort: (col: string, additive: boolean) => void
  onSelect: (row: Row) => void
  onToggleGroup: (resultId: number, key: string) => void
  onResize: (col: string, width: number) => void
  onReorder: (from: string, to: string) => void
  onHide: (col: string) => void
  onSetFilter: (col: string, f: Filter | null) => void
}

export function CallTable(p: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: p.items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  const widthOf = (c: Column) => p.widths[c.key] ?? c.width
  const template = p.columns.map((c) => `${widthOf(c)}px`).join(' ')
  const totalWidth = p.columns.reduce((a, c) => a + widthOf(c), 0)

  // Keep the keyboard cursor in view. Page jumps (Ctrl+D/U) scroll by the same distance so the
  // cursor keeps its place on screen, like vim; single steps only scroll when it reaches an edge.
  const cursorIndex = useMemo(() => p.items.findIndex((it) => it.key === p.cursorId), [p.items, p.cursorId])
  const prevCursor = useRef(cursorIndex)
  useEffect(() => {
    const prev = prevCursor.current
    prevCursor.current = cursorIndex
    const el = scrollRef.current
    if (cursorIndex < 0 || !el) return
    // The virtualizer's offset lags a manual scroll, so scrollToIndex here would undo the jump.
    if (prev >= 0 && Math.abs(cursorIndex - prev) > 1) el.scrollTop += (cursorIndex - prev) * ROW_HEIGHT
    else virtualizer.scrollToIndex(cursorIndex, { align: 'auto' })
  }, [cursorIndex, virtualizer])

  return (
    <div className="table-scroll" ref={scrollRef}>
      <div className="table" style={{ width: totalWidth }}>
        <div className="thead" style={{ gridTemplateColumns: template }}>
          {p.columns.map((c) => <HeaderCell key={c.key} col={c} {...p} width={widthOf(c)} />)}
        </div>
        <div className="tbody" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const item = p.items[vi.index]
            if (item.type === 'group') {
              return (
                <GroupRow key={item.key} item={item} columns={p.columns} template={template} cursor={item.key === p.cursorId}
                  top={vi.start} onToggle={() => p.onToggleGroup(item.resultId, item.key)} />
              )
            }
            const row = item.row
            return (
              <div key={row.call.uid}
                className={`tr ${item.inGroup ? 'in-group' : ''} ${row.call.uid === p.selectedId ? 'selected' : ''} ${row.call.uid === p.cursorId ? 'cursor' : ''}`}
                style={{ gridTemplateColumns: template, transform: `translateY(${vi.start}px)` }}
                onClick={(e) => {
                  // Alt-click a cell to filter the table down to that value.
                  const key = (e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col
                  const col = key ? p.columns.find((c) => c.key === key) : undefined
                  if (e.altKey && col && col.kind !== 'links') {
                    const v = row.v[col.key]
                    p.onSetFilter(col.key, isRangeKind(col.kind) && v != null
                      ? { col: col.key, type: 'range', min: v as number, max: v as number }
                      : { col: col.key, type: 'set', values: [v == null ? null : String(v)] })
                    return
                  }
                  p.onSelect(row)
                }}>
                {p.columns.map((c) => <Cell key={c.key} col={c} row={row} settings={p.settings} />)}
              </div>
            )
          })}
        </div>
        {p.items.length === 0 && <div className="empty">No calls match.</div>}
      </div>
    </div>
  )
}

const LABEL_SPAN = 3

function GroupRow({ item, columns, template, cursor, top, onToggle }: {
  item: Extract<DisplayItem, { type: 'group' }>
  columns: Column[]
  template: string
  cursor: boolean
  top: number
  onToggle: () => void
}) {
  const { rows } = item
  const passed = rows.filter((r) => r.call.success === true).length
  const outcomes = rows.map((r) => r.call.sim?.expectedOutcome).filter((s): s is number => s != null)
  const met = outcomes.filter((s) => s >= 100).length
  const first = rows[0].call
  const span = Math.min(LABEL_SPAN, columns.length)

  return (
    <div className={`tr group ${item.expanded ? 'open' : ''} ${cursor ? 'cursor' : ''}`}
      style={{ gridTemplateColumns: template, transform: `translateY(${top}px)` }}
      onClick={onToggle} title={item.expanded ? 'Collapse result' : 'Expand result'}>
      <div className="td group-label" style={{ gridColumn: `span ${span}` }}>
        <span className="json-caret">{item.expanded ? '▾' : '▸'}</span>
        <span className="result-tag">RESULT</span>
        <span className="group-name ellipsis" title={item.name}>{item.name}</span>
        <span className="group-meta">
          {rows.length} run{rows.length > 1 ? 's' : ''}
          <span className={passed === rows.length ? 'good' : 'bad'}> · {passed}/{rows.length} passed</span>
          {outcomes.length > 0 && <span className={met === outcomes.length ? 'good' : 'warn'}> · {met}/{outcomes.length} met</span>}
        </span>
        <a href={cekuraLink(first)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open the result in Cekura">Cekura↗</a>
      </div>
      {columns.slice(span).map((c) => <GroupCell key={c.key} col={c} rows={rows} />)}
    </div>
  )
}

/** Per-column rollup for a result group: pass counts, averages, or the shared value. */
function GroupCell({ col, rows }: { col: Column; rows: Row[] }) {
  if (col.kind === 'links') return <div className="td" />
  const vals = rows.map((r) => r.v[col.key]).filter((v) => v != null)
  if (vals.length === 0) return <div className="td muted">—</div>

  if (col.kind === 'binary') {
    const pass = vals.filter((v) => v === 'pass').length
    const fail = vals.filter((v) => v === 'fail').length
    return (
      <div className="td" title={`${pass} pass · ${fail} fail · ${rows.length - pass - fail} N/A`}>
        <span className={`badge ${fail ? 'fail' : 'pass'}`}>{fail ? `✗ ${fail}` : '✓'} · {pass}/{pass + fail}</span>
      </div>
    )
  }
  if (col.kind === 'number' || col.kind === 'duration') {
    const nums = vals as number[]
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length
    return <div className="td num muted" title="average across runs">avg {formatCell(col, avg)}</div>
  }
  if (col.kind === 'date') {
    return <div className="td muted">{formatCell(col, Math.max(...(vals as number[])))}</div>
  }
  const distinct = [...new Set(vals.map(String))]
  if (distinct.length === 1) return <div className="td" title={distinct[0]}>{distinct[0]}</div>
  return <div className="td muted" title={distinct.join('\n')}>{distinct.length} values</div>
}

function Cell({ col, row, settings }: { col: Column; row: Row; settings: Settings }) {
  if (col.kind === 'links') {
    const prov = providerLink(settings, row.call.call_id)
    return (
      <div className="td links" data-col={col.key} onClick={(e) => e.stopPropagation()}>
        <a href={cekuraLink(row.call)} target="_blank" rel="noreferrer" title={row.call.sim ? 'Open the simulation result in Cekura' : 'Open the call in Cekura'}>Cekura↗</a>
        {prov && <a href={prov.url} target="_blank" rel="noreferrer">{prov.label}↗</a>}
      </div>
    )
  }
  const v = row.v[col.key]
  if (col.key === 'call_id') {
    return (
      <div className={`td mono ${v == null ? 'muted' : ''}`} data-col={col.key} title={v == null ? row.call.error_message || 'No provider call ID' : String(v)}>
        {row.call.source === 'sim' && <span className="sim-tag" title="Simulation run">SIM</span>}
        {/* Cekura leaves this empty when it couldn't match the run to a provider call; say so instead of a bare dash. */}
        {v == null ? <span className="ellipsis no-id">⚠ not linked to a provider call</span> : <><span className="ellipsis">{v}</span><CopyIcon text={String(v)} title="Copy call ID" /></>}
      </div>
    )
  }
  if (col.key === 'provider_agent' || col.key === 'branch') {
    return (
      <div className={`td ${v == null || v === BRANCH_PENDING ? 'muted' : 'mono'}`} data-col={col.key} title={String(v ?? '')}>
        <span className="ellipsis">{v ?? '—'}</span>
        {v != null && v !== BRANCH_PENDING && <CopyIcon text={String(v)} title={col.key === 'branch' ? 'Copy branch ID' : 'Copy agent ID'} />}
      </div>
    )
  }
  if (col.key === 'success') return <div className="td" data-col={col.key}><StatusDot value={v} /></div>
  if (col.kind === 'binary') return <div className="td" data-col={col.key}><MetricIcon value={v} /></div>
  if (col.kind === 'enum' && v != null) {
    // IDs that come in as metric values (business_id) get the same copy affordance as the other IDs.
    const isId = col.label.toLowerCase().endsWith('_id')
    return (
      <div className="td" data-col={col.key} title={String(v)}>
        <span className={`tag ${isId ? 'mono' : ''}`}>{String(v)}</span>
        {isId && <CopyIcon text={String(v)} title={`Copy ${col.label}`} />}
      </div>
    )
  }
  const text = formatCell(col, v)
  if (isPhoneNumber(v)) {
    return (
      <div className="td phone" data-col={col.key} title={text}>
        <span className="ellipsis">{text}</span><CopyIcon text={text} title="Copy phone number" />
      </div>
    )
  }
  return (
    <div className={`td ${col.kind === 'number' || col.kind === 'duration' ? 'num' : ''} ${v == null ? 'muted' : ''}`} data-col={col.key} title={text}>
      {v == null ? '—' : text}
    </div>
  )
}

function HeaderCell({ col, width, rows, sort, filters, facetRowsFor, onSort, onResize, onReorder, onHide, onSetFilter }: Props & { col: Column; width: number }) {
  const [menu, setMenu] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const sortIdx = sort.findIndex((s) => s.col === col.key)
  const sortSpec = sort[sortIdx]
  const filter = filters.find((f) => f.col === col.key)
  const summary = useMemo(() => summarize(rows, col), [rows, col])
  const sortable = col.kind !== 'links'

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const move = (ev: MouseEvent) => onResize(col.key, Math.max(50, width + ev.clientX - startX))
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  return (
    <div className={`th ${dragOver ? 'drag-over' : ''} ${filter ? 'filtered' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { setDragOver(false); const from = e.dataTransfer.getData('text/col'); if (from) onReorder(from, col.key) }}>
      {/* Only the title row is draggable so inputs in the filter popover stay selectable. */}
      <div className="th-top" draggable onDragStart={(e) => e.dataTransfer.setData('text/col', col.key)}>
        <button className="th-label" title={`${col.label}${sortable ? ' — click to sort, shift-click to add sort' : ''}`}
          onClick={(e) => sortable && onSort(col.key, e.shiftKey)}>
          {col.label}
          {sortSpec && <span className="sort-ind">{sortSpec.dir === 'asc' ? '▲' : '▼'}{sort.length > 1 ? sortIdx + 1 : ''}</span>}
        </button>
        <button className={`th-menu ${filter ? 'on' : ''}`} onClick={() => setMenu(true)} title="Filter / options">⋮</button>
      </div>
      {summary && <Summary col={col} s={summary} onFilterFail={() => onSetFilter(col.key, { col: col.key, type: 'set', values: ['fail'] })} />}
      <div className="resizer" onMouseDown={startResize} />
      {menu && (
        <Popover onClose={() => setMenu(false)} align="left">
          <div className="th-menu-actions">
            {sortable && <button onClick={() => { onSort(col.key, false); setMenu(false) }}>Sort</button>}
            <button onClick={() => { onHide(col.key); setMenu(false) }}>Hide column</button>
          </div>
          {sortable && <FilterEditor col={col} filter={filter} facetRows={facetRowsFor(col.key)} onChange={(f) => onSetFilter(col.key, f)} />}
        </Popover>
      )}
    </div>
  )
}

function Summary({ col, s, onFilterFail }: { col: Column; s: NonNullable<ReturnType<typeof summarize>>; onFilterFail: () => void }) {
  if (col.kind === 'binary') {
    const applicable = (s.pass ?? 0) + (s.fail ?? 0)
    if (applicable === 0) return <div className="th-sum muted">all N/A</div>
    const pct = passRate(s.pass ?? 0, s.fail ?? 0)
    const color = pct < 80 ? 'var(--fail)' : pct < 95 ? 'var(--warn)' : 'var(--pass)'
    return (
      <div className="th-sum" title={`${s.pass} pass · ${s.fail} fail · ${s.na} N/A`}>
        <span>{pct}%</span>
        <span className="th-bar"><i style={{ width: `${pct}%`, background: color }} /></span>
        {!!s.fail && <button className="fail-count" onClick={(e) => { e.stopPropagation(); onFilterFail() }} title="Show only failures">{s.fail}✗</button>}
      </div>
    )
  }
  if (s.mean != null) return <div className="th-sum muted" title={`mean ${formatCell(col, s.mean)} · median ${formatCell(col, s.median ?? null)}`}>avg {formatCell(col, s.mean)}</div>
  if (s.distinct != null) return <div className="th-sum muted">{s.distinct} distinct</div>
  return <div className="th-sum" />
}
