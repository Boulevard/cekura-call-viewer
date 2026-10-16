import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Column, Row } from '../columns'
import { facetCounts, type Filter } from '../filters'
import {
  buildFieldIndex, completionAt, distinctValues, formatRangeValue, parseQuery, quoteValue, serializeQuery,
  type CompletionTarget, type QueryContext,
} from '../query'

const MAX_SUGGESTIONS = 12
const APPLY_DELAY_MS = 150

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
  onChange: (filters: Filter[], freeText: string) => void
}

export interface QueryBarHandle { focus: () => void }

/**
 * One text box for every filter: the text is generated from the active filters, and editing it
 * rewrites them, so it stays in step with the sidebar, chips and header menus.
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

  const derived = useMemo(() => serializeQuery(p.filters, p.search, p.colMap, index), [p.filters, p.search, p.colMap, index])
  // While the user is editing, their text wins; otherwise the box shows the filters as text.
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState(0)
  const [highlight, setHighlight] = useState(-1)
  const [menuOpen, setMenuOpen] = useState(false)
  const text = draft ?? derived
  const parsed = useMemo(() => parseQuery(text, ctx), [text, ctx])

  // Something else changed the filters (sidebar, chips, a saved view): show that. Only reacts to
  // filter changes, not to blur, so a query with a mistake keeps its text for fixing.
  const focusedRef = useRef(false)
  focusedRef.current = focused
  useEffect(() => { if (!focusedRef.current) setDraft(null) }, [derived])

  const timer = useRef<number | undefined>(undefined)
  const apply = (value: string, now = false) => {
    window.clearTimeout(timer.current)
    const run = () => {
      const q = parseQuery(value, ctx)
      p.onChange(q.filters, q.freeText)
    }
    if (now) run()
    else timer.current = window.setTimeout(run, APPLY_DELAY_MS)
  }

  const target: CompletionTarget | null = focused ? completionAt(text, caret, index) : null
  const targetKey = target ? `${target.kind}|${target.from}|${target.partial}|${target.kind === 'value' ? target.col.key : ''}` : ''
  const suggestions = useMemo(() => (target ? suggest(target, index, p.facetRowsFor) : []), [targetKey, index, p.facetRowsFor])
  // Values are the likely pick, so the first is preselected; field names wait for ↓ or Tab so
  // Enter on plain search text still just searches.
  useEffect(() => { setHighlight(target?.kind === 'value' && suggestions.length ? 0 : -1) }, [targetKey, suggestions.length])

  const replace = (from: number, to: number, insert: string, finish: boolean) => {
    let next = text.slice(0, from) + insert + text.slice(to)
    let pos = from + insert.length
    if (finish && next[pos] !== ' ' && next[pos] !== ')') { next = next.slice(0, pos) + ' ' + next.slice(pos); pos++ }
    else if (finish && next[pos] === ' ') pos++
    setDraft(next)
    setCaret(pos)
    setMenuOpen(true)
    apply(next, finish)
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos))
  }

  const accept = (s: Suggestion) => {
    if (!target) return
    replace(target.from, target.to, s.insert, s.kind === 'value')
  }

  // The term under the caret is still being typed, so "needs a value" there is noise, not an error.
  const shownIssues = parsed.issues.filter((i) => !(focused && caret >= i.start && caret <= i.end && /needs a value|missing its closing/.test(i.message)))
  const showMenu = focused && menuOpen && (suggestions.length > 0 || shownIssues.length > 0)

  return (
    <div className="query-bar">
      <span className="query-icon">⌕</span>
      <input ref={inputRef} className={`query-input ${parsed.issues.length && !focused ? 'has-issues' : ''}`} value={text}
        spellCheck={false} autoComplete="off"
        placeholder='Filter or search, e.g. agent:"AI Receptionist - 11Labs prod" -success:fail duration:>60   ( / )'
        title={parsed.issues.map((i) => i.message).join('\n') || undefined}
        onFocus={(e) => { setFocused(true); setMenuOpen(true); setCaret(e.target.selectionStart ?? text.length) }}
        onBlur={() => {
          setFocused(false)
          setMenuOpen(false)
          apply(text, true)
          // Keep text the user is still fixing; otherwise snap back to the canonical form.
          if (parsed.issues.length === 0) setDraft(null)
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setMenuOpen(true)
          apply(e.target.value)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && showMenu && suggestions.length) { e.preventDefault(); setHighlight((h) => Math.min(suggestions.length - 1, h + 1)) }
          else if (e.key === 'ArrowUp' && showMenu && suggestions.length) { e.preventDefault(); setHighlight((h) => Math.max(-1, h - 1)) }
          else if (e.key === 'Tab' && showMenu && suggestions.length) { e.preventDefault(); accept(suggestions[Math.max(0, highlight)]) }
          else if (e.key === 'Enter') {
            e.preventDefault()
            if (showMenu && highlight >= 0 && suggestions[highlight]) accept(suggestions[highlight])
            else { apply(text, true); setMenuOpen(false) }
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            if (menuOpen) setMenuOpen(false)
            else inputRef.current?.blur()
          }
        }} />
      {text && <button className="query-clear" title="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { setDraft(''); apply('', true) }}>×</button>}
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
            <span><b>Tab</b> complete</span><span><b>↑↓</b> choose</span><span><b>"…"</b> spaces</span><span><b>-</b> exclude</span><span><b>(a OR b)</b></span><span><b>&gt; &lt; [a TO b]</b></span><span><b>*</b> wildcard</span>
          </div>
        </div>
      )}
    </div>
  )
})

function suggest(target: CompletionTarget, index: ReturnType<typeof buildFieldIndex>, facetRowsFor: (col: string) => Row[]): Suggestion[] {
  if (target.kind === 'field') {
    const q = target.partial.toLowerCase()
    const scored: [number, string, Column][] = []
    for (const [field, col] of index.byField) {
      const score = !q ? (col.metricId == null ? 0 : 1) : field.startsWith(q) ? 0 : field.includes(q) ? 1 : col.label.toLowerCase().includes(q) ? 2 : -1
      if (score >= 0) scored.push([score, field, col])
    }
    scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
    // A word that's already a complete field name with no colon yet still offers that field.
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
      hint: `${n.toLocaleString()} rows`,
      kind: 'value' as const,
    }))
  if (!q && !target.inList) out.push({ insert: '*', label: '*', hint: 'has any value', kind: 'value' })
  return out
}
