import type { ViewState } from './filters'
import { load } from './storage'

export type DataSource = 'calls' | 'sims' | 'both'

export interface ViewQuery {
  projectId: number
  range: string
  from: string
  to: string
  agentId: string
  /** Missing on queries saved before simulations were supported; treated as 'calls'. */
  source?: DataSource
}

export interface SavedView {
  id: string
  name: string
  view: ViewState
  /** Present when the view was saved with "include time range & agent"; applying it reloads calls. */
  query?: ViewQuery
  updatedAt: number
}

export function newViewId() {
  return Math.random().toString(36).slice(2, 10)
}

// Earlier versions stored views as { [name]: ViewState }; carry those over so nothing is lost.
export function loadSavedViews(): SavedView[] {
  const current = load<SavedView[] | null>('savedViewsV2', null)
  if (current) return current
  const legacy = load<Record<string, ViewState>>('savedViews', {})
  return Object.entries(legacy).map(([name, view]) => ({ id: newViewId(), name, view, updatedAt: Date.now() }))
}

// Column widths are a cosmetic tweak, so dragging a border doesn't mark the view as modified.
const fingerprint = (v: ViewState) => JSON.stringify([v.visible, v.filters, v.sort])

export function isModified(saved: SavedView, view: ViewState, query: ViewQuery): boolean {
  if (fingerprint(saved.view) !== fingerprint(view)) return true
  if (!saved.query) return false
  const q = saved.query
  return q.projectId !== query.projectId || q.agentId !== query.agentId || q.range !== query.range ||
    (q.source ?? 'calls') !== (query.source ?? 'calls') ||
    (q.range === 'custom' && (q.from !== query.from || q.to !== query.to))
}

export function describeView(v: SavedView): string {
  const parts = [`${v.view.visible.length} columns`]
  if (v.view.filters.length) parts.push(`${v.view.filters.length} filter${v.view.filters.length > 1 ? 's' : ''}`)
  if (v.query) parts.push(v.query.range === 'custom' ? 'custom range' : `last ${v.query.range}`)
  if (v.query?.source && v.query.source !== 'calls') parts.push(v.query.source === 'sims' ? 'simulations' : 'calls + simulations')
  return parts.join(' · ')
}

const VIEWS_ENDPOINT = '/local-api/views'

/** Returns null when there's no file yet, or undefined when the endpoint isn't available (static build). */
export async function fetchViewsFile(): Promise<SavedView[] | null | undefined> {
  try {
    const res = await fetch(VIEWS_ENDPOINT)
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return undefined
    return (await res.json()) as SavedView[] | null
  } catch {
    return undefined
  }
}

export async function writeViewsFile(views: SavedView[]): Promise<boolean> {
  try {
    const res = await fetch(VIEWS_ENDPOINT, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(views) })
    return res.ok
  } catch {
    return false
  }
}
