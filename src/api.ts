import type { CallDetail, CallLog, CallMetric, EvaluationMetric, Page } from './types'
import type { Settings } from './settings'

const BASE = import.meta.env.DEV ? '/cekura' : 'https://api.cekura.ai'

// A full row is ~150KB (metadata, waveform, transcript), so the table only pulls what it needs and
// the detail view fetches the rest per call. Metric scores only come back inside `evaluation`.
const LIST_FIELDS = [
  'id', 'call_id', 'project', 'agent', 'agent_name', 'timestamp', 'duration', 'success', 'status',
  'call_ended_reason', 'customer_number', 'is_reviewed', 'feedback', 'topic', 'dropoff_point',
  'error_message', 'evaluation',
]

type ListRow = Omit<CallLog, 'metrics' | 'uid' | 'source'> & { evaluation?: { metrics?: EvaluationMetric[] } }

const slimMetric = ({ id, name, type, score, enum: e, extra }: CallMetric): CallMetric => ({ id, name, type, score, enum: e, extra })

// Explanations make up most of `evaluation`; dropping them keeps multi-day loads small in memory.
function toCallLog({ evaluation, ...rest }: ListRow): CallLog {
  return { ...rest, uid: `call:${rest.id}`, source: 'call', metrics: (evaluation?.metrics ?? []).map(slimMetric) }
}

const PAGE_SIZE = 100
const CONCURRENCY = 6

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function get<T>(settings: Settings, path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (settings.apiKey) headers['X-CEKURA-API-KEY'] = settings.apiKey
  const res = await fetch(`${BASE}${path}${qs.size ? `?${qs}` : ''}`, { headers, signal })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = body.detail ?? body.error ?? JSON.stringify(body)
    } catch { /* non-JSON body */ }
    throw new ApiError(res.status, `${res.status}: ${msg}`)
  }
  return res.json() as Promise<T>
}

export interface ListQuery {
  projectId: number
  from: string
  to: string
  agentId?: number
}

export async function listCalls(
  settings: Settings,
  q: ListQuery,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ calls: CallLog[]; total: number; truncated: boolean }> {
  const params = {
    project_id: q.projectId,
    agent_id: q.agentId,
    timestamp_from: q.from,
    timestamp_to: q.to,
    page_size: PAGE_SIZE,
    ql: `{${LIST_FIELDS.join(',')}}`,
  }
  const path = '/observability/v2/call-logs/'
  const first = await get<Page<ListRow>>(settings, path, { ...params, page: 1, include_count: 'true' }, signal)
  const total = first.count ?? first.results.length
  const wanted = Math.min(total, settings.maxCalls)
  const pages = Math.ceil(wanted / PAGE_SIZE)
  const byPage: CallLog[][] = [first.results.map(toCallLog)]
  let loaded = first.results.length
  onProgress(loaded, wanted)

  let nextPage = 2
  async function worker() {
    while (nextPage <= pages) {
      const page = nextPage++
      const res = await get<Page<ListRow>>(settings, path, { ...params, page }, signal)
      byPage[page - 1] = res.results.map(toCallLog)
      loaded += res.results.length
      onProgress(loaded, wanted)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages - 1) }, worker))

  const seen = new Set<number>()
  const calls = byPage.flat().filter((c) => !seen.has(c.id) && seen.add(c.id))
  return { calls: calls.slice(0, wanted), total, truncated: total > wanted || !!first.count_capped }
}

const detailCache = new Map<number, Promise<CallDetail>>()

export function getCall(settings: Settings, id: number): Promise<CallDetail> {
  let p = detailCache.get(id)
  if (!p) {
    p = get<CallDetail>(settings, `/observability/v2/call-logs/${id}/`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return get<CallDetail>(settings, `/observability/v1/call-logs/${id}/`)
      throw e
    })
    p.catch(() => detailCache.delete(id))
    detailCache.set(id, p)
  }
  return p
}

