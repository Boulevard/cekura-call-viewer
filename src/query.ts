/**
 * Datadog-style query syntax over the same Filter objects the sidebar and chips use, so the query
 * text and the filters are two views of one state:
 *
 *   agent:"AI Receptionist - 11Labs prod"   -success:fail   duration:>60   time:[2026-10-16T09:00 TO 2026-10-16T12:00]
 *   ended_reason:(user_hangup OR agent_hangup)   business_name:*salon*   branch:*   -feedback:*   free text
 */
import { formatDuration, parseDuration, type CellValue, type Column } from './columns'
import type { Filter } from './filters'

// Friendlier names for base columns whose labels don't slug nicely.
const ALIASES: Record<string, string> = {
  call_id: 'call_id',
  timestamp: 'time',
  agent_name: 'agent',
  call_ended_reason: 'ended_reason',
  customer_number: 'customer',
  id: 'cekura_id',
  is_reviewed: 'reviewed',
  dropoff_point: 'dropoff',
  error_message: 'error',
  provider_agent: 'provider_agent',
  branch: 'branch',
  result_name: 'result',
  scenario_name: 'scenario',
  expected_outcome: 'expected_outcome',
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

export interface FieldIndex {
  /** query field name -> column */
  byField: Map<string, Column>
  /** column key -> query field name */
  fieldOf: Map<string, string>
}

export function buildFieldIndex(columns: Column[]): FieldIndex {
  const byField = new Map<string, Column>()
  const fieldOf = new Map<string, string>()
  const add = (c: Column, name: string) => {
    let field = name || c.key
    if (byField.has(field)) field = `${field}_${c.metricId ?? c.key}`
    byField.set(field, c)
    fieldOf.set(c.key, field)
  }
  // Base columns first so they keep the short names when a metric slugs to the same thing.
  for (const c of columns) if (c.metricId == null && c.kind !== 'links') add(c, ALIASES[c.key] ?? slug(c.label))
  for (const c of columns) if (c.metricId != null) add(c, slug(c.label))
  return { byField, fieldOf }
}

// ---- value formatting --------------------------------------------------------------------------

const BARE = /^[^\s:()"[\]\\*]+$/
const RESERVED = /^(or|to|null)$/i

export function quoteValue(v: string): string {
  if (BARE.test(v) && !RESERVED.test(v) && !/^[-<>=]/.test(v)) return v
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Wildcard patterns stay bare (quotes would make `*` literal), so other special chars get escaped. */
const escapePattern = (p: string) => p.replace(/([\s:()"[\]\\])/g, '\\$1')

const nullWord = (col: Column) => (col.key === 'success' ? 'evaluating' : 'na')

function setValueToken(col: Column, v: string | null): string {
  if (col.kind === 'binary') return v ?? nullWord(col)
  return v == null ? 'null' : quoteValue(v)
}

function pad(n: number) { return String(n).padStart(2, '0') }

export function formatRangeValue(col: Column, n: number): string {
  if (col.kind === 'duration') return formatDuration(n)
  if (col.kind === 'date') {
    const d = new Date(n)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return String(Math.round(n * 100) / 100)
}

function parseRangeValue(col: Column, s: string): number | null {
  if (!s) return null
  if (col.kind === 'duration') return s.includes(':') ? parseDuration(s) : Number.isFinite(Number(s)) ? Number(s) : null
  if (col.kind === 'date') {
    const t = Date.parse(s)
    return Number.isNaN(t) ? null : t
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// ---- serialize ----------------------------------------------------------------------------------

export function serializeFilter(f: Filter, col: Column, field: string): string {
  switch (f.type) {
    case 'set': {
      if (f.values.length === 1 && f.values[0] === null && col.kind !== 'binary') return f.exclude ? `${field}:*` : `-${field}:*`
      const vals = f.values.map((v) => setValueToken(col, v))
      const body = vals.length === 1 ? vals[0] : `(${vals.join(' OR ')})`
      return `${f.exclude ? '-' : ''}${field}:${body}`
    }
    case 'range': {
      const lo = f.min != null ? formatRangeValue(col, f.min) : null
      const hi = f.max != null ? formatRangeValue(col, f.max) : null
      if (lo != null && lo === hi && !f.minExcl && !f.maxExcl) return `${field}:${lo}`
      if (lo != null && hi != null && !f.minExcl && !f.maxExcl) return `${field}:[${lo} TO ${hi}]`
      const parts = []
      if (lo != null) parts.push(`${field}:${f.minExcl ? '>' : '>='}${lo}`)
      if (hi != null) parts.push(`${field}:${f.maxExcl ? '<' : '<='}${hi}`)
      return parts.join(' ')
    }
    case 'text': {
      const pattern = f.q.includes('*') ? f.q : `*${f.q}*`
      return `${f.exclude ? '-' : ''}${field}:${escapePattern(pattern)}`
    }
  }
}

export function serializeQuery(filters: Filter[], freeText: string, cols: Map<string, Column>, index: FieldIndex): string {
  const parts: string[] = []
  for (const f of filters) {
    const col = cols.get(f.col)
    const field = index.fieldOf.get(f.col)
    // Filters on columns that aren't in the loaded data can't be named; they still apply.
    if (col && field) parts.push(serializeFilter(f, col, field))
  }
  if (freeText.trim()) parts.push(freeText.trim())
  return parts.join(' ')
}

// ---- tokenize -----------------------------------------------------------------------------------

interface ValueTok {
  text: string
  quoted: boolean
  /** The bare token had an unescaped `*`. */
  wildcard: boolean
  start: number
  end: number
}

export interface Term {
  start: number
  end: number
  neg: boolean
  /** Undefined for free text. */
  field?: string
  /** Index just past the `:`. */
  valueStart?: number
  kind: 'free' | 'single' | 'list' | 'range' | 'compare'
  values: ValueTok[]
  op?: '>' | '>=' | '<' | '<='
  /** List or range missing its closing bracket (still being typed). */
  open?: boolean
}

function readValue(text: string, i: number, stopAt: string): ValueTok {
  const start = i
  if (text[i] === '"') {
    let out = ''
    i++
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\' && i + 1 < text.length) i++
      out += text[i++]
    }
    if (text[i] === '"') i++
    return { text: out, quoted: true, wildcard: false, start, end: i }
  }
  let out = ''
  let wildcard = false
  while (i < text.length && !/\s/.test(text[i]) && !stopAt.includes(text[i])) {
    if (text[i] === '\\' && i + 1 < text.length) { out += text[i + 1]; i += 2; continue }
    if (text[i] === '*') wildcard = true
    out += text[i++]
  }
  return { text: out, quoted: false, wildcard, start, end: i }
}

const skipWs = (text: string, i: number) => { while (i < text.length && /\s/.test(text[i])) i++; return i }

export function tokenize(text: string): Term[] {
  const terms: Term[] = []
  let i = skipWs(text, 0)
  while (i < text.length) {
    const start = i
    let neg = false
    if (text[i] === '-' && i + 1 < text.length && !/\s/.test(text[i + 1])) { neg = true; i++ }
    const m = /^@?([A-Za-z0-9_.]+):/.exec(text.slice(i))
    if (!m) {
      const v = readValue(text, i, '')
      terms.push({ start, end: Math.max(v.end, i + 1), neg, kind: 'free', values: [v] })
      i = skipWs(text, Math.max(v.end, i + 1))
      continue
    }
    const field = m[1].toLowerCase()
    i += m[0].length
    const valueStart = i
    const term: Term = { start, end: i, neg, field, valueStart, kind: 'single', values: [] }
    if (text[i] === '(') {
      term.kind = 'list'
      term.open = true
      i++
      while (i < text.length) {
        i = skipWs(text, i)
        if (text[i] === ')') { term.open = false; i++; break }
        const v = readValue(text, i, ')')
        if (v.end === i) break
        if (!v.quoted && /^or$/i.test(v.text)) { i = v.end; continue }
        term.values.push(v)
        i = v.end
      }
    } else if (text[i] === '[') {
      term.kind = 'range'
      term.open = true
      i++
      while (i < text.length) {
        i = skipWs(text, i)
        if (text[i] === ']') { term.open = false; i++; break }
        const v = readValue(text, i, ']')
        if (v.end === i) break
        if (!(!v.quoted && /^to$/i.test(v.text))) term.values.push(v)
        i = v.end
      }
    } else {
      const op = /^(>=|<=|>|<)/.exec(text.slice(i))?.[1] as Term['op']
      if (op) { term.kind = 'compare'; term.op = op; i += op.length }
      const v = readValue(text, i, '')
      term.values.push(v)
      i = v.end
    }
    term.end = i
    terms.push(term)
    i = skipWs(text, i)
  }
  return terms
}

// ---- parse --------------------------------------------------------------------------------------

export interface QueryIssue {
  start: number
  end: number
  message: string
}

export interface ParsedQuery {
  filters: Filter[]
  freeText: string
  issues: QueryIssue[]
  terms: Term[]
  /** Field terms that turned into filters. */
  applied: Term[]
}

const BINARY_WORDS: Record<string, string | null> = {
  pass: 'pass', passed: 'pass', fail: 'fail', failed: 'fail', na: null, 'n/a': null, none: null, evaluating: null, pending: null,
}

export interface QueryContext {
  index: FieldIndex
  /** Distinct values of a column across the loaded rows (lowercased value -> canonical value). */
  valuesOf: (colKey: string) => Map<string, string | null>
}

function termToFilter(term: Term, col: Column, ctx: QueryContext): Filter | string {
  const vals = term.values
  if (vals.length === 0 || (vals.length === 1 && vals[0].text === '' && !vals[0].quoted)) return 'needs a value'
  const isRange = col.kind === 'number' || col.kind === 'duration' || col.kind === 'date'

  // field:*  /  -field:*   →  has any value / is empty
  if (term.kind === 'single' && !vals[0].quoted && vals[0].text === '*') {
    return { col: col.key, type: 'set', values: [null], exclude: !term.neg }
  }

  if (isRange) {
    if (term.kind === 'compare' || term.kind === 'range' || term.kind === 'single') {
      const nums = vals.map((v) => parseRangeValue(col, v.text))
      if (nums.some((n) => n == null)) return col.kind === 'duration' ? 'expects a duration like 1:30 or 90' : col.kind === 'date' ? 'expects a time like 2026-10-16T09:00' : 'expects a number'
      if (term.kind === 'range') {
        if (term.open || nums.length !== 2) return 'expects [min TO max]'
        return { col: col.key, type: 'range', min: nums[0]!, max: nums[1]! }
      }
      const n = nums[0]!
      if (term.kind === 'single') return { col: col.key, type: 'range', min: n, max: n }
      if (term.op === '>' || term.op === '>=') return { col: col.key, type: 'range', min: n, minExcl: term.op === '>' }
      return { col: col.key, type: 'range', max: n, maxExcl: term.op === '<' }
    }
    if (term.kind === 'list' && col.kind === 'number') {
      if (term.open) return 'list is missing its closing )'
      const nums = vals.map((v) => Number(v.text))
      if (nums.some((n) => !Number.isFinite(n))) return 'expects numbers'
      return { col: col.key, type: 'set', values: nums.map(String), exclude: term.neg }
    }
    return 'use >, <, or [min TO max] for this field'
  }

  if (term.kind === 'compare' || term.kind === 'range') return 'comparisons only work on numbers, durations and times'

  // A bare wildcard is a pattern match on the value.
  if (term.kind === 'single' && vals[0].wildcard) {
    return { col: col.key, type: 'text', q: vals[0].text, exclude: term.neg }
  }

  if (term.kind === 'list' && term.open) return 'list is missing its closing )'
  const known = ctx.valuesOf(col.key)
  const values: (string | null)[] = []
  for (const v of vals) {
    const lower = v.text.toLowerCase()
    if (col.kind === 'binary') {
      if (!(lower in BINARY_WORDS)) return `expects pass, fail or ${nullWord(col)}`
      values.push(BINARY_WORDS[lower])
      continue
    }
    if (!v.quoted && lower === 'null') { values.push(null); continue }
    // Only values that exist are applied, so a half-typed value never empties the table.
    if (!known.has(lower)) return `no rows have "${v.text}"`
    values.push(known.get(lower)!)
  }
  return { col: col.key, type: 'set', values, exclude: term.neg }
}

export function parseQuery(text: string, ctx: QueryContext): ParsedQuery {
  const terms = tokenize(text)
  const issues: QueryIssue[] = []
  const free: string[] = []
  const byCol = new Map<string, Filter>()
  const applied: Term[] = []

  for (const t of terms) {
    if (!t.field) {
      const v = t.values[0]
      if (v.text) free.push(v.quoted ? v.text : (t.neg ? '-' : '') + v.text)
      continue
    }
    const col = ctx.index.byField.get(t.field)
    if (!col) { issues.push({ start: t.start, end: t.end, message: `unknown field "${t.field}"` }); continue }
    const f = termToFilter(t, col, ctx)
    if (typeof f === 'string') { issues.push({ start: t.start, end: t.end, message: `${t.field}: ${f}` }); continue }
    applied.push(t)
    // Two bounds on one field (duration:>30 duration:<120) combine into one range.
    const prev = byCol.get(col.key)
    if (prev?.type === 'range' && f.type === 'range') {
      byCol.set(col.key, {
        ...prev,
        ...(f.min != null ? { min: f.min, minExcl: f.minExcl } : {}),
        ...(f.max != null ? { max: f.max, maxExcl: f.maxExcl } : {}),
      })
    } else {
      byCol.set(col.key, f)
    }
  }
  return { filters: [...byCol.values()], freeText: free.join(' '), issues, terms, applied }
}

/** Values in the loaded rows for one column, keyed by lowercase for case-insensitive matching. */
export function distinctValues(rows: { v: Record<string, CellValue> }[], colKey: string): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const r of rows) {
    const v = r.v[colKey]
    if (v != null) out.set(String(v).toLowerCase(), String(v))
  }
  return out
}

// ---- autocomplete context -----------------------------------------------------------------------

export type CompletionTarget =
  /** Typing a field name (or free text); replace [from, to) with `field:`. */
  | { kind: 'field'; from: number; to: number; partial: string; neg: boolean }
  /** Typing a value for a known field; replace [from, to) with the value. */
  | { kind: 'value'; from: number; to: number; partial: string; col: Column; field: string; inList: boolean; term: Term }

export function completionAt(text: string, caret: number, index: FieldIndex): CompletionTarget | null {
  const terms = tokenize(text)
  const term = terms.find((t) => caret >= t.start && caret <= t.end)
  if (!term) return { kind: 'field', from: caret, to: caret, partial: '', neg: false }

  if (!term.field) {
    const from = term.start + (term.neg ? 1 : 0)
    return { kind: 'field', from, to: term.end, partial: text.slice(from, caret), neg: term.neg }
  }
  const col = index.byField.get(term.field)
  if (!col || term.valueStart == null || caret < term.valueStart) {
    const from = term.start + (term.neg ? 1 : 0)
    return { kind: 'field', from, to: term.valueStart != null ? term.valueStart : term.end, partial: text.slice(from, Math.min(caret, (term.valueStart ?? term.end) - 1)), neg: term.neg }
  }
  // Inside a list, complete the item under the caret; otherwise the whole value.
  const inList = term.kind === 'list'
  const item = term.values.find((v) => caret >= v.start && caret <= v.end)
  let from = item ? item.start : caret
  let to = item ? item.end : caret
  if (!inList && term.kind !== 'list') { from = term.valueStart; to = term.end }
  const raw = text.slice(from, caret)
  const partial = raw.replace(/^"/, '').replace(/\\(.)/g, '$1')
  return { kind: 'value', from, to, partial, col, field: term.field, inList, term }
}

/** Adds filters to a list: one filter per column, with two ranges on a column combined. */
export function mergeFilters(existing: Filter[], added: Filter[]): Filter[] {
  const out = [...existing]
  for (const f of added) {
    const i = out.findIndex((x) => x.col === f.col)
    if (i < 0) { out.push(f); continue }
    const prev = out[i]
    out[i] = prev.type === 'range' && f.type === 'range'
      ? { ...prev, ...(f.min != null ? { min: f.min, minExcl: f.minExcl } : {}), ...(f.max != null ? { max: f.max, maxExcl: f.maxExcl } : {}) }
      : f
  }
  return out
}
