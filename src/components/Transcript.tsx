import { useMemo, useState, type ReactNode } from 'react'
import type { CallDetail } from '../types'
import { JsonView, tryParseJson } from './JsonView'
import { formatDuration } from '../columns'

/** One part of the wait before an agent turn: speech recognition, an LLM call, a tool, or TTS. */
interface Step { label: string; secs: number; kind: 'asr' | 'llm' | 'tool' | 'tts' | 'other' }

/**
 * How long the caller waited for this agent turn, from when they stopped talking to the agent's
 * first audio, including any tool calls in between.
 */
interface TurnLatency { total: number; steps: Step[] }

type Item =
  | { kind: 'agent' | 'user'; text: string; start?: number; latency?: TurnLatency }
  | {
    kind: 'tool'; id?: string; name: string; args?: string; result?: string; start?: number; ok?: boolean
    /** How long the tool ran, and (ElevenLabs only) how long the LLM took to decide to call it. */
    secs?: number; llmSecs?: number
  }
  | { kind: 'node'; from?: string; to: string; start?: number }

/** Whatever part of the total the provider doesn't break down (turn detection, network, audio buffering). */
function withRemainder(total: number, steps: Step[], label = 'Other'): TurnLatency {
  const rest = total - steps.reduce((a, s) => a + s.secs, 0)
  return { total, steps: rest >= 0.05 ? [...steps, { label, secs: rest, kind: 'other' }] : steps }
}

function fromCekura(d: CallDetail): Item[] {
  const items: Item[] = []
  const tools = new Map<string, Extract<Item, { kind: 'tool' }>>()
  for (const e of d.transcript_object ?? []) {
    if (e.role === 'Main Agent' || e.role === 'Testing Agent') {
      items.push({ kind: e.role === 'Main Agent' ? 'agent' : 'user', text: e.content ?? '', start: e.start_time })
    } else if (e.role === 'Function Call') {
      const t: Item = { kind: 'tool', id: e.data?.id, name: e.data?.name ?? 'tool', args: e.data?.arguments, start: e.start_time }
      if (t.id) tools.set(t.id, t)
      items.push(t)
    } else if (e.role === 'Function Call Result') {
      const t = e.data?.id ? tools.get(e.data.id) : undefined
      if (t) {
        t.result = e.data?.result
        if (e.data?.is_error != null) t.ok = !e.data.is_error
      } else items.push({ kind: 'tool', name: e.data?.name ?? 'tool result', result: e.data?.result, start: e.start_time })
    }
  }
  return items
}

/**
 * Retell's own transcript also carries node transitions and tool success flags. Its word and tool
 * timestamps give each agent turn's latency: the gap after the caller's last word, minus the
 * tools that ran in it.
 */
function fromRetell(d: CallDetail): Item[] | null {
  const raw = d.metadata?.transcript_with_tool_calls as any[] | undefined
  if (!Array.isArray(raw)) return null
  const items: Item[] = []
  const tools = new Map<string, Extract<Item, { kind: 'tool' }>>()
  let userEnd: number | null = null
  let toolSteps: Step[] = []
  for (const e of raw) {
    switch (e.role) {
      case 'agent':
      case 'user': {
        const start = e.words?.[0]?.start
        const item: Item = { kind: e.role, text: e.content ?? '', start }
        if (e.role === 'user') {
          userEnd = e.words?.at(-1)?.end ?? null
          toolSteps = []
        } else if (userEnd != null && start != null && start >= userEnd) {
          item.latency = withRemainder(start - userEnd, toolSteps, 'LLM + TTS')
          userEnd = null
        }
        items.push(item)
        break
      }
      case 'tool_call_invocation': {
        const t: Item = { kind: 'tool', id: e.tool_call_id, name: e.name, args: e.arguments, start: e.time_sec }
        tools.set(e.tool_call_id, t)
        items.push(t)
        break
      }
      case 'tool_call_result': {
        const t = tools.get(e.tool_call_id)
        if (t) {
          t.result = e.content
          t.ok = e.successful
          if (t.start != null && e.time_sec != null) {
            t.secs = e.time_sec - t.start
            if (userEnd != null) toolSteps.push({ label: t.name, secs: t.secs, kind: 'tool' })
          }
        }
        break
      }
      case 'node_transition':
        items.push({ kind: 'node', from: e.former_node_name, to: e.new_node_name, start: e.time_sec })
        break
    }
  }
  return items
}

