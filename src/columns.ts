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

export const GROUPS = ['Call', 'Simulation', 'Binary metrics', 'Enum metrics', 'Numeric metrics'] as const

const BASE_COLUMNS: Column[] = [
  { key: 'call_id', label: 'Call / conversation ID', group: 'Call', kind: 'text', width: 280 },
  { key: 'links', label: 'Links', group: 'Call', kind: 'links', width: 122 },
  { key: 'source', label: 'Source', group: 'Call', kind: 'category', width: 110 },
  { key: 'provider_agent', label: 'Provider agent', group: 'Call', kind: 'category', width: 220 },
  { key: 'branch', label: 'Branch (11Labs)', group: 'Call', kind: 'category', width: 220 },
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

export const DEFAULT_VISIBLE = ['call_id', 'links', 'timestamp', 'agent_name', 'duration', 'success', 'call_ended_reason']

/** Cekura scores expected outcomes 0 (not met), 50 (partially met) or 100 (met). */
export function expectedOutcomeLabel(score: number | null | undefined): string | null {
  if (score == null) return null
  if (score >= 100) return 'Met'
  if (score <= 0) return 'Not met'
  return `Partial (${score})`
}

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

export interface NameLookup {
  agents: Record<string, string>
  branches: Record<string, string>
}

/** Friendly name when the ai-receptionist repo knows the ID, otherwise the raw ID. */
const named = (id: string | null | undefined, names: Record<string, string>) => (id ? names[id] ?? id : null)

/** Placeholder for ElevenLabs production calls whose branch hasn't been fetched yet. */
export const BRANCH_PENDING = '…loading'

export function buildModel(calls: CallLog[], names: NameLookup = { agents: {}, branches: {} }): { columns: Column[]; rows: Row[] } {
  const metricCols = new Map<string, Column>()

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
      id: call.id,
      is_reviewed: call.is_reviewed ? 'yes' : 'no',
      feedback: call.feedback || null,
      topic: call.topic || null,
      dropoff_point: call.dropoff_point || null,
      error_message: call.error_message || null,
      source: call.source === 'sim' ? 'Simulation' : 'Call',
      provider_agent: named(call.providerAgentId, names.agents),
      branch: call.branchId === undefined && call.call_id?.startsWith('conv_') ? BRANCH_PENDING : named(call.branchId, names.branches),
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
    const searchParts = [call.call_id, call.customer_number, String(call.id), call.agent_name, call.feedback, call.sim?.resultName, call.sim?.scenarioName,
      call.providerAgentId, call.branchId, named(call.providerAgentId, names.agents), named(call.branchId, names.branches)]

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
    return { call, v, search: searchParts.filter(Boolean).join(' ').toLowerCase() }
  })

  const sortedMetricCols = [...metricCols.values()].sort((a, b) => a.label.localeCompare(b.label))
  return { columns: [...BASE_COLUMNS, ...sortedMetricCols], rows }
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
