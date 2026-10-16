import type { CellValue, Column, Row } from './columns'

export type Filter =
  | { col: string; type: 'set'; values: (string | null)[]; exclude?: boolean }
  | { col: string; type: 'range'; min?: number; max?: number }
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
      return (f.min == null || v >= f.min) && (f.max == null || v <= f.max)
    }
    case 'text': {
      if (!f.q) return true
      const hit = v != null && String(v).toLowerCase().includes(f.q.toLowerCase())
      return f.exclude ? !hit : hit
    }
  }
}

export function applyFilters(rows: Row[], filters: Filter[], search: string, skipIndex = -1): Row[] {
  const q = search.trim().toLowerCase()
  const active = filters.filter((_, i) => i !== skipIndex)
  if (!q && active.length === 0) return rows
  return rows.filter((r) => (!q || r.search.includes(q)) && active.every((f) => matches(f, r.v[f.col])))
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
      if (f.min != null) return `${label} ≥ ${fmt(f.min)}`
      if (f.max != null) return `${label} ≤ ${fmt(f.max)}`
      return `${label} (any)`
    }
    case 'text':
      return `${label} ${f.exclude ? "doesn't contain" : 'contains'} "${f.q}"`
  }
}
