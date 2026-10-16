import { useState } from 'react'
import { describeView, type SavedView } from '../views'

interface Props {
  views: SavedView[]
  activeId: string | null
  modified: boolean
  onApply: (v: SavedView) => void
  onSaveNew: (name: string, includeQuery: boolean) => void
  onUpdate: () => void
  onRevert: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onCopyLink: () => void
  onReset: () => void
  storage: 'pending' | 'file' | 'unavailable' | 'error'
}

export function ViewsMenu(p: Props) {
  const active = p.views.find((v) => v.id === p.activeId)
  const [name, setName] = useState('')
  const [includeQuery, setIncludeQuery] = useState(!!active?.query)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const trimmed = name.trim()
  const clash = p.views.some((v) => v.name.toLowerCase() === trimmed.toLowerCase())
  const saveNew = () => {
    if (!trimmed || clash) return
    p.onSaveNew(trimmed, includeQuery)
    setName('')
  }
  const commitRename = () => {
    if (renaming && renameText.trim()) p.onRename(renaming, renameText.trim())
    setRenaming(null)
  }

  return (
    <div className="views-menu">
      {active && p.modified && (
        <div className="views-dirty">
          <div><b>{active.name}</b> has unsaved changes</div>
          <div className="views-dirty-actions">
            <button className="btn primary" onClick={p.onUpdate}>Save changes</button>
            <button className="btn ghost" onClick={p.onRevert}>Revert</button>
          </div>
        </div>
      )}

      <div className="views-section-title">Saved views</div>
      {p.views.length === 0 && <div className="muted small views-empty">None yet. Set up columns, filters and sorting, then save them below.</div>}
      <div className="views-list">
        {p.views.map((v) => (
          <div key={v.id} className={`views-item ${v.id === p.activeId ? 'active' : ''}`}>
            {renaming === v.id ? (
              <input autoFocus className="views-rename" value={renameText} onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null) } }}
                onBlur={commitRename} />
            ) : (
              <button className="views-item-main" onClick={() => p.onApply(v)}>
                <span className="views-item-name">
                  {v.id === p.activeId && <span className="views-check">✓</span>}
                  {v.name}
                  {v.id === p.activeId && p.modified && <span className="views-mod">modified</span>}
                </span>
                <span className="views-item-meta">{describeView(v)}</span>
              </button>
            )}
            <span className="views-item-actions">
              {confirmDelete === v.id ? (
                <>
                  <button className="danger" onClick={() => { p.onDelete(v.id); setConfirmDelete(null) }}>Delete</button>
                  <button onClick={() => setConfirmDelete(null)}>Keep</button>
                </>
              ) : (
                <>
                  <button title="Rename" onClick={() => { setRenaming(v.id); setRenameText(v.name) }}>✎</button>
                  <button title="Delete" onClick={() => setConfirmDelete(v.id)}>🗑</button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="views-section-title">Save current setup as a new view</div>
      <div className="views-save">
        <input placeholder="View name, e.g. Failed bookings" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveNew()} />
        <button className="btn primary" disabled={!trimmed || clash} onClick={saveNew}>Save</button>
      </div>
      {clash && <div className="small bad">A view with that name already exists.</div>}
      <label className="views-include small">
        <input type="checkbox" checked={includeQuery} onChange={(e) => setIncludeQuery(e.target.checked)} />
        Also save the project, agent and time range (opening the view reloads calls)
      </label>

      <div className={`views-storage small ${p.storage === 'error' ? 'bad' : 'muted'}`}>
        {p.storage === 'file' && 'Saved to views.json in the app folder'}
        {p.storage === 'pending' && 'Reading views.json…'}
        {p.storage === 'unavailable' && 'views.json is only available under pnpm dev; saving to this browser instead'}
        {p.storage === 'error' && "Couldn't write views.json; changes are kept in this browser for now"}
      </div>

      <div className="views-footer">
        <button className="link" onClick={() => { p.onCopyLink(); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
          {copied ? 'Link copied' : 'Copy link to current setup'}
        </button>
        <button className="link" onClick={p.onReset}>Reset to default</button>
      </div>
    </div>
  )
}
