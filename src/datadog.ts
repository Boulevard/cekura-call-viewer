import { parseDuration } from './columns'
import type { Settings } from './settings'
import type { CallDetail, CallLog } from './types'

/**
 * Dynamic variables for a call or run. Call logs expose them directly; Retell calls also keep the
 * ones collected during the call; simulation runs only have them inside the provider metadata.
 */
export function callVariables(detail: CallDetail | null): Record<string, unknown> {
  const md = detail?.metadata ?? {}
  return {
    ...md.provider_call_data?.retell_llm_dynamic_variables,
    ...md.conversation_initiation_client_data?.dynamic_variables,
    ...md.collected_dynamic_variables,
    ...(detail?.dynamic_variables ?? {}),
  }
}

/** `urn:blvd:Cart:<uuid>` (or a bare uuid) -> `<uuid>`. */
const bareId = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().replace(/^urn:blvd:[A-Za-z]+:/, '') : null)

function cartId(dv: Record<string, unknown>): string | null {
  const direct = bareId(dv.cart_id) ?? bareId(dv.cartId)
  if (direct) return direct
  try {
    return typeof dv.cart === 'string' ? bareId(JSON.parse(dv.cart).id) : null
  } catch {
    return null
  }
}

/**
 * When the call actually ran. Cekura's timestamp is when it imported the call (a minute or two
 * after it ended), so the provider's own times are preferred.
 */
function callWindow(call: CallLog, detail: CallDetail): { start: number; end: number } {
  const md = detail.metadata ?? {}
  if (typeof md.start_timestamp === 'number' && typeof md.end_timestamp === 'number') return { start: md.start_timestamp, end: md.end_timestamp }
  const el = md.metadata
  if (typeof el?.start_time_unix_secs === 'number') {
    return { start: el.start_time_unix_secs * 1000, end: (el.start_time_unix_secs + (el.call_duration_secs ?? 0)) * 1000 }
  }
  const started = Date.parse(md.call_started_at ?? '')
  const ended = Date.parse(md.call_ended_at ?? '')
  if (!Number.isNaN(started)) return { start: started, end: Number.isNaN(ended) ? started : ended }
  const end = Date.parse(call.timestamp)
  return { start: end - (parseDuration(call.duration) ?? 0) * 1000, end }
}

export interface DatadogLink {
  label: string
  title: string
  url: string
}

/**
 * Boulevard's backend tags AI receptionist logs with the call's cart and location, which identify
 * a call far better than anything else in the logs (the caller's number isn't logged). IDs are
 * unique across environments, so there's no service filter and simulation runs work too.
 */
export function datadogLinks(settings: Settings, call: CallLog, detail: CallDetail | null): DatadogLink[] {
  if (!detail) return []
  const dv = callVariables(detail)
  const cart = cartId(dv)
  const location = bareId(dv.location_id) ?? bareId(dv.ai_receptionist_location_id) ?? bareId(detail.metadata?.metadata?.location_id)
  const { start, end } = callWindow(call, detail)
  const base = settings.datadogUrl.replace(/\/+$/, '')
  const url = (query: string, from: number, to: number) =>
    `${base}/logs?query=${encodeURIComponent(query)}&from_ts=${Math.round(from)}&to_ts=${Math.round(to)}&live=false`

  const links: DatadogLink[] = []
  if (cart) {
    // The evaluation log naming the call lands a few minutes after hang-up, hence the long tail.
    links.push({
      label: 'Datadog: this call',
      title: 'Logs tagged with this call\'s cart, plus the evaluation log for the call ID',
      url: url(`@blvd_metadata.cart_id:${cart} OR "${call.call_id}"`, start - 60_000, end + 10 * 60_000),
    })
  }
  if (location) {
    links.push({
      label: 'Datadog: location during call',
      title: 'Everything logged for this location while the call ran (includes unrelated activity)',
      url: url(`@blvd_metadata.location_id:${location}`, start - 30_000, end + 60_000),
    })
  }
  return links
}