// ---- Simulations ----------------------------------------------------------------------------
// Simulation runs belong to "results" (one per test-suite execution). The runs endpoint ignores
// timestamp filters, so the time window is applied to results, then their runs are fetched.

interface ResultRow {
  id: number
  name: string
  created_at: string
  total_runs_count: number
}

interface RunRow {
  id: number
  provider_call_id: string
  scenario: number
  scenario_name: string
  personality_name: string
  result_id: number
  agent: number
  agent_name: string
  duration: string
  status: string
  evaluation_status: string
  success: boolean | null
  timestamp: string
  metrics: CallMetric[]
  error_message: string
  run_type: string
  inbound_number: string
  expected_outcome?: { score?: number | null } | null
  agent_version?: { version_id?: string } | null
  test_profile_name: string | null
  metadata?: { branch_id?: string; visited_agents?: { agent_id?: string }[] } | null
}

const RESULT_FIELDS = '{id,name,created_at,total_runs_count}'
const RUN_FIELDS = `{${[
  'id', 'provider_call_id', 'scenario', 'scenario_name', 'personality_name', 'result_id', 'agent', 'agent_name',
  'duration', 'status', 'evaluation_status', 'success', 'timestamp', 'metrics', 'error_message', 'run_type',
  'inbound_number', 'expected_outcome', 'agent_version', 'test_profile_name',
  // Runs allow picking nested metadata, so the ElevenLabs branch/agent come along cheaply.
  'metadata{branch_id,visited_agents}',
].join(',')}}`
const RESULTS_PER_RUN_QUERY = 25

function runToCallLog(r: RunRow, projectId: number, resultName: string): CallLog {
  return {
    uid: `run:${r.id}`,
    source: 'sim',
    id: r.id,
    call_id: r.provider_call_id,
    project: projectId,
    agent: r.agent,
    agent_name: r.agent_name,
    timestamp: r.timestamp,
    duration: r.duration,
    success: r.success,
    status: r.status,
    call_ended_reason: '',
    customer_number: r.inbound_number ?? '',
    is_reviewed: false,
    feedback: '',
    topic: '',
    dropoff_point: '',
    error_message: r.error_message ?? '',
    metrics: (r.metrics ?? []).map(slimMetric),
    providerAgentId: r.metadata?.visited_agents?.[0]?.agent_id ?? null,
    branchId: r.metadata?.branch_id || null,
    sim: {
      resultId: r.result_id,
      resultName,
      scenarioId: r.scenario,
      scenarioName: r.scenario_name,
      personality: r.personality_name,
      evaluationStatus: r.evaluation_status,
      expectedOutcome: typeof r.expected_outcome?.score === 'number' ? r.expected_outcome.score : null,
      runType: r.run_type,
      agentVersion: r.agent_version?.version_id ?? null,
      testProfile: r.test_profile_name,
    },
  }
}

