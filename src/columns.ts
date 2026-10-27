import type { CallLog, CallMetric } from './types'

export type CellValue = string | number | null

/**
 * binary:   'pass' | 'fail' | null (not applicable / pending)
 * category: low-cardinality string, filtered by value set
 * enum:     metric string value, filtered by value set or substring
 * text:     free text, filtered by substring
 */
export type ColumnKind = 'binary' | 'category' | 'enum' | 'text' | 'number' | 'duration' | 'date' | 'links'

export interface Column {
  key: string
  label: string
  group: string
  kind: ColumnKind
  width: number
  metricId?: number
}

export interface Row {
  call: CallLog
  v: Record<string, CellValue>
  /** Lowercased haystack for the global search box. */
  search: string
}

export const GROUPS = ['Call', 'Simulation', 'Binary metrics', 'Enum metrics', 'Numeric metrics', 'Dynamic variables'] as const

/** Dynamic variable columns are keyed `dv:<variable name>`. */
export const isVariableKey = (key: string) => key.startsWith('dv:')

const BASE_COLUMNS: Column[] = [
  { key: 'call_id', label: 'Call / conversation ID', group: 'Call', kind: 'text', width: 280 },
  { key: 'links', label: 'Links', group: 'Call', kind: 'links', width: 122 },
  { key: 'source', label: 'Source', group: 'Call', kind: 'category', width: 110 },
  { key: 'provider_agent', label: 'Provider agent', group: 'Call', kind: 'category', width: 290 },
  { key: 'branch', label: 'Branch (11Labs)', group: 'Call', kind: 'category', width: 300 },
  { key: 'timestamp', label: 'Time', group: 'Call', kind: 'date', width: 162 },
  { key: 'agent_name', label: 'Agent', group: 'Call', kind: 'category', width: 212 },
  { key: 'duration', label: 'Duration', group: 'Call', kind: 'duration', width: 92 },
  { key: 'success', label: 'Success', group: 'Call', kind: 'binary', width: 92 },
  { key: 'status', label: 'Status', group: 'Call', kind: 'category', width: 112 },
  { key: 'call_ended_reason', label: 'Ended reason', group: 'Call', kind: 'category', width: 162 },
  { key: 'customer_number', label: 'Customer #', group: 'Call', kind: 'text', width: 142 },
  { key: 'id', label: 'Cekura ID', group: 'Call', kind: 'number', width: 112 },
  { key: 'is_reviewed', label: 'Reviewed', group: 'Call', kind: 'category', width: 92 },
  { key: 'feedback', label: 'Feedback', group: 'Call', kind: 'text', width: 192 },
  { key: 'topic', label: 'Topic', group: 'Call', kind: 'category', width: 152 },
  { key: 'dropoff_point', label: 'Dropoff point', group: 'Call', kind: 'category', width: 152 },
  { key: 'error_message', label: 'Error', group: 'Call', kind: 'text', width: 192 },
  { key: 'result_name', label: 'Result', group: 'Simulation', kind: 'category', width: 220 },
  { key: 'result_id', label: 'Result ID', group: 'Simulation', kind: 'number', width: 100 },
  { key: 'scenario_name', label: 'Scenario', group: 'Simulation', kind: 'category', width: 280 },
  { key: 'personality', label: 'Personality', group: 'Simulation', kind: 'category', width: 140 },
  { key: 'expected_outcome', label: 'Expected outcome', group: 'Simulation', kind: 'category', width: 140 },
  { key: 'evaluation_status', label: 'Evaluation status', group: 'Simulation', kind: 'category', width: 130 },
  { key: 'agent_version', label: 'Agent version', group: 'Simulation', kind: 'category', width: 110 },
  { key: 'test_profile', label: 'Test profile', group: 'Simulation', kind: 'category', width: 160 },
  { key: 'run_type', label: 'Run type', group: 'Simulation', kind: 'category', width: 100 },
]

/** Added together by the "show simulation columns" shortcut. */
export const SIM_COLUMNS = ['result_name', 'scenario_name', 'expected_outcome']

export const DEFAULT_VISIBLE = ['call_id', 'links', 'timestamp', 'duration', 'success']

/**
 * Metric columns that belong in the default view. Metric keys are Cekura metric IDs, which differ
 * per project, so these are matched by metric name once the data is loaded.
 */
