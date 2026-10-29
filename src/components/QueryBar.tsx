import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Column, Row } from '../columns'
import { facetCounts, type Filter } from '../filters'
import {
  buildFieldIndex, completionAt, distinctValues, formatRangeValue, mergeFilters, parseQuery, quoteValue, serializeFilter, tokenize,
  type CompletionTarget, type QueryContext,
} from '../query'

const MAX_SUGGESTIONS = 12
const SEARCH_DELAY_MS = 150

interface Suggestion {
  /** Text inserted in place of the token under the caret. */
  insert: string
  label: string
  hint?: string
  /** Fields keep the dropdown open for their values; values finish the term. */
  kind: 'field' | 'value'
}

interface Props {
  columns: Column[]
  colMap: Map<string, Column>
  rows: Row[]
  filters: Filter[]
  search: string
  facetRowsFor: (col: string) => Row[]
  /** `filters` is null when only the free-text search changed. */
  onChange: (filters: Filter[] | null, freeText: string) => void
  /** Enter with no suggestion picked: the query is done, so keyboard focus moves to the results. */
  onSubmit?: () => void
}

export interface QueryBarHandle { focus: () => void }

/**
 * Datadog-style query box. Every active filter is a pill (so the sidebar, header menus and saved
 * views show up here too, and each pill's × removes it); the text field holds what's being typed.
 * A `field:value` term becomes a pill once it's finished (followed by a space, Enter, Tab or
 * blur) and matches the data; anything else stays as free-text search.
 */