const elapsed = (e: any, name: string): number | undefined => e.conversation_turn_metrics?.metrics?.[`convai_${name}`]?.elapsed_time

/**
 * ElevenLabs' transcript, with its per-turn metrics: ASR, every LLM call (including the ones that
 * only decide to call a tool), each tool's run time and TTS. `ttf_audio_since_silence` is the
 * whole wait, from the caller going quiet to the agent's first audio.
 */
function fromElevenLabs(raw: Record<string, any> | null | undefined): Item[] | null {
  const entries = raw?.transcript as any[] | undefined
  if (!Array.isArray(entries) || entries.length === 0) return null
  const items: Item[] = []
  const tools = new Map<string, Extract<Item, { kind: 'tool' }>>()
  let steps: Step[] = []
  for (const e of entries) {
    if (e.role === 'user') {
      if (e.message) items.push({ kind: 'user', text: e.message, start: e.time_in_call_secs })
      const asr = elapsed(e, 'asr_trailing_service_latency')
      steps = asr != null ? [{ label: 'Speech recognition', secs: asr, kind: 'asr' }] : []
      continue
    }
    if (e.tool_calls?.length) {
      const llm = elapsed(e, 'llm_tool_request_generation_latency') ?? (e.message ? undefined : elapsed(e, 'llm_service_ttfb'))
      for (const c of e.tool_calls) {
        const t: Item = { kind: 'tool', id: c.request_id, name: c.tool_name, args: c.params_as_json, start: e.time_in_call_secs, llmSecs: llm }
        tools.set(c.request_id, t)
        items.push(t)
      }
      // One LLM call can request several tools; it's counted once.
      if (llm != null && !e.message) steps.push({ label: `LLM → ${e.tool_calls.map((c: any) => c.tool_name).join(', ')}`, secs: llm, kind: 'llm' })
    }
    for (const r of e.tool_results ?? []) {
      const t = tools.get(r.request_id)
      const secs = r.tool_latency_secs as number | undefined
      if (t) {
        t.result = r.result_value
        t.ok = !r.is_error
        t.secs = secs
      } else items.push({ kind: 'tool', name: r.tool_name, result: r.result_value, ok: !r.is_error, start: e.time_in_call_secs, secs })
      if (secs != null) steps.push({ label: r.tool_name, secs, kind: 'tool' })
    }
    if (e.message) {
      const item: Item = { kind: 'agent', text: e.message, start: e.time_in_call_secs }
      const total = elapsed(e, 'ttf_audio_since_silence')
      if (total != null) {
        const llm = elapsed(e, 'llm_service_ttfb')
        const tts = elapsed(e, 'tts_service_ttfb')
        item.latency = withRemainder(total, [
          ...steps,
          ...(llm != null ? [{ label: 'LLM (first token)', secs: llm, kind: 'llm' as const }] : []),
          ...(tts != null ? [{ label: 'TTS (first audio)', secs: tts, kind: 'tts' as const }] : []),
        ], 'Other (turn detection, streaming)')
      }
      items.push(item)
      steps = []
    }
  }
  return items
}

function highlight(text: string, q: string): ReactNode {
  if (!q) return text
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))
}

