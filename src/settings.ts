import { load, save } from './storage'
import type { CallLog } from './types'

export interface Settings {
  /** Optional. When empty in dev, the Vite proxy injects CEKURA_API_KEY from .env.local. */
  apiKey: string
  maxCalls: number
  retellUrl: string
  elevenlabsUrl: string
  datadogUrl: string
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  maxCalls: 10000,
  retellUrl: 'https://dashboard.retellai.com/call-history?history={call_id}',
  elevenlabsUrl: 'https://elevenlabs.io/app/agents/history/{call_id}',
  datadogUrl: 'https://app.datadoghq.com',
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('settings', {}) }
}

export function saveSettings(s: Settings) {
  save('settings', s)
}

export type Provider = 'retell' | 'elevenlabs' | 'unknown'

export function providerOf(callId: string): Provider {
  if (callId.startsWith('conv_')) return 'elevenlabs'
  if (callId.startsWith('call_')) return 'retell'
  return 'unknown'
}

export function providerLink(settings: Settings, callId: string): { label: string; url: string } | null {
  const p = providerOf(callId)
  if (p === 'unknown') return null
  const template = p === 'retell' ? settings.retellUrl : settings.elevenlabsUrl
  return {
    label: p === 'retell' ? 'Retell' : '11Labs',
    url: template.replace('{call_id}', encodeURIComponent(callId)),
  }
}

/** Calls open directly; simulation runs open their parent result, which lists the run. */
export function cekuraLink(c: CallLog) {
  return c.sim
    ? `https://dashboard.cekura.ai/${c.project}/results/${c.sim.resultId}`
    : `https://dashboard.cekura.ai/${c.project}/calls?callId=${c.id}`
}
