import { useMemo, useState } from 'react'
import type { Project } from '../api'
import { Popover } from './Popover'

interface Props {
  projects: Project[]
  value: number
  onChange: (id: number) => void
}

/** Same shape as Cekura's own project switcher: an ID chip plus name, opening a searchable list. */
export function ProjectPicker({ projects, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const current = projects.find((p) => p.id === value)
  const org = current?.organization ?? projects[0]?.organization

  const matches = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return ql ? projects.filter((p) => p.name.toLowerCase().includes(ql) || String(p.id).includes(ql)) : projects
  }, [projects, q])

  const pick = (id: number) => {
    setOpen(false)
    setQ('')
    if (id !== value) onChange(id)
  }

  return (
    <div className="popover-anchor project-picker">
      <button className="project-btn" onClick={() => setOpen(true)} title="Switch Cekura project">
        {org && <><span className="project-org">{org}</span><span className="project-sep">/</span></>}
        <span className="project-id">{value}</span>
        <span className="project-name">{current?.name ?? 'Project'}</span>
        <span className="project-caret">⇅</span>
      </button>
      {open && (
        <Popover onClose={() => { setOpen(false); setQ('') }} className="project-popover">
          <div className="project-pop-title">Projects</div>
          <div className="project-search">
            <span className="project-search-icon">⌕</span>
            <input autoFocus placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) pick(matches[0].id) }} />
          </div>
          <div className="project-list">
            {matches.map((p) => (
              <button key={p.id} className={`project-item ${p.id === value ? 'on' : ''}`} onClick={() => pick(p.id)}>
                <span className="project-id">{p.id}</span>
                <span className="ellipsis">{p.name}</span>
              </button>
            ))}
            {matches.length === 0 && <div className="muted project-empty">{projects.length ? 'No projects match.' : 'Loading projects…'}</div>}
          </div>
        </Popover>
      )}
    </div>
  )
}
