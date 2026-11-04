import type { ElConversationSummary } from './elevenlabs'
import type { CallLog } from './types'

/**
 * What's been loaded per source, so toggling Calls / Simulations / 11Labs or narrowing the range
 * doesn't refetch everything. Parts are only reused while fresh, so a reused list is never more
 * than a few minutes behind; ↻ and Ctrl+R skip the cache entirely.
 */
export const FRESH_MS = 5 * 60e3

interface Part {
  projectId: number
  /** The window the part holds, in ms. */
  from: number
  to: number
  /** When it was fetched. */
  at: number
  /** Hit the row cap, so it isn't the complete set for its window. */
  truncated: boolean
  /** Distinguishes parts fetched with different settings (e.g. which ElevenLabs agents). */
  key?: string
}

export interface RowsPart extends Part { rows: CallLog[]; total: number }
export interface IdsPart extends Part { ids: Set<string> }
export interface ElPart extends Part { conversations: ElConversationSummary[] }

export interface LoadCache {
  calls?: RowsPart
  sims?: RowsPart
  /** Provider call IDs only, for telling which 11Labs conversations Cekura has when a source isn't shown. */
  callIds?: IdsPart
  simIds?: IdsPart
  el?: ElPart
  /** The project's agents, which only label rows, so they're reused like the rest. */
  agents?: { projectId: number; at: number; value: Promise<import('./api').ProviderAgents> }
}

/**
 * Whether a cached part can serve a window: as is ('hit'), after fetching the earlier stretch it
 * doesn't have (a gap), or not at all.
 */
export function coverage(p: Part | undefined, projectId: number, from: number, to: number, key?: string): 'hit' | 'miss' | { from: number; to: number } {
  if (!p || p.projectId !== projectId || p.key !== key || Date.now() - p.at > FRESH_MS) return 'miss'
  // A part fetched up to "now" still reaches the end of a window that ends now, while it's fresh.
  const reachesEnd = p.to >= to || p.to >= p.at - 60e3
  if (!reachesEnd) return 'miss'
  // A capped part only has the newest rows of its window, so it can't be trimmed or extended.
  if (p.truncated) return p.from === from ? 'hit' : 'miss'
  if (p.from <= from) return 'hit'
  return { from, to: p.from }
}

/** Rows without a usable timestamp are kept rather than silently dropped. */
export const inWindow = (ts: string | number | null | undefined, from: number, to: number) => {
  const t = typeof ts === 'number' ? ts : Date.parse(ts ?? '')
  return Number.isNaN(t) || (t >= from && t <= to)
}

/** Merges a freshly fetched earlier stretch into a part, keeping rows already there. */
export function extendRows(p: RowsPart, gapFrom: number, rows: CallLog[], total: number, truncated: boolean) {
  const have = new Set(p.rows.map((r) => r.uid))
  p.rows = [...p.rows, ...rows.filter((r) => !have.has(r.uid))]
  p.total += total
  p.truncated ||= truncated
  p.from = gapFrom
}
