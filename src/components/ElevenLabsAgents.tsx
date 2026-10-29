import { useEffect, useMemo, useState } from 'react'
import { listAgents } from '../elevenlabs'
import { Popover } from './Popover'

/** Which ElevenLabs agents the 11Labs source scans, relative to the project's own agents. */
export interface ElevenLabsAgentChoice {
  /** Agents beyond the ones the project's Cekura agents point to. */
  extra: string[]
  /** Project agents left out. */
  skip: string[]
}

interface Props {
  /** ElevenLabs agents the project's Cekura agents point to; in by default. */
  projectAgents: Map<string, { id: number; name: string }>
  value: ElevenLabsAgentChoice
  onChange: (value: ElevenLabsAgentChoice) => void
}

const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join()

/**
 * Picks which ElevenLabs agents the 11Labs source scans. The project's own agents start ticked and
 * any other agent in the workspace (a staging build, a new agent Cekura isn't set up for) can be
 * added; "Only" narrows it to one agent. Changes apply when the menu closes, so ticking several
 * agents reloads once.
 */
export function ElevenLabsAgents({ projectAgents, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [extra, setExtra] = useState<string[]>(value.extra)
  const [skip, setSkip] = useState<string[]>(value.skip)
  const [agents, setAgents] = useState<{ id: string; name: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!open || agents) return
    listAgents().then(setAgents, (e) => setError(String(e.message ?? e)))
  }, [open, agents])

  const names = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a.name])), [agents])
  const ql = q.trim().toLowerCase()
  const matches = (id: string, name: string) => !ql || id.toLowerCase().includes(ql) || name.toLowerCase().includes(ql)
  const others = (agents ?? [])
    .filter((a) => !projectAgents.has(a.id) && matches(a.id, a.name))
    .sort((a, b) => Number(extra.includes(b.id)) - Number(extra.includes(a.id)) || a.name.localeCompare(b.name))
  const fromProject = [...projectAgents]
    .map(([id, a]) => ({ id, name: names.get(id) ?? a.name }))
    .filter((a) => matches(a.id, a.name))

  const isOn = (id: string) => (projectAgents.has(id) ? !skip.includes(id) : extra.includes(id))
  const toggle = (id: string) => {
    if (projectAgents.has(id)) setSkip((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    else setExtra((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))
  }
  const only = (id: string) => {
    setSkip([...projectAgents.keys()].filter((x) => x !== id))
    setExtra(projectAgents.has(id) ? [] : [id])
  }
  const close = () => {
    setOpen(false)
    setQ('')
    if (!same(extra, value.extra) || !same(skip, value.skip)) onChange({ extra, skip })
  }

  const count = projectAgents.size - value.skip.filter((id) => projectAgents.has(id)).length + value.extra.length
  const customized = value.extra.length > 0 || value.skip.length > 0
  const pendingCount = projectAgents.size - skip.filter((id) => projectAgents.has(id)).length + extra.length
  const row = (a: { id: string; name: string }) => (
    <label key={a.id} className={`quick-item ${isOn(a.id) ? 'on' : ''}`} title={a.id}>
      <input type="checkbox" checked={isOn(a.id)} onChange={() => toggle(a.id)} />
      <span className="ellipsis">{a.name}</span>
      <button className="link quick-exclude" title="Load only this agent" onClick={(e) => { e.preventDefault(); only(a.id) }}>Only</button>
    </label>
  )

  return (
    <div className="popover-anchor">
      <button className={`btn quick-btn ${customized ? 'active' : ''}`} title="Which ElevenLabs agents the 11Labs source loads"
        onClick={() => { setExtra(value.extra); setSkip(value.skip); setOpen(true) }}>
        <span className="ellipsis">11Labs: {customized ? `${count} agent${count === 1 ? '' : 's'}` : 'Agents'}</span><span className="muted">▾</span>
      </button>
      {open && (
        <Popover onClose={close} className="quick-popover">
          <input autoFocus className="quick-search" placeholder="Search ElevenLabs agents by name or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="quick-list">
            {fromProject.length > 0 && <div className="quick-heading">In this Cekura project</div>}
            {fromProject.map(row)}
            <div className="quick-heading">Other ElevenLabs agents</div>
            {error && <div className="ids-missing">{error}</div>}
            {!agents && !error && <div className="muted quick-empty">Loading agents…</div>}
            {others.map(row)}
            {agents && others.length === 0 && <div className="muted quick-empty">No other agents match.</div>}
          </div>
          <div className="quick-footer">
            <span className="muted small">
              {pendingCount === 0 ? 'No agents: nothing will load' : `${pendingCount} agent${pendingCount === 1 ? '' : 's'} · loads when this closes`}
            </span>
            <span className="spacer" />
            {(extra.length > 0 || skip.length > 0) && <button className="link" onClick={() => { setExtra([]); setSkip([]) }}>Reset</button>}
          </div>
        </Popover>
      )}
    </div>
  )
}