// Cekura's transcript has no success flag on tool calls, but Retell's metadata does.
function withToolStatus(items: Item[], d: CallDetail): Item[] {
  const calls = d.metadata?.tool_calls as { tool_call_id?: string; success?: boolean }[] | undefined
  if (!Array.isArray(calls)) return items
  const ok = new Map(calls.map((c) => [c.tool_call_id, c.success]))
  for (const it of items) if (it.kind === 'tool' && it.ok == null && it.id && ok.has(it.id)) it.ok = ok.get(it.id)
  return items
}

interface Props {
  detail: CallDetail
  /** The raw ElevenLabs conversation, when this is an ElevenLabs call and it could be fetched. */
  elevenLabs?: Record<string, any> | null
  currentTime: number
  onSeek: (t: number) => void
}

export function Transcript({ detail, elevenLabs, currentTime, onSeek }: Props) {
  const retell = useMemo(() => { const r = fromRetell(detail); return r && withToolStatus(r, detail) }, [detail])
  const el = useMemo(() => fromElevenLabs(elevenLabs), [elevenLabs])
  const cekura = useMemo(() => withToolStatus(fromCekura(detail), detail), [detail])
  const provider = retell ?? el
  const providerName = retell ? 'Retell' : 'ElevenLabs'
  // The provider's transcript is preferred because it has the timings; Cekura's stays one click away.
  const [source, setSource] = useState<'cekura' | 'provider' | null>(null)
  const [showTools, setShowTools] = useState(true)
  const [showNodes, setShowNodes] = useState(false)
  const [q, setQ] = useState('')

  const useProvider = !!provider && (source === 'provider' || (source == null && (provider.length > 0 || cekura.length === 0)))
  const items = (useProvider && provider) || cekura
  const visible = items.filter((it) => (it.kind !== 'tool' || showTools) && (it.kind !== 'node' || showNodes))

  // The line being spoken is the last speech turn that started before the playhead.
  let active = -1
  visible.forEach((it, i) => {
    if ((it.kind === 'agent' || it.kind === 'user') && it.start != null && it.start <= currentTime) active = i
  })

  if (items.length === 0) {
    return <pre className="raw-transcript">{detail.transcript || 'No transcript.'}</pre>
  }
  const latencies = items.flatMap((it) => (it.kind === 'agent' && it.latency ? [it.latency.total] : []))

  return (
    <div className="transcript">
      <div className="transcript-controls">
        <input placeholder="Find in transcript…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label><input type="checkbox" checked={showTools} onChange={(e) => setShowTools(e.target.checked)} /> tool calls</label>
        {retell && <label><input type="checkbox" checked={showNodes && useProvider} disabled={!useProvider} onChange={(e) => setShowNodes(e.target.checked)} /> nodes</label>}
        {provider && cekura.length > 0 && (
          <div className="seg small">
            <button className={!useProvider ? 'on' : ''} onClick={() => setSource('cekura')}>Cekura</button>
            <button className={useProvider ? 'on' : ''} onClick={() => setSource('provider')} title="Has per-turn latency">{providerName}</button>
          </div>
        )}
      </div>
      {latencies.length > 0 && <LatencySummary values={latencies} />}
      {!useProvider && <div className="muted small latency-hint">Per-turn latency comes from the {provider ? providerName : 'provider'} transcript{provider ? '' : ', which isn’t available for this call'}.</div>}
      <div className="transcript-items">
        {visible.map((it, i) => {
          const ts = it.start != null && (
            <button className="ts" onClick={() => onSeek(it.start!)} title="Play from here">{formatDuration(it.start)}</button>
          )
          if (it.kind === 'node') {
            return <div key={i} className="t-node">{ts} → <b>{highlight(it.to, q)}</b></div>
          }
          if (it.kind === 'tool') return <ToolItem key={i} item={it} ts={ts} q={q} />
          return <Message key={i} item={it} ts={ts} q={q} active={i === active} />
        })}
      </div>
    </div>
  )
}

