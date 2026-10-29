import { useEffect, useMemo, useState } from 'react'
import { listAgents } from '../elevenlabs'
import { Popover } from './Popover'

interface Props {
  /** ElevenLabs agents the project's Cekura agents point to; always included. */
  projectAgents: Map<string, { id: number; name: string }>
  extra: string[]
  onChange: (extra: string[]) => void
}

/**
 * Picks which ElevenLabs agents the 11Labs source scans. The project's own agents are always in;
 * any other agent in the workspace (a staging build, a new agent Cekura isn't set up for) can be
 * added. Changes apply when the menu closes, so ticking several agents reloads once.
 */
export function ElevenLabsAgents({ projectAgents, extra, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>(extra)
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
    .sort((a, b) => Number(picked.includes(b.id)) - Number(picked.includes(a.id)) || a.name.localeCompare(b.name))
  const fromProject = [...projectAgents].filter(([id, a]) => matches(id, names.get(id) ?? a.name))

  const close = () => {
    setOpen(false)
    setQ('')
    if ([...picked].sort().join() !== [...extra].sort().join()) onChange(picked)
  }
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const label = extra.length ? `+${extra.length} agent${extra.length > 1 ? 's' : ''}` : 'Agents'

  return (
    <div className="popover-anchor">
      <button className={`btn quick-btn ${extra.length ? 'active' : ''}`} title="Which ElevenLabs agents the 11Labs source loads"
        onClick={() => { setPicked(extra); setOpen(true) }}>
        <span className="ellipsis">11Labs: {label}</span><span className="muted">▾</span>
      </button>
      {open && (
        <Popover onClose={close} className="quick-popover">
          <input autoFocus className="quick-search" placeholder="Search ElevenLabs agents by name or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="quick-list">
            {fromProject.length > 0 && <div className="quick-heading">In this Cekura project</div>}
            {fromProject.map(([id, a]) => (
              <label key={id} className="quick-item on" title={id}>
                <input type="checkbox" checked disabled />
                <span className="ellipsis">{names.get(id) ?? a.name}</span>
              </label>
            ))}
            <div className="quick-heading">Other ElevenLabs agents</div>
            {error && <div className="ids-missing">{error}</div>}
            {!agents && !error && <div className="muted quick-empty">Loading agents…</div>}
            {others.map((a) => (
              <label key={a.id} className={`quick-item ${picked.includes(a.id) ? 'on' : ''}`} title={a.id}>
                <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} />
                <span className="ellipsis">{a.name}</span>
              </label>
            ))}
            {agents && others.length === 0 && <div className="muted quick-empty">No other agents match.</div>}
          </div>
          <div className="quick-footer">
            <span className="muted small">{picked.length ? `${picked.length} added · loads when this closes` : 'Only the project\u2019s agents'}</span>
            <span className="spacer" />
            {picked.length > 0 && <button className="link" onClick={() => setPicked([])}>Clear</button>}
          </div>
        </Popover>
      )}
    </div>
  )
}