export const DEFAULT_METRICS: { names: string[]; after: string[] }[] = [
  { names: ['Info: Business Name', 'location name', 'business_id'], after: ['branch', 'provider_agent', 'agent_name', 'timestamp'] },
  { names: ['Technically adherent (LLM judge)'], after: ['success'] },
]
export const DEFAULT_METRIC_NAMES = DEFAULT_METRICS.flatMap((g) => g.names)

export const findMetricKey = (columns: Column[], name: string) =>
  columns.find((c) => c.metricId != null && c.label.toLowerCase() === name.toLowerCase())?.key

/**
 * Adds default metric columns to a column list, each group right after the first of its anchor
 * columns that's shown (or at the end), skipping metrics the data doesn't have.
 */
export function withDefaultMetrics(visible: string[], columns: Column[], only: string[] = DEFAULT_METRIC_NAMES): string[] {
  let next = [...visible]
  for (const group of DEFAULT_METRICS) {
    const keys = group.names
      .filter((n) => only.includes(n))
      .map((n) => findMetricKey(columns, n))
      .filter((k): k is string => !!k && !next.includes(k))
    if (keys.length === 0) continue
    const anchor = group.after.find((k) => next.includes(k))
    const at = anchor ? next.indexOf(anchor) + 1 : next.length
    next = [...next.slice(0, at), ...keys, ...next.slice(at)]
  }
  return next
}

/** Cekura scores expected outcomes 0 (not met), 50 (partially met) or 100 (met). */
export function expectedOutcomeLabel(score: number | null | undefined): string | null {
  if (score == null) return null
  if (score >= 100) return 'Met'
  if (score <= 0) return 'Not met'
  return `Partial (${score})`
}

/** Separates fields in a row's search text. */
export const SEARCH_SEP = '\u0001'

