import { useMemo, useState } from 'react'
import { formatDuration, isRangeKind, isSetKind, parseDuration, type Column, type Row } from '../columns'
import { facetCounts, type Filter } from '../filters'

interface Props {
  col: Column
  filter: Filter | undefined
  /** Rows filtered by every other active filter, so counts reflect what selecting a value would yield. */
  facetRows: Row[]
  onChange: (f: Filter | null) => void
}

export function FilterEditor({ col, filter, facetRows, onChange }: Props) {
  const canSet = isSetKind(col.kind)
  const canText = col.kind === 'enum' || col.kind === 'text' || col.kind === 'category'
  const initialMode = filter?.type ?? (canSet ? 'set' : isRangeKind(col.kind) ? 'range' : 'text')
  const [mode, setMode] = useState<Filter['type']>(initialMode)

  return (
    <div className="filter-editor">
      <div className="filter-editor-title">{col.label}</div>
      {canSet && canText && (
        <div className="seg">
          <button className={mode === 'set' ? 'on' : ''} onClick={() => setMode('set')}>Values</button>
          <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>Contains</button>
        </div>
      )}
      {mode === 'set' && <SetEditor col={col} filter={filter?.type === 'set' ? filter : undefined} facetRows={facetRows} onChange={onChange} />}
      {mode === 'text' && <TextEditor col={col} filter={filter} onChange={onChange} />}
      {mode === 'range' && <RangeEditor col={col} filter={filter?.type === 'range' ? filter : undefined} facetRows={facetRows} onChange={onChange} />}
      <div className="filter-editor-footer">
        <button className="link" onClick={() => onChange(null)}>Clear filter</button>
      </div>
    </div>
  )
}

function SetEditor({ col, filter, facetRows, onChange }: Props & { filter: Extract<Filter, { type: 'set' }> | undefined }) {
  const [q, setQ] = useState('')
  const counts = useMemo(() => facetCounts(facetRows, col.key), [facetRows, col.key])
  const selected = new Set(filter?.values ?? [])
  const options = useMemo(() => {
    const keys = new Set<string | null>([...counts.keys(), ...(filter?.values ?? [])])
    if (col.kind === 'binary') ['pass', 'fail', null].forEach((k) => keys.add(k))
    return [...keys]
      .filter((k) => !q || (k ?? '(empty)').toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
  }, [counts, filter?.values, q, col.kind])

  const emit = (values: (string | null)[], exclude = filter?.exclude) =>
    onChange(values.length ? { col: col.key, type: 'set', values, exclude } : null)

  const toggle = (k: string | null) => {
    const next = new Set(selected)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    emit([...next])
  }

  const nullLabel = col.kind === 'binary' ? (col.key === 'success' ? '(pending)' : 'N/A') : '(empty)'

  return (
    <>
      <div className="seg small">
        <button className={!filter?.exclude ? 'on' : ''} onClick={() => filter && emit(filter.values, false)}>is any of</button>
        <button className={filter?.exclude ? 'on' : ''} onClick={() => emit(filter?.values ?? [], true)}>is none of</button>
      </div>
      {options.length > 8 && <input autoFocus placeholder="Search values…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="facet-list">
        {options.map((k) => (
          <label key={String(k)} className="facet">
            <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} />
            <span className={`facet-label ${k == null ? 'muted' : ''}`} title={k ?? ''}>{k ?? nullLabel}</span>
            <span className="facet-count">{counts.get(k) ?? 0}</span>
          </label>
        ))}
      </div>
      <div className="row-gap">
        <button className="link" onClick={() => emit(options)}>Select shown</button>
        <button className="link" onClick={() => emit([])}>None</button>
      </div>
    </>
  )
}

function TextEditor({ col, filter, onChange }: Omit<Props, 'facetRows'>) {
  const f = filter?.type === 'text' ? filter : undefined
  const [q, setQ] = useState(f?.q ?? '')
  const emit = (query: string, exclude = f?.exclude) => onChange(query ? { col: col.key, type: 'text', q: query, exclude } : null)
  return (
    <>
      <div className="seg small">
        <button className={!f?.exclude ? 'on' : ''} onClick={() => emit(q, false)}>contains</button>
        <button className={f?.exclude ? 'on' : ''} onClick={() => emit(q, true)}>doesn't contain</button>
      </div>
      <input autoFocus placeholder="Text…" value={q} onChange={(e) => { setQ(e.target.value); emit(e.target.value) }} />
      <div className="row-gap">
        <button className="link" onClick={() => onChange({ col: col.key, type: 'set', values: [null] })}>Is empty</button>
        <button className="link" onClick={() => onChange({ col: col.key, type: 'set', values: [null], exclude: true })}>Is not empty</button>
      </div>
    </>
  )
}

function toLocalInput(ms: number) {
  const d = new Date(ms)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function RangeEditor({ col, filter, facetRows, onChange }: Props & { filter: Extract<Filter, { type: 'range' }> | undefined }) {
  const nums = useMemo(() => facetRows.map((r) => r.v[col.key]).filter((v): v is number => typeof v === 'number'), [facetRows, col.key])
  const lo = nums.length ? Math.min(...nums) : undefined
  const hi = nums.length ? Math.max(...nums) : undefined

  const fmt = (v: number | undefined) => {
    if (v == null) return ''
    if (col.kind === 'date') return toLocalInput(v)
    if (col.kind === 'duration') return formatDuration(v)
    return String(Math.round(v * 100) / 100)
  }
  const parse = (s: string): number | undefined => {
    if (!s.trim()) return undefined
    if (col.kind === 'date') return Date.parse(s)
    if (col.kind === 'duration') return s.includes(':') ? (parseDuration(s) ?? undefined) : Number(s)
    const n = Number(s)
    return Number.isNaN(n) ? undefined : n
  }

  const [minS, setMinS] = useState(fmt(filter?.min))
  const [maxS, setMaxS] = useState(fmt(filter?.max))
  const emit = (a: string, b: string) => {
    const min = parse(a), max = parse(b)
    onChange(min == null && max == null ? null : { col: col.key, type: 'range', min, max })
  }
  const type = col.kind === 'date' ? 'datetime-local' : 'text'

  return (
    <>
      <div className="range-inputs">
        <label>Min<input type={type} autoFocus placeholder={fmt(lo)} value={minS} onChange={(e) => { setMinS(e.target.value); emit(e.target.value, maxS) }} /></label>
        <label>Max<input type={type} placeholder={fmt(hi)} value={maxS} onChange={(e) => { setMaxS(e.target.value); emit(minS, e.target.value) }} /></label>
      </div>
      <div className="muted small">
        {nums.length} values{lo != null && ` · range ${fmt(lo)} – ${fmt(hi)}`}{col.kind === 'duration' && ' · enter m:ss or seconds'}
      </div>
      <div className="row-gap">
        <button className="link" onClick={() => onChange({ col: col.key, type: 'set', values: [null] })}>Is empty</button>
        <button className="link" onClick={() => onChange({ col: col.key, type: 'set', values: [null], exclude: true })}>Has value</button>
      </div>
    </>
  )
}
