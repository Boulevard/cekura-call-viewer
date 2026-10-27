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
  /** Results to include even when they fall outside the time window (e.g. a pasted list of IDs). */
  extraResultIds: number[] = [],
  /** Skip the time window and load only `extraResultIds` (Simulations is off, but IDs were pasted). */
  onlyExtra = false,
): Promise<{ calls: CallLog[]; total: number; truncated: boolean; results: number }> {
  const from = Date.parse(q.from)
  const to = Date.parse(q.to)

  // Results come newest first; stop paging once a page reaches past the start of the window.
  const results: ResultRow[] = []
  for (let page = 1; !onlyExtra; page++) {
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

  const missing = extraResultIds.filter((id) => !results.some((r) => r.id === id))
  for (let i = 0; i < missing.length; i += PAGE_SIZE) {
    const res = await get<Page<ResultRow>>(settings, '/test_framework/v1/results/', {
      project_id: q.projectId, id__in: missing.slice(i, i + PAGE_SIZE).join(','), page_size: PAGE_SIZE, ql: RESULT_FIELDS,
    }, signal)
    results.push(...res.results)
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

export interface ProviderAgents {
  /** Cekura agent ID -> the ElevenLabs/Retell agent ID it's configured with. */
  byCekuraAgent: Map<number, string>
  /** ElevenLabs agent ID -> the Cekura agent set up with it, so 11Labs-only rows file under the same agent. */
  elevenLabs: Map<string, { id: number; name: string }>
}

export async function listProviderAgents(settings: Settings, projectId: number): Promise<ProviderAgents> {
  const res = await get<Page<{ id: number; agent_name: string; assistant_id: string; assistant_provider: string }>>(settings, '/test_framework/v1/aiagents/', {
    project_id: projectId, page_size: 200, ql: '{id,agent_name,assistant_id,assistant_provider}',
  })
  const rows = res.results.filter((a) => a.assistant_id)
  const elevenLabs = new Map<string, { id: number; name: string }>()
  for (const a of rows) {
    if (a.assistant_provider === 'elevenlabs' && !elevenLabs.has(a.assistant_id)) elevenLabs.set(a.assistant_id, { id: a.id, name: a.agent_name })
  }
  return { byCekuraAgent: new Map(rows.map((a) => [a.id, a.assistant_id])), elevenLabs }
}

/**
 * Provider call IDs Cekura has in a time window (calls and simulation runs), fetched with only the
 * ID field. Used to tell which ElevenLabs conversations Cekura never imported when the full call
 * or run list isn't loaded.
 */
export async function listKnownProviderIds(settings: Settings, q: ListQuery, which: { calls: boolean; sims: boolean }, signal?: AbortSignal): Promise<Set<string>> {
  const ids = new Set<string>()
  // The call-logs endpoint caps page_size at 200.
  const ID_PAGE_SIZE = 200
  // Runs CONCURRENCY tasks at a time, so a long range doesn't page through IDs one request at a time.
  const pool = async (tasks: (() => Promise<void>)[]) => {
    let next = 0
    const worker = async () => { while (next < tasks.length) await tasks[next++]() }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker))
  }

  const calls = async () => {
    const params = { project_id: q.projectId, timestamp_from: q.from, timestamp_to: q.to, page_size: ID_PAGE_SIZE, ql: '{call_id}' }
    const path = '/observability/v2/call-logs/'
    const add = (rows: { call_id: string }[]) => { for (const r of rows) if (r.call_id) ids.add(r.call_id) }
    const first = await get<Page<{ call_id: string }>>(settings, path, { ...params, page: 1, include_count: 'true' }, signal)
    add(first.results)
    const pages = Math.ceil((first.count ?? 0) / ID_PAGE_SIZE)
    await pool(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => async () => {
      add((await get<Page<{ call_id: string }>>(settings, path, { ...params, page: i + 2 }, signal)).results)
    }))
  }

  const sims = async () => {
    // A result started just before the window can still have runs inside it.
    const from = Date.parse(q.from) - 3600e3
    const resultIds: number[] = []
    for (let page = 1; ; page++) {
      const res = await get<Page<ResultRow>>(settings, '/test_framework/v1/results/', { project_id: q.projectId, page, page_size: PAGE_SIZE, ql: RESULT_FIELDS }, signal)
      for (const r of res.results) if (Date.parse(r.created_at) >= from) resultIds.push(r.id)
      const last = res.results.at(-1)
      if (!res.next || !last || Date.parse(last.created_at) < from) break
    }
    const chunks: number[][] = []
    for (let i = 0; i < resultIds.length; i += RESULTS_PER_RUN_QUERY) chunks.push(resultIds.slice(i, i + RESULTS_PER_RUN_QUERY))
    await pool(chunks.map((chunk) => async () => {
      for (let page = 1; ; page++) {
        const res = await get<Page<{ provider_call_id: string }>>(settings, '/test_framework/v2/runs/', {
          project_id: q.projectId, result_ids: chunk.join(','), page, page_size: ID_PAGE_SIZE, ql: '{provider_call_id}',
        }, signal)
        for (const r of res.results) if (r.provider_call_id) ids.add(r.provider_call_id)
        if (!res.next) break
      }
    }))
  }

  await Promise.all([which.calls && calls(), which.sims && sims()])
  return ids
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

// ---- Dynamic variables ----------------------------------------------------------------------

// Credentials aren't something to filter on, and shouldn't sit in memory or end up in a CSV.
const SECRET_VARIABLE = /^secret__|auth_token|token$|password/i
// Longer values are blobs (knowledge base, service catalogs, capabilities JSON) that make poor filters.
const MAX_VARIABLE_LENGTH = 200

export function slimVariables(...sources: unknown[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue
    for (const [k, raw] of Object.entries(src as Record<string, unknown>)) {
      if (SECRET_VARIABLE.test(k) || raw == null) continue
      const v = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw)
      if (!v || v === 'None' || v.length > MAX_VARIABLE_LENGTH) continue
      out[k] = v
    }
  }
  return out
}