export const QueryBar = forwardRef<QueryBarHandle, Props>(function QueryBar(p, ref) {
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }))

  const index = useMemo(() => buildFieldIndex(p.columns), [p.columns])
  const ctx = useMemo<QueryContext>(() => {
    const cache = new Map<string, Map<string, string | null>>()
    return {
      index,
      valuesOf: (k) => {
        let m = cache.get(k)
        if (!m) cache.set(k, (m = distinctValues(p.rows, k)))
        return m
      },
    }
  }, [index, p.rows])

  const [text, setText] = useState(p.search)
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState(0)
  const [highlight, setHighlight] = useState(-1)
  const [menuOpen, setMenuOpen] = useState(false)
  const parsed = useMemo(() => parseQuery(text, ctx), [text, ctx])
  const placeCaret = (pos: number) => { setCaret(pos); requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos)) }

  const timer = useRef<number | undefined>(undefined)
  const pushSearch = (value: string, now = false) => {
    window.clearTimeout(timer.current)
    const run = () => p.onChange(null, parseQuery(value, ctx).freeText)
    if (now) run()
    else timer.current = window.setTimeout(run, SEARCH_DELAY_MS)
  }

  /** Turns finished, valid field terms into filters (pills) and leaves the rest as text. */
  const commit = (value: string, force: boolean): string => {
    const q = parseQuery(value, ctx)
    const done = q.applied.filter((t) => force || (t.end < value.length && /\s/.test(value[t.end])))
    if (done.length === 0) { pushSearch(value, force); return value }
    let rest = value
    for (const t of [...done].sort((a, b) => b.start - a.start)) rest = rest.slice(0, t.start) + rest.slice(t.end)
    rest = rest.replace(/\s{2,}/g, ' ').replace(/^\s+/, '')
    const added = parseQuery(done.map((t) => value.slice(t.start, t.end)).join(' '), ctx).filters
    window.clearTimeout(timer.current)
    p.onChange(mergeFilters(p.filters, added), parseQuery(rest, ctx).freeText)
    setText(rest)
    return rest
  }

  const pills = p.filters.map((f) => {
    const col = p.colMap.get(f.col)
    const field = index.fieldOf.get(f.col)
    return { f, text: col && field ? serializeFilter(f, col, field) : f.col, stale: !col || !field }
  })

  const removeFilter = (f: Filter) => p.onChange(p.filters.filter((x) => x !== f), parseQuery(text, ctx).freeText)
  /** Moves a pill back into the text field to edit it. */
  const editPill = (i: number) => {
    const pill = pills[i]
    if (!pill || pill.stale) return
    const next = text ? `${pill.text} ${text}` : pill.text
    p.onChange(p.filters.filter((x) => x !== pill.f), parseQuery(text, ctx).freeText)
    setText(next)
    inputRef.current?.focus()
    placeCaret(pill.text.length)
  }

  const target: CompletionTarget | null = focused ? completionAt(text, caret, index) : null
  const targetKey = target ? `${target.kind}|${target.from}|${target.partial}|${target.kind === 'value' ? target.col.key : ''}` : ''
  const suggestions = useMemo(() => (target ? suggest(target, index, p.facetRowsFor) : []), [targetKey, index, p.facetRowsFor])
  // Values are the likely pick, so the first is preselected; field names wait for ↓ or Tab so
  // Enter on plain search text still just searches.
  useEffect(() => { setHighlight(target?.kind === 'value' && suggestions.length ? 0 : -1) }, [targetKey, suggestions.length])

  const accept = (s: Suggestion) => {
    if (!target) return
    let next = text.slice(0, target.from) + s.insert + text.slice(target.to)
    let pos = target.from + s.insert.length
    if (s.kind === 'value' && !(target.kind === 'value' && target.inList)) {
      if (next[pos] !== ' ') next = next.slice(0, pos) + ' ' + next.slice(pos)
      pos++
    }
    setMenuOpen(true)
    const rest = commit(next, false)
    if (rest === next) { setText(next); placeCaret(pos) } else placeCaret(rest.length)
  }

  // The term under the caret is still being typed, so "needs a value" there is noise, not an error.
  const shownIssues = parsed.issues.filter((i) => !(focused && caret >= i.start && caret <= i.end && /needs a value|missing its closing/.test(i.message)))
  const showMenu = focused && menuOpen && (suggestions.length > 0 || shownIssues.length > 0)

  return (
    <div className={`query-bar ${focused ? 'focused' : ''} ${parsed.issues.length && !focused ? 'has-issues' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus() } }}>
      <span className="query-icon">⌕</span>
      {pills.map((pill, i) => (
        <span key={`${pill.f.col}-${i}`} className={`qpill ${pill.stale ? 'stale' : ''}`} title={pill.stale ? 'Column not in the loaded data' : 'Click to edit'}
          onMouseDown={(e) => e.preventDefault()} onClick={() => editPill(i)}>
          <PillText text={pill.text} />
          <button className="qpill-x" title="Remove filter" onClick={(e) => { e.stopPropagation(); removeFilter(pill.f) }}>×</button>
        </span>
      ))}
      <input ref={inputRef} className="query-input" value={text} spellCheck={false} autoComplete="off"
        placeholder={pills.length ? 'Add a filter or search…' : 'Filter or search, e.g. agent:"AI Receptionist - 11Labs prod" -success:fail duration:>60   ( / )'}
        title={parsed.issues.map((i) => i.message).join('\n') || undefined}
        onFocus={(e) => { setFocused(true); setMenuOpen(true); setCaret(e.target.selectionStart ?? text.length) }}
        onBlur={() => { setFocused(false); setMenuOpen(false); commit(text, true) }}
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          setCaret(e.target.selectionStart ?? v.length)
          setMenuOpen(true)
          commit(v, false)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          const el = e.currentTarget
          if (e.key === 'ArrowDown' && showMenu && suggestions.length) { e.preventDefault(); setHighlight((h) => Math.min(suggestions.length - 1, h + 1)) }
          else if (e.key === 'ArrowUp' && showMenu && suggestions.length) { e.preventDefault(); setHighlight((h) => Math.max(-1, h - 1)) }
          else if (e.key === 'Tab' && showMenu && suggestions.length) { e.preventDefault(); accept(suggestions[Math.max(0, highlight)]) }
          else if (e.key === 'Enter') {
            e.preventDefault()
            if (showMenu && highlight >= 0 && suggestions[highlight]) accept(suggestions[highlight])
            else {
              const rest = commit(text, true)
              placeCaret(rest.length)
              setMenuOpen(false)
              if (p.onSubmit) { el.blur(); p.onSubmit() }
            }
          } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0 && pills.length) {
            // Like Datadog: backspacing past the start reopens the last pill for editing.
            e.preventDefault()
            editPill(pills.length - 1)
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            if (menuOpen) setMenuOpen(false)
            else el.blur()
          }
        }} />
      {(text || pills.length > 0) && (
        <button className="query-clear" title="Clear all filters and search" onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setText(''); p.onChange([], '') }}>×</button>
      )}
      {showMenu && (
        <div className="query-menu" onMouseDown={(e) => e.preventDefault()}>
          {suggestions.length > 0 && (
            <div className="query-menu-title">{target?.kind === 'value' ? `${target.col.label} values` : 'Fields'}</div>
          )}
          {suggestions.map((s, i) => (
            <button key={s.insert + i} className={`query-sugg ${i === highlight ? 'on' : ''}`} onMouseEnter={() => setHighlight(i)} onClick={() => accept(s)}>
              <span className={`query-sugg-label ${s.kind === 'field' ? 'mono' : ''}`}>{s.label}</span>
              {s.hint && <span className="query-sugg-hint">{s.hint}</span>}
            </button>
          ))}
          {shownIssues.map((issue, i) => <div key={i} className="query-issue">⚠ {issue.message}</div>)}
          <div className="query-help">
            <span><b>Tab</b> complete</span><span><b>↑↓</b> choose</span><span><b>"…"</b> spaces</span><span><b>-</b> exclude</span><span><b>(a OR b)</b></span><span><b>&gt; &lt; [a TO b]</b></span><span><b>*</b> wildcard</span><span><b>⌫</b> edit last</span>
          </div>
        </div>
      )}
    </div>
  )
})

/** Colors a pill's query text like Datadog: field, colon and value each styled differently. */
function PillText({ text }: { text: string }) {
  const terms = tokenize(text)
  if (terms.length === 0) return <span className="qv">{text}</span>
  return (
    <span className="qpill-text">
      {terms.map((t, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {t.neg && <span className="qneg">-</span>}
          {t.field != null && t.valueStart != null ? (
            <>
              <span className="qf">{text.slice(t.start + (t.neg ? 1 : 0), t.valueStart - 1)}</span>
              <span className="qc">:</span>
              <span className="qv">{text.slice(t.valueStart, t.end)}</span>
            </>
          ) : (
            <span className="qv">{text.slice(t.start + (t.neg ? 1 : 0), t.end)}</span>
          )}
        </span>
      ))}
    </span>
  )
}

function suggest(target: CompletionTarget, index: ReturnType<typeof buildFieldIndex>, facetRowsFor: (col: string) => Row[]): Suggestion[] {
  if (target.kind === 'field') {
    const q = target.partial.toLowerCase()
    const scored: [number, string, Column][] = []
    for (const [field, col] of index.byField) {
      const score = !q ? (col.metricId == null ? 0 : 1) : field.startsWith(q) ? 0 : field.includes(q) ? 1 : col.label.toLowerCase().includes(q) ? 2 : -1
      if (score >= 0) scored.push([score, field, col])
    }
    scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
    return scored.slice(0, MAX_SUGGESTIONS).map(([, field, col]) => ({
      insert: `${field}:`, label: field, hint: col.label === field ? col.group : `${col.label} · ${col.group}`, kind: 'field',
    }))
  }

  const { col, partial } = target
  const q = partial.toLowerCase()
  if (col.kind === 'number' || col.kind === 'duration' || col.kind === 'date') {
    const nums = facetRowsFor(col.key).map((r) => r.v[col.key]).filter((v): v is number => typeof v === 'number')
    if (nums.length === 0) return []
    const lo = formatRangeValue(col, Math.min(...nums))
    const hi = formatRangeValue(col, Math.max(...nums))
    const opts: Suggestion[] = [
      { insert: `[${lo} TO ${hi}]`, label: `[${lo} TO ${hi}]`, hint: 'between (edit the bounds)', kind: 'value' },
      { insert: `>=${lo}`, label: `>=${lo}`, hint: 'at least', kind: 'value' },
      { insert: `<=${hi}`, label: `<=${hi}`, hint: 'at most', kind: 'value' },
      { insert: '*', label: '*', hint: 'has any value', kind: 'value' },
    ]
    return opts.filter((o) => !q || o.label.toLowerCase().startsWith(q))
  }

  const counts = facetCounts(facetRowsFor(col.key), col.key)
  const isSuccess = col.key === 'success'
  const label = (v: string | null) => (col.kind === 'binary' ? (v ?? (isSuccess ? 'evaluating' : 'na')) : v ?? 'null')
  const out: Suggestion[] = [...counts.entries()]
    .map(([v, n]) => ({ v, n, l: label(v) }))
    .filter((x) => !q || x.l.toLowerCase().includes(q))
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ v, n, l }) => ({
      insert: col.kind === 'binary' || v == null ? l : quoteValue(v),
      label: v == null && col.kind !== 'binary' ? '(empty)' : l,
      hint: `${n.toLocaleString()} row${n === 1 ? '' : 's'}`,
      kind: 'value' as const,
    }))
  if (!q && !target.inList) out.push({ insert: '*', label: '*', hint: 'has any value', kind: 'value' })
  return out
}
