import type { Row } from './columns'

export type DisplayItem =
  | { type: 'row'; key: string; row: Row; inGroup: boolean }
  | { type: 'group'; key: string; resultId: number; name: string; rows: Row[]; expanded: boolean }

export const groupKey = (resultId: number) => `result:${resultId}`

/**
 * Folds simulation runs under their result, like Cekura's result page. Each group sits where
 * its top-sorted run would have been, and its runs keep the current sort order, so grouping
 * never changes what sorting means. Production calls are never grouped, and a result with a
 * single (matching) run is shown as a plain row since folding it would only add a click.
 */
export function buildDisplay(sorted: Row[], groupByResult: boolean, expanded: Set<number>): DisplayItem[] {
  if (!groupByResult) return sorted.map((row) => ({ type: 'row', key: row.call.uid, row, inGroup: false }))

  const members = new Map<number, Row[]>()
  for (const row of sorted) {
    const id = row.call.sim?.resultId
    if (id == null) continue
    let list = members.get(id)
    if (!list) members.set(id, (list = []))
    list.push(row)
  }

  const items: DisplayItem[] = []
  const emitted = new Set<number>()
  for (const row of sorted) {
    const id = row.call.sim?.resultId
    if (id == null) {
      items.push({ type: 'row', key: row.call.uid, row, inGroup: false })
      continue
    }
    if (emitted.has(id)) continue
    emitted.add(id)
    const rows = members.get(id)!
    if (rows.length === 1) {
      items.push({ type: 'row', key: row.call.uid, row, inGroup: false })
      continue
    }
    const isOpen = expanded.has(id)
    items.push({ type: 'group', key: groupKey(id), resultId: id, name: row.call.sim!.resultName, rows, expanded: isOpen })
    if (isOpen) for (const r of rows) items.push({ type: 'row', key: r.call.uid, row: r, inGroup: true })
  }
  return items
}
