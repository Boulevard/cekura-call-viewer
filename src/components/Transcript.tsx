import { useMemo, useState, type ReactNode } from 'react'
import type { CallDetail } from '../types'
import { JsonView, tryParseJson } from './JsonView'
import { formatDuration } from '../columns'

type Item =
  | { kind: 'agent' | 'user'; text: string; start?: number }
  | { kind: 'tool'; id?: string; name: string; args?: string; result?: string; start?: number; ok?: boolean }
  | { kind: 'node'; from?: string; to: string; start?: number }

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
      if (t) t.result = e.data?.result
      else items.push({ kind: 'tool', name: e.data?.name ?? 'tool result', result: e.data?.result, start: e.start_time })
    }
  }
  return items
}

/** Retell's own transcript also carries node transitions and tool success flags. */
function fromRetell(d: CallDetail): Item[] | null {
  const raw = d.metadata?.transcript_with_tool_calls as any[] | undefined
  if (!Array.isArray(raw)) return null
  const items: Item[] = []
  const tools = new Map<string, Extract<Item, { kind: 'tool' }>>()
  for (const e of raw) {
    switch (e.role) {
      case 'agent':
      case 'user':
        items.push({ kind: e.role, text: e.content ?? '', start: e.words?.[0]?.start })
        break
      case 'tool_call_invocation': {
        const t: Item = { kind: 'tool', id: e.tool_call_id, name: e.name, args: e.arguments, start: e.time_sec }
        tools.set(e.tool_call_id, t)
        items.push(t)
        break
      }
      case 'tool_call_result': {
        const t = tools.get(e.tool_call_id)
        if (t) { t.result = e.content; t.ok = e.successful }
        break
      }
      case 'node_transition':
        items.push({ kind: 'node', from: e.former_node_name, to: e.new_node_name, start: e.time_sec })
        break
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

export function Transcript({ detail, currentTime, onSeek }: { detail: CallDetail; currentTime: number; onSeek: (t: number) => void }) {
  const retell = useMemo(() => { const r = fromRetell(detail); return r && withToolStatus(r, detail) }, [detail])
  const cekura = useMemo(() => withToolStatus(fromCekura(detail), detail), [detail])
  const [source, setSource] = useState<'cekura' | 'retell'>('cekura')
  const [showTools, setShowTools] = useState(true)
  const [showNodes, setShowNodes] = useState(false)
  const [q, setQ] = useState('')

  const items = (source === 'retell' && retell) || cekura
  const visible = items.filter((it) => (it.kind !== 'tool' || showTools) && (it.kind !== 'node' || showNodes))

  // The line being spoken is the last speech turn that started before the playhead.
  let active = -1
  visible.forEach((it, i) => {
    if ((it.kind === 'agent' || it.kind === 'user') && it.start != null && it.start <= currentTime) active = i
  })

  if (items.length === 0) {
    return <pre className="raw-transcript">{detail.transcript || 'No transcript.'}</pre>
  }

  return (
    <div className="transcript">
      <div className="transcript-controls">
        <input placeholder="Find in transcript…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label><input type="checkbox" checked={showTools} onChange={(e) => setShowTools(e.target.checked)} /> tool calls</label>
        {retell && (
          <>
            <label><input type="checkbox" checked={showNodes && source === 'retell'} disabled={source !== 'retell'} onChange={(e) => setShowNodes(e.target.checked)} /> nodes</label>
            <div className="seg small">
              <button className={source === 'cekura' ? 'on' : ''} onClick={() => setSource('cekura')}>Cekura</button>
              <button className={source === 'retell' ? 'on' : ''} onClick={() => setSource('retell')}>Retell</button>
            </div>
          </>
        )}
      </div>
      <div className="transcript-items">
        {visible.map((it, i) => {
          const ts = it.start != null && (
            <button className="ts" onClick={() => onSeek(it.start!)} title="Play from here">{formatDuration(it.start)}</button>
          )
          if (it.kind === 'node') {
            return <div key={i} className="t-node">{ts} → <b>{highlight(it.to, q)}</b></div>
          }
          if (it.kind === 'tool') return <ToolItem key={i} item={it} ts={ts} q={q} />
          return (
            <div key={i} className={`t-msg ${it.kind} ${i === active ? 'active' : ''}`}>
              <div className="t-who">{it.kind === 'agent' ? 'Agent' : 'Caller'} {ts}</div>
              <div className="t-text">{highlight(it.text, q)}</div>
            </div>
          )
        })}
      </div>
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
