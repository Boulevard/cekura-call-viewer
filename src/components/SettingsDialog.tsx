import { useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../settings'

export function SettingsDialog({ settings, onSave, onClose }: { settings: Settings; onSave: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState(settings)
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