export function parseDuration(d: string | null | undefined): number | null {
  if (!d) return null
  const parts = d.split(':').map(Number)
  if (parts.some(Number.isNaN)) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export function formatDuration(s: number | null): string {
  if (s == null) return ''
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

const metricKey = (id: number, sub?: string) => (sub ? `m:${id}:${sub}` : `m:${id}`)

/** Cekura reports trigger-skipped binary metrics as `score: true`; they are really N/A. */
export function binaryValue(m: CallMetric): 'pass' | 'fail' | null {
  if (m.extra?.trigger_failed) return null
  if (m.score === true) return 'pass'
  if (m.score === false) return 'fail'
  return null
}

function metricValue(m: CallMetric): CellValue {
  switch (m.type) {
    case 'binary':
      return binaryValue(m)
    case 'enum':
      return m.extra?.trigger_failed ? null : (m.enum ?? null)
    default:
      return typeof m.score === 'number' ? m.score : null
  }
}

function groupFor(type: string) {
  if (type === 'binary') return 'Binary metrics'
  if (type === 'enum') return 'Enum metrics'
  return 'Numeric metrics'
}

function kindFor(type: string): ColumnKind {
  if (type === 'binary') return 'binary'
  if (type === 'enum') return 'enum'
  return 'number'
}

/** Placeholder for ElevenLabs production calls whose branch hasn't been fetched yet. */
export const BRANCH_PENDING = '…loading'

export function buildModel(calls: CallLog[]): { columns: Column[]; rows: Row[] } {
  const metricCols = new Map<string, Column>()
  const variableCols = new Map<string, Column>()

  const rows = calls.map((call): Row => {
    const v: Record<string, CellValue> = {
      timestamp: Date.parse(call.timestamp),
      agent_name: call.agent_name || null,
      duration: parseDuration(call.duration),
      success: call.success === true ? 'pass' : call.success === false ? 'fail' : null,
      status: call.status || null,
      call_ended_reason: call.call_ended_reason || null,
      customer_number: call.customer_number || null,
      call_id: call.call_id || null,
      id: call.source === 'el' ? null : call.id,
      is_reviewed: call.is_reviewed ? 'yes' : 'no',
      feedback: call.feedback || null,
      topic: call.topic || null,
      dropoff_point: call.dropoff_point || null,
      error_message: call.error_message || null,
      source: call.source === 'sim' ? 'Simulation' : call.source === 'el' ? '11Labs only' : 'Call',
      provider_agent: call.providerAgentId ?? null,
      branch: call.branchId === undefined && call.call_id?.startsWith('conv_') ? BRANCH_PENDING : call.branchId ?? null,
      result_name: call.sim?.resultName ?? null,
      result_id: call.sim?.resultId ?? null,
      scenario_name: call.sim?.scenarioName ?? null,
      personality: call.sim?.personality ?? null,
      expected_outcome: expectedOutcomeLabel(call.sim?.expectedOutcome),
      evaluation_status: call.sim?.evaluationStatus ?? null,
      agent_version: call.sim?.agentVersion ?? null,
      test_profile: call.sim?.testProfile ?? null,
      run_type: call.sim?.runType ?? null,
    }
    const searchParts = [call.call_id, call.customer_number, call.source !== 'el' && String(call.id), call.agent_name, call.feedback,
      String(call.agent), call.sim && String(call.sim.resultId), call.sim && String(call.sim.scenarioId), call.sim?.resultName, call.sim?.scenarioName,
      call.providerAgentId, call.branchId]

    for (const m of call.metrics ?? []) {
      const key = metricKey(m.id)
      if (!metricCols.has(key)) {
        metricCols.set(key, {
          key,
          label: m.name,
          group: groupFor(m.type),
          kind: kindFor(m.type),
          width: m.type === 'binary' ? 104 : m.type === 'enum' ? 176 : 116,
          metricId: m.id,
        })
      }
      const val = metricValue(m)
      v[key] = val
      if (m.type === 'enum' && val) searchParts.push(String(val))

      // Latency-style metrics carry first-turn and percentile breakdowns worth sorting on.
      const extras: [string, unknown][] = [
        ['first_turn', m.extra?.first_turn],
        ...Object.entries(m.extra?.percentiles ?? {}),
      ]
      for (const [sub, n] of extras) {
        if (typeof n !== 'number') continue
        const k = metricKey(m.id, sub)
        if (!metricCols.has(k)) {
          metricCols.set(k, { key: k, label: `${m.name} · ${sub.replace('_', ' ')}`, group: 'Numeric metrics', kind: 'number', width: 116, metricId: m.id })
        }
        v[k] = n
      }
    }
    for (const [name, val] of Object.entries(call.variables ?? {})) {
      const key = `dv:${name}`
      if (!variableCols.has(key)) variableCols.set(key, { key, label: name, group: 'Dynamic variables', kind: 'category', width: 170 })
      v[key] = val
    }
    // Search covers every column as displayed, plus a few raw fields, one field per segment so a
    // query (or a * wildcard) can't match across two columns.
    // Pass/fail metrics render as icons, so their words are left out; otherwise "fail" would
    // match nearly every row.
    for (const [k, val] of Object.entries(v)) {
      if (k === 'success') searchParts.push(val === 'pass' ? 'Passed' : val === 'fail' ? 'Failed' : 'Evaluating')
      else if (val == null || metricCols.get(k)?.kind === 'binary') continue
      else searchParts.push(k === 'timestamp' ? formatCell({ kind: 'date' } as Column, val) : k === 'duration' ? formatDuration(val as number) : String(val))
    }
    return { call, v, search: searchParts.filter(Boolean).join(SEARCH_SEP).toLowerCase() }
  })

  const sortedMetricCols = [...metricCols.values()].sort((a, b) => a.label.localeCompare(b.label))
  const sortedVariableCols = [...variableCols.values()].sort((a, b) => a.label.localeCompare(b.label))
  return { columns: [...BASE_COLUMNS, ...sortedMetricCols, ...sortedVariableCols], rows }
}

export function formatCell(col: Column, v: CellValue): string {
  if (v == null) return ''
  switch (col.kind) {
    case 'date':
      return new Date(v as number).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
    case 'duration':
      return formatDuration(v as number)
    case 'number':
      return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v)
    default:
      return String(v)
  }
}

export function isSetKind(kind: ColumnKind) {
  return kind === 'binary' || kind === 'category' || kind === 'enum'
}

export function isRangeKind(kind: ColumnKind) {
  return kind === 'number' || kind === 'duration' || kind === 'date'
}

/** Never shows 100% when something failed, so rare failures don't disappear in rounding. */
export function passRate(pass: number, fail: number): number {
  const pct = Math.round((pass / (pass + fail)) * 100)
  return fail > 0 ? Math.min(pct, 99) : pct
}
