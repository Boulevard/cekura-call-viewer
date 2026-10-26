/**
 * ElevenLabs conversations, for calls Cekura never imported (mostly manual calls to dev branches)
 * and for showing the raw 11Labs record next to Cekura's. Requests go through the dev server's
 * /elevenlabs proxy, which adds ELEVENLABS_API_KEY.
 */
import type { CallDetail, CallLog, CallMetric, EvaluationMetric } from './types'

const BASE = '/elevenlabs/v1/convai'
const PAGE_SIZE = 100

async function elGet<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const res = await fetch(`${BASE}${path}${qs.size ? `?${qs}` : ''}`, { headers: { Accept: 'application/json' }, signal })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = JSON.stringify((await res.json()).detail ?? '') || msg } catch { /* not JSON */ }
    throw new Error(res.status === 401 ? 'ElevenLabs rejected the API key (set ELEVENLABS_API_KEY in .env.local)' : `ElevenLabs ${res.status}: ${msg}`)
  }
  return res.json() as Promise<T>
}

/** One row of ElevenLabs' conversation list. */
export interface ElConversationSummary {
  conversation_id: string
  agent_id: string
  agent_name: string
  branch_id?: string | null
  start_time_unix_secs: number
  call_duration_secs: number
  message_count: number
  status: string
  termination_reason?: string
  call_successful?: 'success' | 'failure' | 'unknown'
  call_summary_title?: string | null
  conversation_initiation_source?: string
  direction?: string
}

export async function listConversations(
  agentIds: string[],
  from: number,
  to: number,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<ElConversationSummary[]> {
  const all: ElConversationSummary[] = []
  await Promise.all(agentIds.map(async (agentId) => {
    let cursor: string | undefined
    do {
      const page = await elGet<{ conversations: ElConversationSummary[]; next_cursor?: string; has_more: boolean }>('/conversations', {
        agent_id: agentId,
        page_size: PAGE_SIZE,
        call_start_after_unix: Math.floor(from / 1000),
        call_start_before_unix: Math.ceil(to / 1000),
        cursor,
      }, signal)
      all.push(...page.conversations)
      onProgress(all.length)
      cursor = page.has_more ? page.next_cursor : undefined
    } while (cursor)
  }))
  return all
}

const pad = (n: number) => String(n).padStart(2, '0')
const duration = (secs: number) => `${pad(Math.floor(secs / 60))}:${pad(Math.round(secs % 60))}`

export function conversationToCallLog(c: ElConversationSummary, projectId: number, agent?: { id: number; name: string }): CallLog {
  return {
    uid: `el:${c.conversation_id}`,
    source: 'el',
    // No Cekura ID exists for these; 0 keeps the type simple and the UI hides Cekura-only bits.
    id: 0,
    call_id: c.conversation_id,
    project: projectId,
    agent: agent?.id ?? 0,
    agent_name: agent?.name ?? c.agent_name,
    timestamp: new Date(c.start_time_unix_secs * 1000).toISOString(),
    duration: duration(c.call_duration_secs),
    success: c.call_successful === 'success' ? true : c.call_successful === 'failure' ? false : null,
    status: c.status,
    call_ended_reason: c.termination_reason ?? '',
    customer_number: '',
    is_reviewed: false,
    feedback: '',
    topic: c.call_summary_title ?? '',
    dropoff_point: '',
    error_message: '',
    metrics: [],
    providerAgentId: c.agent_id,
    branchId: c.branch_id || null,
  }
}

/** A single conversation as a row, for one pasted by ID that Cekura doesn't have. */
export async function getConversationAsCallLog(id: string, projectId: number, agent?: (agentId: string) => { id: number; name: string } | undefined): Promise<CallLog> {
  const raw = await getRawConversation(id)
  const c: ElConversationSummary = {
    conversation_id: raw.conversation_id,
    agent_id: raw.agent_id,
    agent_name: raw.agent_name ?? '',
    branch_id: raw.branch_id,
    start_time_unix_secs: raw.metadata?.start_time_unix_secs ?? 0,
    call_duration_secs: raw.metadata?.call_duration_secs ?? 0,
    message_count: raw.transcript?.length ?? 0,
    status: raw.status,
    termination_reason: raw.metadata?.termination_reason,
    call_successful: raw.analysis?.call_successful,
    call_summary_title: raw.analysis?.call_summary_title,
  }
  return conversationToCallLog(c, projectId, agent?.(c.agent_id))
}

// ---- detail ---------------------------------------------------------------------------------

interface ElAnalysis {
  evaluation_criteria_results?: Record<string, { criteria_id: string; result: string; rationale?: string }>
  data_collection_results?: Record<string, { data_collection_id: string; value: unknown; rationale?: string }>
}

const rawCache = new Map<string, Promise<Record<string, any>>>()

/** The conversation exactly as ElevenLabs returns it. */
export function getRawConversation(id: string): Promise<Record<string, any>> {
  let p = rawCache.get(id)
  if (!p) {
    p = elGet<Record<string, any>>(`/conversations/${encodeURIComponent(id)}`)
    p.catch(() => rawCache.delete(id))
    rawCache.set(id, p)
  }
  return p
}

export const audioUrl = (id: string) => `${BASE}/conversations/${encodeURIComponent(id)}/audio`

/** ElevenLabs' own evaluation, shaped like Cekura metrics so the metrics pane can show it. */
function analysisMetrics(analysis: ElAnalysis | undefined): EvaluationMetric[] {
  const out: EvaluationMetric[] = []
  let id = -1
  for (const r of Object.values(analysis?.evaluation_criteria_results ?? {})) {
    out.push({
      id: id--, name: r.criteria_id, type: 'binary', explanation: r.rationale ? [r.rationale] : [],
      score: r.result === 'success' ? true : r.result === 'failure' ? false : null,
    })
  }
  for (const r of Object.values(analysis?.data_collection_results ?? {})) {
    const value = r.value == null || r.value === '' ? null : typeof r.value === 'string' ? r.value : JSON.stringify(r.value)
    out.push({ id: id--, name: r.data_collection_id, type: 'enum', enum: value, explanation: r.rationale ? [r.rationale] : [] })
  }
  return out
}

/**
 * An ElevenLabs conversation in the call-detail shape, for rows Cekura doesn't have. The transcript
 * stays in `metadata` (the raw conversation), which the transcript view reads directly.
 */
export async function getConversationDetail(call: CallLog): Promise<CallDetail & { metrics: CallMetric[] }> {
  const raw = await getRawConversation(call.call_id)
  const evaluation = analysisMetrics(raw.analysis)
  return {
    ...call,
    metadata: raw,
    evaluation: { metrics: evaluation },
    metrics: evaluation,
    voice_recording_url: raw.has_audio ? audioUrl(call.call_id) : null,
  }
}