const VARIABLE_BATCH = 50

/** Dynamic variables for call logs, in batches; `onBatch` gets each batch's results as they land. */
export async function fetchCallVariables(
  settings: Settings,
  projectId: number,
  ids: number[],
  range: { from: string; to: string },
  onBatch: (found: Map<number, Record<string, string>>) => void,
  signal?: AbortSignal,
) {
  const batches: number[][] = []
  for (let i = 0; i < ids.length; i += VARIABLE_BATCH) batches.push(ids.slice(i, i + VARIABLE_BATCH))
  let next = 0
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++]
      const res = await get<Page<{ id: number; dynamic_variables?: unknown }>>(settings, '/observability/v2/call-logs/', {
        project_id: projectId, call_ids: batch.join(','), page_size: batch.length, ql: '{id,dynamic_variables}',
        timestamp_from: range.from, timestamp_to: range.to,
      }, signal)
      const found = new Map<number, Record<string, string>>(batch.map((id) => [id, {}]))
      for (const r of res.results) found.set(r.id, slimVariables(r.dynamic_variables))
      onBatch(found)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker))
}

/** Dynamic variables for simulation runs, which keep them in the provider metadata. */
export async function fetchRunVariables(
  settings: Settings,
  projectId: number,
  resultIds: number[],
  onBatch: (found: Map<number, Record<string, string>>) => void,
  signal?: AbortSignal,
) {
  type Row = { id: number; metadata?: { retell_llm_dynamic_variables?: unknown; collected_dynamic_variables?: unknown; conversation_initiation_client_data?: { dynamic_variables?: unknown } } }
  const chunks: number[][] = []
  for (let i = 0; i < resultIds.length; i += RESULTS_PER_RUN_QUERY) chunks.push(resultIds.slice(i, i + RESULTS_PER_RUN_QUERY))
  let next = 0
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++]
      for (let page = 1; ; page++) {
        const res = await get<Page<Row>>(settings, '/test_framework/v2/runs/', {
          project_id: projectId, result_ids: chunk.join(','), page, page_size: PAGE_SIZE,
          ql: '{id,metadata{retell_llm_dynamic_variables,collected_dynamic_variables,conversation_initiation_client_data}}',
        }, signal)
        onBatch(new Map(res.results.map((r) => [r.id, slimVariables(
          r.metadata?.retell_llm_dynamic_variables, r.metadata?.collected_dynamic_variables,
          r.metadata?.conversation_initiation_client_data?.dynamic_variables,
        )])))
        if (!res.next) break
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker))
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

/**
 * Cekura calls and simulation runs for specific provider call IDs (ElevenLabs conversation or
 * Retell call IDs), wherever they fall in time.
 */
export async function getByProviderIds(settings: Settings, projectId: number, ids: string[], signal?: AbortSignal): Promise<CallLog[]> {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50))
  const [calls, runs] = await Promise.all([
    Promise.all(chunks.map((c) => get<Page<ListRow>>(settings, '/observability/v2/call-logs/', {
      project_id: projectId, call_ids: c.join(','), page_size: 100, ql: `{${LIST_FIELDS.join(',')}}`,
    }, signal))),
    Promise.all(chunks.map((c) => get<Page<RunRow>>(settings, '/test_framework/v2/runs/', {
      project_id: projectId, provider_call_id: c.join(','), page_size: 100, ql: RUN_FIELDS,
    }, signal))),
  ])
  const runRows = runs.flatMap((p) => p.results)
  const resultIds = [...new Set(runRows.map((r) => r.result_id))]
  const names = new Map<number, string>()
  for (let i = 0; i < resultIds.length; i += PAGE_SIZE) {
    const res = await get<Page<ResultRow>>(settings, '/test_framework/v1/results/', {
      project_id: projectId, id__in: resultIds.slice(i, i + PAGE_SIZE).join(','), page_size: PAGE_SIZE, ql: RESULT_FIELDS,
    }, signal)
    for (const r of res.results) names.set(r.id, r.name)
  }
  return [
    ...calls.flatMap((p) => p.results.map(toCallLog)),
    ...runRows.map((r) => runToCallLog(r, projectId, names.get(r.result_id) ?? `Result ${r.result_id}`)),
  ]
}