export async function listSims(
  settings: Settings,
  q: ListQuery,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ calls: CallLog[]; total: number; truncated: boolean; results: number }> {
  const from = Date.parse(q.from)
  const to = Date.parse(q.to)

  // Results come newest first; stop paging once a page reaches past the start of the window.
  const results: ResultRow[] = []
  for (let page = 1; ; page++) {
    const res = await get<Page<ResultRow>>(settings, '/test_framework/v1/results/', {
      project_id: q.projectId, agent_id: q.agentId, page, page_size: PAGE_SIZE, ql: RESULT_FIELDS,
    }, signal)
    for (const r of res.results) {
      const t = Date.parse(r.created_at)
      if (t >= from && t <= to) results.push(r)
    }
    const last = res.results.at(-1)
    if (!res.next || !last || Date.parse(last.created_at) < from) break
  }

  const total = results.reduce((a, r) => a + r.total_runs_count, 0)
  const wanted = Math.min(total, settings.maxCalls)
  const names = new Map(results.map((r) => [r.id, r.name]))
  onProgress(0, wanted)

  const chunks: number[][] = []
  for (let i = 0; i < results.length; i += RESULTS_PER_RUN_QUERY) chunks.push(results.slice(i, i + RESULTS_PER_RUN_QUERY).map((r) => r.id))

  const runs: CallLog[] = []
  let next = 0
  async function worker() {
    while (next < chunks.length && runs.length < wanted) {
      const ids = chunks[next++].join(',')
      for (let page = 1; ; page++) {
        const res = await get<Page<RunRow>>(settings, '/test_framework/v2/runs/', {
          project_id: q.projectId, result_ids: ids, page, page_size: PAGE_SIZE, ql: RUN_FIELDS,
        }, signal)
        runs.push(...res.results.map((r) => runToCallLog(r, q.projectId, names.get(r.result_id) ?? `Result ${r.result_id}`)))
        onProgress(Math.min(runs.length, wanted), wanted)
        if (!res.next) break
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker))

  return { calls: runs.slice(0, wanted), total, truncated: total > wanted, results: results.length }
}

const runCache = new Map<number, Promise<CallDetail>>()

export function getRun(settings: Settings, id: number): Promise<CallDetail> {
  let p = runCache.get(id)
  if (!p) {
    p = get<CallDetail>(settings, `/test_framework/v2/runs/${id}/`)
    p.catch(() => runCache.delete(id))
    runCache.set(id, p)
  }
  return p
}

// ---- Provider agents & ElevenLabs branches ---------------------------------------------------

/** Cekura agent ID -> the ElevenLabs/Retell agent ID it's configured with. */
export async function listProviderAgents(settings: Settings, projectId: number): Promise<Map<number, string>> {
  const res = await get<Page<{ id: number; assistant_id: string }>>(settings, '/test_framework/v1/aiagents/', {
    project_id: projectId, page_size: 200, ql: '{id,assistant_id}',
  })
  return new Map(res.results.filter((a) => a.assistant_id).map((a) => [a.id, a.assistant_id]))
}

const BRANCH_BATCH = 20

/**
 * Call logs can't select nested metadata, and the full blob is ~250KB per ElevenLabs call, so
 * branches for production calls are fetched separately, in small batches, only when needed.
 */
export async function fetchCallBranches(
  settings: Settings,
  projectId: number,
  ids: number[],
  range: { from: string; to: string },
  onBatch: (found: Map<number, { branchId: string | null; agentId: string | null }>) => void,
  signal?: AbortSignal,
) {
  type MetaRow = { id: number; metadata?: { branch_id?: string; visited_agents?: { agent_id?: string }[]; provider_call_data?: { agent_id?: string } } }
  const batches: number[][] = []
  for (let i = 0; i < ids.length; i += BRANCH_BATCH) batches.push(ids.slice(i, i + BRANCH_BATCH))
  let next = 0
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++]
      const res = await get<Page<MetaRow>>(settings, '/observability/v2/call-logs/', {
        project_id: projectId, call_ids: batch.join(','), page_size: batch.length, ql: '{id,metadata}',
        // Without a range the list only searches the last 30 days.
        timestamp_from: range.from, timestamp_to: range.to,
      }, signal)
      const found = new Map<number, { branchId: string | null; agentId: string | null }>()
      for (const id of batch) found.set(id, { branchId: null, agentId: null })
      for (const r of res.results) {
        const md = r.metadata ?? {}
        found.set(r.id, {
          branchId: md.branch_id || null,
          agentId: md.visited_agents?.[0]?.agent_id ?? md.provider_call_data?.agent_id ?? null,
        })
      }
      onBatch(found)
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker))
}

// ---- Projects -------------------------------------------------------------------------------

export interface Project {
  id: number
  name: string
  organization: string | null
}

export async function listProjects(settings: Settings): Promise<Project[]> {
  type Raw = { id: number; name: string; organization?: { name?: string } | null }
  const res = await get<Raw[] | Page<Raw>>(settings, '/user/v1/projects/')
  const rows = Array.isArray(res) ? res : res.results
  return rows.map((p) => ({ id: p.id, name: p.name, organization: p.organization?.name ?? null }))
}
