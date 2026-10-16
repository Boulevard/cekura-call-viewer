import { SEARCH_SEP, type CellValue, type Column, type Row } from './columns'

export type Filter =
  | { col: string; type: 'set'; values: (string | null)[]; exclude?: boolean }
  | { col: string; type: 'range'; min?: number; max?: number; minExcl?: boolean; maxExcl?: boolean }
  /** `q` is a substring, or a whole-value pattern when it contains `*` (e.g. `conv_*b2f`). */
  | { col: string; type: 'text'; q: string; exclude?: boolean }

export interface SortSpec {
  col: string
  dir: 'asc' | 'desc'
}

export interface ViewState {
  visible: string[]
  filters: Filter[]
  sort: SortSpec[]
  widths: Record<string, number>
}

export function matches(f: Filter, v: CellValue): boolean {
  switch (f.type) {
    case 'set': {
      const hit = f.values.includes(v == null ? null : String(v))
      return f.exclude ? !hit : hit
    }
    case 'range': {
      if (f.min == null && f.max == null) return true
      if (typeof v !== 'number') return false
      const aboveMin = f.min == null || (f.minExcl ? v > f.min : v >= f.min)
      const belowMax = f.max == null || (f.maxExcl ? v < f.max : v <= f.max)
      return aboveMin && belowMax
    }
    case 'text': {
      if (!f.q) return true
      const s = v == null ? null : String(v).toLowerCase()
      const hit = s != null && (f.q.includes('*') ? globRegex(f.q).test(s) : s.includes(f.q.toLowerCase()))
      return f.exclude ? !hit : hit
    }
  }
}

const globCache = new Map<string, RegExp>()

/** Whole-value, case-insensitive match where `*` stands for any run of characters. */
export function globRegex(pattern: string): RegExp {
  let re = globCache.get(pattern)
  if (!re) {
    re = new RegExp(`^${pattern.toLowerCase().split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    globCache.set(pattern, re)
  }
  return re
}

/**
 * Substring match against any column; `*` matches any run of characters within a single column,
 * so `conv_*b2f` or `*salon*tampa*` work as wildcards.
 */
function searchMatcher(search: string): ((haystack: string) => boolean) | null {
  const q = search.trim().toLowerCase()
  if (!q) return null
  if (!q.includes('*')) return (h) => h.includes(q)
  const body = q.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(`[^${SEARCH_SEP}]*`)
  const re = new RegExp(body)
  return (h) => re.test(h)
}

export function applyFilters(rows: Row[], filters: Filter[], search: string, skipIndex = -1): Row[] {
  const match = searchMatcher(search)
  const active = filters.filter((_, i) => i !== skipIndex)
  if (!match && active.length === 0) return rows
  return rows.filter((r) => (!match || match(r.search)) && active.every((f) => matches(f, r.v[f.col])))
}

const BINARY_ORDER: Record<string, number> = { fail: 0, pass: 1 }

function compare(a: CellValue, b: CellValue, col: Column | undefined): number {
  if (col?.kind === 'binary') return (BINARY_ORDER[a as string] ?? 2) - (BINARY_ORDER[b as string] ?? 2)
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function applySort(rows: Row[], sort: SortSpec[], columns: Map<string, Column>): Row[] {
  if (sort.length === 0) return rows
  return [...rows].sort((ra, rb) => {
    for (const s of sort) {
      const a = ra.v[s.col]
      const b = rb.v[s.col]
      // Empty values sink to the bottom in both directions so they never crowd out real data.
      if (a == null && b == null) continue
      if (a == null) return 1
      if (b == null) return -1
      const c = compare(a, b, columns.get(s.col))
      if (c !== 0) return s.dir === 'asc' ? c : -c
    }
    return 0
  })
}

export function facetCounts(rows: Row[], col: string): Map<string | null, number> {
  const counts = new Map<string | null, number>()
  for (const r of rows) {
    const v = r.v[col]
    const k = v == null ? null : String(v)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

export interface ColumnSummary {
  pass?: number
  fail?: number
  na?: number
  mean?: number
  median?: number
  distinct?: number
}

export function summarize(rows: Row[], col: Column): ColumnSummary | null {
  if (col.kind === 'binary') {
    let pass = 0, fail = 0, na = 0
    for (const r of rows) {
      const v = r.v[col.key]
      if (v === 'pass') pass++
      else if (v === 'fail') fail++
      else na++
    }
    return { pass, fail, na }
  }
  if (col.kind === 'number' || col.kind === 'duration') {
    const nums = rows.map((r) => r.v[col.key]).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b)
    if (nums.length === 0) return {}
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length
    return { mean, median: nums[Math.floor(nums.length / 2)] }
  }
  if (col.kind === 'enum' || col.kind === 'category') {
    const s = new Set<CellValue>()
    for (const r of rows) if (r.v[col.key] != null) s.add(r.v[col.key])
    return { distinct: s.size }
  }
  return null
}

export function describeFilter(f: Filter, col: Column | undefined, fmt: (v: number) => string): string {
  const label = col?.label ?? f.col
  switch (f.type) {
    case 'set': {
      const vals = f.values.map((v) => (v == null ? '(empty)' : v))
      const shown = vals.length > 3 ? `${vals.slice(0, 3).join(', ')} +${vals.length - 3}` : vals.join(', ')
      return `${label} ${f.exclude ? 'is not' : 'is'} ${shown || '—'}`
    }
    case 'range': {
      if (f.min != null && f.max != null) return `${label} ${fmt(f.min)} – ${fmt(f.max)}`
      if (f.min != null) return `${label} ${f.minExcl ? '>' : '≥'} ${fmt(f.min)}`
      if (f.max != null) return `${label} ${f.maxExcl ? '<' : '≤'} ${fmt(f.max)}`
      return `${label} (any)`
    }
    case 'text':
      if (f.q.includes('*')) return `${label} ${f.exclude ? "doesn't match" : 'matches'} ${f.q}`
      return `${label} ${f.exclude ? "doesn't contain" : 'contains'} "${f.q}"`
  }
}
