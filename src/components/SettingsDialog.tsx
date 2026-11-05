import { useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../settings'

export function SettingsDialog({ settings, onSave, onClose, viewedCount, onClearViewed }: {
  settings: Settings; onSave: (s: Settings) => void; onClose: () => void
  viewedCount: number; onClearViewed: () => void
}) {
  const [s, setS] = useState(settings)
  const [confirmClear, setConfirmClear] = useState(false)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v })
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label>
          Cekura API key
          <input type="password" value={s.apiKey} placeholder={import.meta.env.DEV ? 'Leave empty to use CEKURA_API_KEY from .env.local' : 'Required'}
            onChange={(e) => set('apiKey', e.target.value.trim())} />
          <span className="muted small">Stored in this browser's localStorage only.</span>
        </label>
        <label>
          Max calls to load
          <input type="number" min={100} step={100} value={s.maxCalls} onChange={(e) => set('maxCalls', Number(e.target.value) || DEFAULT_SETTINGS.maxCalls)} />
        </label>
        <label>
          Retell call URL template
          <input value={s.retellUrl} onChange={(e) => set('retellUrl', e.target.value)} />
        </label>
        <label>
          ElevenLabs conversation URL template
          <input value={s.elevenlabsUrl} onChange={(e) => set('elevenlabsUrl', e.target.value)} />
          <span className="muted small">{'{call_id}'} is replaced with the provider call ID.</span>
        </label>
        <label>
          Datadog URL
          <input value={s.datadogUrl} onChange={(e) => set('datadogUrl', e.target.value)} />
          <span className="muted small">Base URL for the per-call Datadog log links.</span>
        </label>
        <label className="settings-check">
          <input type="checkbox" checked={s.autoRefresh} onChange={(e) => set('autoRefresh', e.target.checked)} />
          <span>
            Auto-refresh every 5 minutes
            <span className="muted small"> · only while the tab is visible; skips custom ranges that have already ended</span>
          </span>
        </label>
        <label className="settings-check">
          <input type="checkbox" checked={s.backgroundVariables} onChange={(e) => set('backgroundVariables', e.target.checked)} />
          <span>
            Load dynamic variables in the background
            <span className="muted small"> · 5-25KB per call; when off, load them from the link above the table</span>
          </span>
        </label>
        <label className="settings-check">
          <input type="checkbox" checked={s.backgroundTranscripts} onChange={(e) => set('backgroundTranscripts', e.target.checked)} />
          <span>
            Load transcripts in the background
            <span className="muted small"> · so search covers what was said (calls only; about 6KB per call)</span>
          </span>
        </label>
        <div className="settings-viewed">
          <div>
            Viewed history
            <div className="muted small">{viewedCount.toLocaleString()} call{viewedCount === 1 ? '' : 's'} marked viewed in this browser (kept for 60 days).</div>
          </div>
          <span className="spacer" />
          {confirmClear
            ? <><button className="btn danger" onClick={() => { onClearViewed(); setConfirmClear(false) }}>Clear all</button><button className="btn ghost" onClick={() => setConfirmClear(false)}>Keep</button></>
            : <button className="btn" disabled={!viewedCount} onClick={() => setConfirmClear(true)}>Clear viewed history</button>}
        </div>
        <div className="modal-actions">
          <button className="link" onClick={() => setS({ ...DEFAULT_SETTINGS, apiKey: s.apiKey })}>Reset defaults</button>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => { onSave(s); onClose() }}>Save</button>
        </div>
      </div>
    </div>
  )
}
