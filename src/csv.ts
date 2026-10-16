import { formatCell, type Column, type Row } from './columns'
import { cekuraLink, providerLink, type Settings } from './settings'

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function downloadCsv(rows: Row[], columns: Column[], settings: Settings) {
  const cols = columns.filter((c) => c.kind !== 'links')
  const header = [...cols.map((c) => c.label), 'Cekura URL', 'Provider URL']
  const lines = rows.map((r) => [
    ...cols.map((c) => (c.kind === 'date' && r.v[c.key] != null ? new Date(r.v[c.key] as number).toISOString() : formatCell(c, r.v[c.key]))),
    cekuraLink(r.call),
    providerLink(settings, r.call.call_id)?.url ?? '',
  ])
  const csv = [header, ...lines].map((l) => l.map(esc).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `cekura-calls-${new Date().toISOString().slice(0, 16).replace(':', '')}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
