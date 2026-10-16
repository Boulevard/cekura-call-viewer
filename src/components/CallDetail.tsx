import { useEffect, useMemo, useRef, useState } from 'react'
import { getCall, getRun } from '../api'
import { binaryValue, expectedOutcomeLabel, formatDuration, parseDuration, type Row } from '../columns'
import { cekuraLink, providerLink, type Settings } from '../settings'
import type { CallDetail as Detail, CallLog, CallMetric, EvaluationMetric } from '../types'
import { BinaryBadge } from './Badge'
import { CopyIcon, isPhoneNumber } from './CopyIcon'
import { JsonView } from './JsonView'
import { Transcript } from './Transcript'

interface Props {
  row: Row
  settings: Settings
  position: string
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}

export function CallDetail({ row, settings, position, onClose, onPrev, onNext }: Props) {
  const call = row.call
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'transcript' | 'data' | 'raw'>('transcript')
  const audioRef = useRef<HTMLAudioElement>(null)
  const [time, setTime] = useState(0)
  const [rate, setRate] = useState(1)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    setTime(0)
    const fetchDetail = call.source === 'sim' ? getRun : getCall
    fetchDetail(settings, call.id).then(
      (d) => !cancelled && setDetail(d),
      (e) => !cancelled && setError(String(e.message ?? e)),
    )
    return () => { cancelled = true }
  }, [call.id, call.source, settings])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate, detail])

  const prov = providerLink(settings, call.call_id)
  const recording = detail?.voice_recording_url || detail?.metadata?.recording_url
  const seek = (t: number) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = t
    a.play()
  }

  return (
    <aside className="detail">
      <header className="detail-head">
        <div className="detail-title">
          <div className="detail-nav">
            <button className="btn ghost" onClick={onPrev} title="Previous (k / ↑)">↑</button>
            <button className="btn ghost" onClick={onNext} title="Next (j / ↓)">↓</button>
            <span className="muted small">{position}</span>
          </div>
          <h2>
            {call.sim && <span className="sim-tag big">SIMULATION</span>}
            {call.sim ? call.sim.scenarioName : call.agent_name}
          </h2>
          <button className="btn ghost close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="detail-facts">
          <span>{new Date(call.timestamp).toLocaleString()}</span>
          <span>{formatDuration(parseDuration(call.duration))}</span>
          <BinaryBadge value={row.v.success} naLabel="pending" />
          <span className="pill">{call.status}</span>
          {call.call_ended_reason && <span className="pill">{call.call_ended_reason}</span>}
        </div>
        <CallContext call={call} detail={detail} />
        {call.sim && (
          <div className="detail-facts">
            <span>{call.agent_name}</span>
            <span>Result <b>{call.sim.resultName}</b></span>
            <span>{call.sim.personality}</span>
            {call.sim.agentVersion && <span className="pill">agent {call.sim.agentVersion}</span>}
            {call.sim.testProfile && <span className="pill">{call.sim.testProfile}</span>}
          </div>
        )}
        {call.error_message && <div className="detail-warning">⚠ {call.error_message.replace(/^CLIENT_WARNING:\s*/, '')}</div>}
        <div className="detail-links">
          <a className="btn" href={cekuraLink(call)} target="_blank" rel="noreferrer">{call.sim ? 'Open result in Cekura ↗' : 'Open in Cekura ↗'}</a>
          {prov && <a className="btn" href={prov.url} target="_blank" rel="noreferrer">Open in {prov.label} ↗</a>}
          {call.call_id && <CopyButton text={call.call_id} label={call.call_id} />}
          <CopyButton text={String(call.id)} label={call.sim ? `run #${call.id}` : `#${call.id}`} />
        </div>
        {recording && (
          <div className="audio-bar">
            <audio ref={audioRef} src={recording} controls preload="metadata" onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} />
            <div className="seg small">
              {[1, 1.5, 2].map((r) => <button key={r} className={rate === r ? 'on' : ''} onClick={() => setRate(r)}>{r}×</button>)}
            </div>
          </div>
        )}
      </header>

      <div className="detail-body">
        <section className="detail-metrics">
          {call.sim && detail && <ExpectedOutcome detail={detail} />}
          <MetricsPanel metrics={call.metrics} evaluation={detail?.evaluation?.metrics} />
          {!!detail?.rubric?.length && (
            <div className="rubric">
              <h3>Expected-outcome checks</h3>
              {detail.rubric.map((r) => (
                <div key={r.metric_id} className="metric">
                  <div className="metric-head">
                    <span className={`badge ${r.passed ? 'pass' : 'fail'}`}>{r.passed ? '✓' : '✗'}</span>
                    <span className="metric-name">{r.metric_name}</span>
                    <span className="muted small">{r.conditions}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="detail-main">
          <div className="tabs">
            <button className={tab === 'transcript' ? 'on' : ''} onClick={() => setTab('transcript')}>Transcript</button>
            <button className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>{call.sim ? 'Scenario & data' : 'Call data'}</button>
            <button className={tab === 'raw' ? 'on' : ''} onClick={() => setTab('raw')}>Raw JSON</button>
          </div>
          <div className="tab-body">
            {error && <div className="error">Failed to load call: {error}</div>}
            {!detail && !error && <div className="muted">Loading call…</div>}
            {detail && tab === 'transcript' && <Transcript detail={detail} currentTime={time} onSeek={seek} />}
            {detail && tab === 'data' && <CallData detail={detail} />}
            {detail && tab === 'raw' && <JsonView value={detail} defaultOpen={1} />}
          </div>
        </section>
      </div>
    </aside>
  )
}

const metricText = (call: CallLog, name: string) => {
  const m = call.metrics.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return typeof m?.enum === 'string' && m.enum.trim() ? m.enum.trim() : null
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() && v !== 'None' ? v.trim() : null)

/**
 * Who the call was between: live vs demo, the business and its line, and the caller. The metrics
 * carry these once a call is evaluated; until then (and for calls without those metrics) the
 * call's own dynamic variables do.
 */
function CallContext({ call, detail }: { call: CallLog; detail: Detail | null }) {
  const md = detail?.metadata ?? {}
  // Call logs expose dynamic variables directly; simulation runs only have them inside the
  // provider's metadata (ElevenLabs client data, or Retell's LLM variables).
  const dv: Record<string, unknown> = {
    ...md.provider_call_data?.retell_llm_dynamic_variables,
    ...md.conversation_initiation_client_data?.dynamic_variables,
    ...(detail?.dynamic_variables ?? {}),
  }
  const mode = (metricText(call, 'mode') ?? str(dv.mode) ?? str(dv.call_mode))?.toLowerCase() ?? null
  const business = metricText(call, 'Info: Business Name') ?? str(dv.business_name)
  const businessLine = metricText(call, 'to_number') ?? str(md.to_number) ?? str(dv.system__called_number) ?? str(detail?.agent_number)
  const caller = str(dv.original_incoming_phone_number) ?? str(call.customer_number)
  if (!mode && !business && !businessLine && !caller) return null
  return (
    <div className="detail-context">
      {mode && <span className={`mode-chip ${mode === 'live' ? 'live' : 'demo'}`}>{mode.toUpperCase()}</span>}
      {business && <span className="business-chip" title="Business">{business}</span>}
      {businessLine && (
        <span className="ctx-chip phone" title="The business number that was called">
          <span className="muted">Business line</span> {businessLine}<CopyIcon text={businessLine} title="Copy phone number" />
        </span>
      )}
      {caller && caller !== businessLine && (
        <span className="ctx-chip phone" title="The number the call came from">
          <span className="muted">Caller</span> {caller}<CopyIcon text={caller} title="Copy phone number" />
        </span>
      )}
    </div>
  )
}

function ExpectedOutcome({ detail }: { detail: Detail }) {
  const eo = detail.expected_outcome
  const lines = Array.isArray(eo?.explanation) ? eo.explanation : eo?.explanation ? [eo.explanation] : []
  const score = eo?.score
  // Outcomes that weren't fully met are the interesting ones, so only those start expanded.
  const [open, setOpen] = useState(typeof score !== 'number' || score < 100)
  if (!detail.expected_outcome_prompt && !eo) return null
  return (
    <div className="expected-outcome">
      <div className="metric-head" onClick={() => setOpen(!open)}>
        <span className="json-caret">{open ? '▾' : '▸'}</span>
        <span className="metric-name"><b>Expected outcome</b></span>
        <span className="spacer" />
        {typeof score === 'number' && <span className={`badge ${score >= 100 ? 'pass' : score > 0 ? 'warn' : 'fail'}`} title={`score ${score}`}>{expectedOutcomeLabel(score)}</span>}
      </div>
      {open && (
        <div className="metric-body">
          {detail.expected_outcome_prompt && <p className="eo-prompt">{detail.expected_outcome_prompt}</p>}
          {lines.map((l, i) => <p key={i}>{l}</p>)}
        </div>
      )}
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className="btn ghost mono" title="Copy" onClick={() => {
      navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1000)
    }}>{done ? 'Copied' : label} ⧉</button>
  )
}

type MetricFilter = 'all' | 'fail' | 'pass' | 'values' | 'na'

interface MergedMetric {
  m: CallMetric
  ev?: EvaluationMetric
  state: 'pass' | 'fail' | 'na' | 'value'
}

function metricState(m: CallMetric): MergedMetric['state'] {
  if (m.type === 'binary') return binaryValue(m) ?? 'na'
  if (m.extra?.trigger_failed) return 'na'
  if (m.type === 'enum') return m.enum == null ? 'na' : 'value'
  return typeof m.score === 'number' ? 'value' : 'na'
}

const STATE_ORDER = { fail: 0, pass: 1, value: 2, na: 3 }

function MetricsPanel({ metrics, evaluation }: { metrics: CallMetric[]; evaluation?: EvaluationMetric[] }) {
  const [filter, setFilter] = useState<MetricFilter>('all')
  const [q, setQ] = useState('')
  const [hideNa, setHideNa] = useState(true)

  const merged = useMemo(() => {
    const ev = new Map((evaluation ?? []).map((e) => [e.id, e]))
    return metrics
      .map((m): MergedMetric => ({ m, ev: ev.get(m.id), state: metricState(m) }))
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.m.name.localeCompare(b.m.name))
  }, [metrics, evaluation])

  const counts = { fail: 0, pass: 0, value: 0, na: 0 }
  merged.forEach((x) => counts[x.state]++)

  const shown = merged.filter((x) => {
    if (q && !x.m.name.toLowerCase().includes(q.toLowerCase())) return false
    if (filter === 'all') return !(hideNa && x.state === 'na')
    if (filter === 'values') return x.state === 'value'
    return x.state === filter
  })

  return (
    <div className="metrics-panel">
      <div className="metrics-controls">
        <div className="seg small">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All {metrics.length}</button>
          <button className={filter === 'fail' ? 'on' : ''} onClick={() => setFilter('fail')}>✗ {counts.fail}</button>
          <button className={filter === 'pass' ? 'on' : ''} onClick={() => setFilter('pass')}>✓ {counts.pass}</button>
          <button className={filter === 'values' ? 'on' : ''} onClick={() => setFilter('values')}>Values {counts.value}</button>
          <button className={filter === 'na' ? 'on' : ''} onClick={() => setFilter('na')}>N/A {counts.na}</button>
        </div>
        <input placeholder="Find metric…" value={q} onChange={(e) => setQ(e.target.value)} />
        {filter === 'all' && <label className="small"><input type="checkbox" checked={hideNa} onChange={(e) => setHideNa(e.target.checked)} /> hide N/A</label>}
      </div>
      {metrics.length === 0 && <div className="muted">No metrics yet (call may still be evaluating).</div>}
      {shown.map((x) => <MetricItem key={x.m.id} item={x} />)}
    </div>
  )
}

function MetricItem({ item: { m, ev, state } }: { item: MergedMetric }) {
  const [open, setOpen] = useState(state === 'fail')
  const expl = ev?.explanation
  const lines = Array.isArray(expl) ? expl : expl ? [expl] : []
  const extra = m.extra && Object.entries(m.extra).filter(([k, v]) =>
    k !== 'trigger_failed' && v != null && v !== '' && !(Array.isArray(v) && v.length === 0))

  let value
  if (m.type === 'binary') value = <BinaryBadge value={state === 'na' ? null : state} />
  else if (state === 'na') value = <span className="badge na">N/A</span>
  else if (m.type === 'enum') value = <span className="enum-val">{m.enum}</span>
  else value = <span className="num-val">{typeof m.score === 'number' ? Math.round(m.score * 100) / 100 : ''}</span>

  return (
    <div className={`metric ${state}`}>
      <div className="metric-head" onClick={() => setOpen(!open)}>
        <span className="json-caret">{lines.length || extra?.length ? (open ? '▾' : '▸') : ' '}</span>
        <span className="metric-name">{m.name}</span>
        <span className="spacer" />
        {value}
      </div>
      {open && (
        <div className="metric-body">
          {lines.map((l, i) => <p key={i}>{l}</p>)}
          {!ev && <p className="muted">Loading explanation…</p>}
          {!!extra?.length && <JsonView value={Object.fromEntries(extra)} defaultOpen={2} />}
        </div>
      )}
    </div>
  )
}

function CallData({ detail }: { detail: Detail }) {
  const md = detail.metadata ?? {}
  const summary = md.call_analysis?.call_summary ?? md.analysis?.transcript_summary
  const facts: [string, unknown][] = [
    ['Direction', md.direction],
    ['From', md.from_number ?? md.user_id],
    ['To', md.to_number],
    ['Agent version', md.agent_version ?? (detail.agent_version as any)?.version_id],
    ['Disconnection', md.disconnection_reason ?? md.ended_reason],
    ['User sentiment', md.call_analysis?.user_sentiment],
    ['Business ID', md.metadata?.business_id],
    ['Location ID', md.metadata?.location_id],
    ['Provider agent', md.visited_agents?.[0]?.agent_id ?? md.provider_call_data?.agent_id ?? (detail.provider_call_details as any)?.agent_id],
    ['Branch', md.branch_id],
    ['Trace ID', detail.trace_id],
  ]
  const toolCalls = md.tool_calls as { name: string; success: boolean; latency_ms: number; start_time_sec: number }[] | undefined
  const sections: [string, unknown][] = [
    ['Dynamic variables', detail.dynamic_variables ?? md.collected_dynamic_variables],
    ['Custom analysis', md.call_analysis?.custom_analysis_data ?? md.analysis?.data_collection_results],
    ['Latency', md.latency],
    ['Cost', md.call_cost ?? md.metadata?.cost],
    ['Provider metadata', md.metadata],
  ]

  return (
    <div className="call-data">
      {detail.scenario_instructions && <><h3>Scenario instructions</h3><p className="pre">{detail.scenario_instructions}</p></>}
      {summary && <><h3>Summary</h3><p>{summary}</p></>}
      <h3>Facts</h3>
      <div className="kv">
        {facts.filter(([, v]) => v != null && v !== '').map(([k, v]) => (
          <div key={k} className="kv-row"><span className="kv-k">{k}</span><span className="kv-v mono phone">{String(v)}{isPhoneNumber(v) && <CopyIcon text={String(v)} title="Copy phone number" />}</span></div>
        ))}
      </div>
      {!!toolCalls?.length && (
        <>
          <h3>Tool calls</h3>
          <table className="mini">
            <thead><tr><th>t</th><th>Tool</th><th>OK</th><th>Latency</th></tr></thead>
            <tbody>
              {toolCalls.map((t, i) => (
                <tr key={i} className={t.success ? '' : 'bad'}>
                  <td className="mono">{formatDuration(t.start_time_sec)}</td>
                  <td>{t.name}</td>
                  <td>{t.success ? '✓' : '✗'}</td>
                  <td className="mono">{Math.round(t.latency_ms)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {sections.filter(([, v]) => v != null).map(([k, v]) => (
        <div key={k}><h3>{k}</h3><JsonView value={v} defaultOpen={1} /></div>
      ))}
    </div>
  )
}
