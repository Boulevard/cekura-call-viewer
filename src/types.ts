export type MetricType = 'binary' | 'enum' | 'numeric' | 'continuous_qualitative' | (string & {})

export interface CallMetric {
  id: number
  name: string
  type: MetricType
  score?: number | boolean | null
  enum?: string | null
  extra?: {
    trigger_failed?: boolean
    first_turn?: number
    percentiles?: Record<string, number>
    [k: string]: unknown
  }
}

export interface EvaluationMetric extends CallMetric {
  explanation?: string[] | string | null
  score_normalized?: number | null
  thumbs_up?: boolean | null
}

/** `el`: an ElevenLabs conversation Cekura doesn't have (no Cekura ID, metrics or links). */
export type Source = 'call' | 'sim' | 'el'

/** Simulation-only fields; production call logs leave this undefined. */
export interface SimInfo {
  resultId: number
  resultName: string
  scenarioId: number
  scenarioName: string
  personality: string
  evaluationStatus: string
  /** 0-100 score from the result's expected-outcome judge. */
  expectedOutcome: number | null
  runType: string
  agentVersion: string | null
  testProfile: string | null
}

/**
 * One row in the list. Simulation runs are mapped onto the call-log shape so the table,
 * filters and detail view treat both the same; `source` and `sim` carry the differences.
 */
export interface CallLog {
  /** Unique across sources (`call:<id>` / `run:<id>`), since call-log and run IDs can collide. */
  uid: string
  source: Source
  sim?: SimInfo
  /** ElevenLabs / Retell agent ID that handled the call. */
  providerAgentId?: string | null
  /** ElevenLabs branch; only ElevenLabs calls have one, and production calls get it lazily. */
  branchId?: string | null
  /**
   * The ElevenLabs / Retell dynamic variables, trimmed to the small values worth filtering on.
   * Undefined until fetched, since they're only loaded while a variable column is in use.
   */
  variables?: Record<string, string> | null
  /** Loaded only because its call ID was pasted into the IDs box; dropped when that's cleared. */
  pinned?: boolean
  id: number
  call_id: string
  project: number
  agent: number
  agent_name: string
  timestamp: string
  duration: string
  success: boolean | null
  status: string
  call_ended_reason: string
  customer_number: string
  is_reviewed: boolean
  feedback: string
  topic: string
  dropoff_point: string
  error_message: string
  metrics: CallMetric[]
}

export interface TranscriptEntry {
  role: string
  content?: string | null
  data?: { id?: string; name?: string; arguments?: string; result?: string; is_error?: boolean }
  start_time?: number
  end_time?: number
  time?: string
}

export interface RubricItem {
  metric_id: number
  metric_name: string
  passed: boolean
  value: unknown
  conditions: string
  explanation?: string[] | string
}

/** Shape of the single call-log / run endpoints; only the fields the UI reads are typed. */
export interface CallDetail extends Omit<CallLog, 'uid' | 'source' | 'sim'> {
  voice_recording_url?: string | null
  transcript?: string
  transcript_object?: TranscriptEntry[]
  evaluation?: { metrics: EvaluationMetric[] }
  rubric?: RubricItem[]
  dynamic_variables?: Record<string, unknown> | null
  agent_version?: unknown
  metadata?: Record<string, any>
  // Simulation runs only
  scenario_instructions?: string
  expected_outcome_prompt?: string
  expected_outcome?: { score?: number | null; explanation?: string[] | string }
  [k: string]: unknown
}

export interface Page<T> {
  next: string | null
  previous: string | null
  results: T[]
  count?: number
  count_capped?: boolean
}