function Message({ item, ts, q, active }: { item: Extract<Item, { kind: 'agent' | 'user' }>; ts: ReactNode; q: string; active: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`t-msg ${item.kind} ${active ? 'active' : ''}`}>
      <div className="t-who">
        {item.kind === 'agent' ? 'Agent' : 'Caller'} {ts}
        {item.latency && (
          <button className={`lat-chip ${latencyClass(item.latency.total)}`} onClick={() => setOpen(!open)}
            title="Time from the caller going quiet to the agent's first audio. Click for the breakdown.">
            ⏱ {secs(item.latency.total)}
          </button>
        )}
      </div>
      {open && item.latency && <LatencyBreakdown latency={item.latency} />}
      <div className="t-text">{highlight(item.text, q)}</div>
    </div>
  )
}

function ToolItem({ item, ts, q }: { item: Extract<Item, { kind: 'tool' }>; ts: ReactNode; q: string }) {
  const [open, setOpen] = useState(false)
  const args = tryParseJson(item.args)
  const argsEmpty = !item.args || item.args === '{}'
  return (
    <div className={`t-tool ${item.ok === false ? 'failed' : ''}`}>
      <div className="t-tool-head" onClick={() => setOpen(!open)}>
        <span className="json-caret">{open ? '▾' : '▸'}</span>
        <span className="t-tool-name">ƒ {highlight(item.name, q)}</span>
        {item.ok === false && <span className="badge fail">failed</span>}
        {!open && !argsEmpty && <span className="t-tool-preview">{String(item.args).slice(0, 120)}</span>}
        <span className="spacer" />
        {item.llmSecs != null && <span className="t-tool-time muted" title="Time the LLM took to decide to call this tool">LLM {secs(item.llmSecs)}</span>}
        {item.secs != null && <span className={`t-tool-time ${latencyClass(item.secs)}`} title="Time the tool took to run">{secs(item.secs)}</span>}
        {ts}
      </div>
      {open && (
        <div className="t-tool-body">
          {!argsEmpty && <><div className="t-tool-label">Arguments</div><JsonView value={args} defaultOpen={3} /></>}
          <div className="t-tool-label">Result</div>
          {item.result != null ? <JsonView value={item.result} defaultOpen={2} /> : <div className="muted">No result</div>}
        </div>
      )}
    </div>
  )
}

const secs = (n: number) => `${n < 10 ? n.toFixed(2) : n.toFixed(1)}s`
// Rough bands for how a pause feels on a phone call.
const latencyClass = (n: number) => (n < 2 ? 'lat-good' : n < 4 ? 'lat-warn' : 'lat-bad')

function LatencyBreakdown({ latency }: { latency: TurnLatency }) {
  return (
    <div className="lat-breakdown">
      <div className="lat-bar">
        {latency.steps.map((s, i) => (
          <span key={i} className={`lat-seg ${s.kind}`} style={{ flexGrow: Math.max(s.secs, 0.001) }} title={`${s.label}: ${secs(s.secs)}`} />
        ))}
      </div>
      {latency.steps.map((s, i) => (
        <div key={i} className="lat-step">
          <span className={`lat-dot ${s.kind}`} />
          <span className="ellipsis">{s.label}</span>
          <span className="spacer" />
          <span className="mono">{secs(s.secs)}</span>
        </div>
      ))}
    </div>
  )
}

function LatencySummary({ values }: { values: number[] }) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  const slow = values.filter((v) => v >= 4).length
  return (
    <div className="latency-summary">
      <span className="muted">Response latency</span>
      <span>median <b className={latencyClass(at(0.5))}>{secs(at(0.5))}</b></span>
      <span>p90 <b className={latencyClass(at(0.9))}>{secs(at(0.9))}</b></span>
      <span>max <b className={latencyClass(sorted.at(-1)!)}>{secs(sorted.at(-1)!)}</b></span>
      <span className="muted">{values.length} turn{values.length === 1 ? '' : 's'}{slow ? ` · ${slow} over 4s` : ''}</span>
    </div>
  )
}
