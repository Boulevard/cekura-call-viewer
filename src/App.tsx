import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, fetchCallBranches, fetchCallVariables, fetchRunVariables, getByProviderIds, slimVariables, listCalls, listKnownProviderIds, listProjects, listProviderAgents, listSims, type ProviderAgents, type Project } from './api'
import { conversationToCallLog, getConversationAsCallLog, getConversationVariables, listConversations } from './elevenlabs'
import { isVariableKey, buildModel, DEFAULT_METRIC_NAMES, DEFAULT_VISIBLE, findMetricKey, SIM_COLUMNS, withDefaultMetrics, type Column } from './columns'
import { applyFilters, applySort, type Filter, type SortSpec, type ViewState } from './filters'
import { loadSettings, saveSettings, type Settings } from './settings'
import { load as loadStored, save, usePersistentState } from './storage'
import type { CallLog } from './types'
import { downloadCsv } from './csv'
import { buildDisplay, groupKey } from './grouping'
import { CallTable, ROW_HEIGHT } from './components/CallTable'
import { CallDetail, type DetailPane } from './components/CallDetail'
import { ColumnPicker } from './components/ColumnPicker'
import { Popover } from './components/Popover'
import { SettingsDialog } from './components/SettingsDialog'
import { ViewsMenu } from './components/ViewsMenu'
import { ProjectPicker } from './components/ProjectPicker'
import { QueryBar, type QueryBarHandle } from './components/QueryBar'
import { ElevenLabsAgents } from './components/ElevenLabsAgents'
import { AgentFilter, BusinessFilter, IdsFilter, pastedCallIds, QualifiedFilter } from './components/QuickFilters'
import { Sidebar } from './components/Sidebar'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { useTheme } from './theme'
import { fetchViewsFile, isModified, loadSavedViews, newViewId, writeViewsFile, type DataSource, type SavedView, type ViewQuery } from './views'

const PRESETS = [
  { key: '1h', label: '1h', title: 'Last hour', ms: 3600e3 },
  { key: '6h', label: '6h', title: 'Last 6 hours', ms: 6 * 3600e3 },
  { key: '24h', label: '24h', title: 'Last 24 hours', ms: 24 * 3600e3 },
  { key: '3d', label: '3d', title: 'Last 3 days', ms: 3 * 86400e3 },
  { key: '7d', label: '7d', title: 'Last 7 days', ms: 7 * 86400e3 },
  { key: '30d', label: '30d', title: 'Last 30 days', ms: 30 * 86400e3 },
]
const MAX_RANGE_MS = 33 * 86400e3
// Sidebar filter sections shown until the user picks their own.
const DEFAULT_FACETS = ['source', 'success', 'agent_name', 'call_ended_reason']

type Query = ViewQuery

// The project the app opens on before anything is saved; 3201 is the team's Cekura project.
const DEFAULT_PROJECT_ID = Number(import.meta.env.VITE_CEKURA_PROJECT_ID) || 3201
const DEFAULT_QUERY: Query = { projectId: DEFAULT_PROJECT_ID, range: '24h', from: '', to: '', agentId: '', source: 'calls' }

const SOURCE_TOGGLES = [
  { key: 'calls', label: 'Calls', hint: 'calls' },
  { key: 'sims', label: 'Simulations', hint: 'simulations' },
  { key: 'el', label: '11Labs', hint: "ElevenLabs conversations that Cekura doesn't have" },
] as const

function sourceIncludes(source: DataSource, key: 'calls' | 'sims') {
  return source === 'both' || source === key
}

/**
 * Flips one of the three source toggles. Turning off the only active one is ignored so something
 * is always loaded; with Calls and Simulations both off, only 11Labs-only conversations load.
 */
function toggleSource(q: Query, key: 'calls' | 'sims' | 'el'): Query {
  const source = q.source ?? 'calls'
  let calls = sourceIncludes(source, 'calls')
  let sims = sourceIncludes(source, 'sims')
  let el = !!q.elevenLabs
  if (key === 'calls') calls = !calls
  else if (key === 'sims') sims = !sims
  else el = !el
  if (!calls && !sims && !el) return q
  return { ...q, source: calls && sims ? 'both' : calls ? 'calls' : sims ? 'sims' : 'none', elevenLabs: el }
}
const DEFAULT_VIEW: ViewState = { visible: DEFAULT_VISIBLE, filters: [], sort: [{ col: 'timestamp', dir: 'desc' }], widths: {} }

function resolveRange(q: Query): { from: string; to: string } {
  const preset = PRESETS.find((p) => p.key === q.range)
  if (preset) {
    const now = Date.now()
    return { from: new Date(now - preset.ms).toISOString(), to: new Date(now).toISOString() }
  }
  return { from: new Date(q.from).toISOString(), to: new Date(q.to).toISOString() }
}

/** `#call=<id>`, `#run=<id>` or `#el=<conversation id>`, returned as the row uid (`call:<id>` etc.). */
function readHashSelection(): string | null {
  const m = location.hash.match(/(call|run)=(\d+)|el=(conv_\w+)/)
  return m ? (m[3] ? `el:${m[3]}` : `${m[1]}:${m[2]}`) : null
}

// A shared link carries the view in ?view=<base64 json>; it's applied once and stripped from the URL.
function readSharedView(): { view?: ViewState; query?: Query } | null {
  const raw = new URLSearchParams(location.search).get('view')
  if (!raw) return null
  try {
    return JSON.parse(decodeURIComponent(escape(atob(raw))))
  } catch {
    return null
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const shared = useMemo(readSharedView, [])
  const [query, setQuery] = usePersistentState<Query>('query', DEFAULT_QUERY)
  const [view, setView] = usePersistentState<ViewState>('view', () => {
    const v = loadStored<ViewState>('view', DEFAULT_VIEW)
    // One-time: the call ID became a default first column after views were already being persisted.
    if (loadStored('migratedCallIdFirst', false)) return v
    save('migratedCallIdFirst', true)
    return v.visible.includes('call_id') ? v : { ...v, visible: ['call_id', ...v.visible] }
  })
  const [savedViews, setSavedViews] = useState<SavedView[]>(loadSavedViews)
  // 'pending' until views.json has been read, so the localStorage copy can't overwrite the file on startup.
  const [viewsFile, setViewsFile] = useState<'pending' | 'file' | 'unavailable' | 'error'>('pending')
  useEffect(() => {
    fetchViewsFile().then((fromFile) => {
      if (fromFile === undefined) return setViewsFile('unavailable')
      // No file yet: seed it with whatever this browser already had.
      if (fromFile === null) writeViewsFile(loadSavedViews())
      else setSavedViews(fromFile)
      setViewsFile('file')
    })
  }, [])
  useEffect(() => {
    save('savedViewsV2', savedViews)
    if (viewsFile === 'file' || viewsFile === 'error') {
      writeViewsFile(savedViews).then((ok) => setViewsFile(ok ? 'file' : 'error'))
    }
    // Only view edits should trigger a write, not the status flipping after one.
  }, [savedViews])
  const [activeViewId, setActiveViewId] = usePersistentState<string | null>('activeView', null)
  const [search, setSearch] = useState('')

  const [calls, setCalls] = useState<CallLog[]>([])
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<{
    total: number; truncated: boolean; at: Date; from: string; to: string
    calls?: number; sims?: number; results?: number; projectId: number
    /** 11Labs-only rows added, and why that failed if it did (the Cekura rows still load). */
    elOnly?: number; elError?: string
  } | null>(null)
  const callsRef = useRef(calls)
  callsRef.current = calls
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => { listProjects(settings).then(setProjects, () => setProjects([])) }, [settings])
  // Only projects the key can see are selectable. A saved, shared or default project that isn't
  // one of them (a stale ID, or another team's link) falls back to the first one that is.
  useEffect(() => {
    if (projects.length === 0 || projects.some((p) => p.id === query.projectId)) return
    const q = { ...query, projectId: projects[0].id, agentId: '' }
    setQuery(q)
    loadRef.current(q)
  }, [projects, query, setQuery])
  const [projectElAgents, setProjectElAgents] = useState<Map<string, { id: number; name: string }>>(new Map())
  const [branchProgress, setBranchProgress] = useState<{ done: number; total: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(readHashSelection)
  // The keyboard cursor in the list; separate from selectedId so you can move around without opening calls.
  const [cursorId, setCursorId] = useState<string | null>(readHashSelection)
  useEffect(() => { if (selectedId != null) setCursorId(selectedId) }, [selectedId])
  const [groupByResult, setGroupByResult] = usePersistentState('groupByResult', true)
  const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set())
  const [popover, setPopover] = useState<'columns' | 'views' | null>(null)
  const [theme, toggleTheme] = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentState('sidebarCollapsed', false)
  const [sidebarWidth, setSidebarWidth] = usePersistentState('sidebarWidth', 248)
  const [facetKeys, setFacetKeys] = usePersistentState<string[]>('facets', DEFAULT_FACETS)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const searchRef = useRef<QueryBarHandle>(null)

  useEffect(() => {
    if (!shared) return
    if (shared.view) setView({ ...DEFAULT_VIEW, ...shared.view })
    setActiveViewId(null)
    if (shared.query) setQuery({ ...DEFAULT_QUERY, ...shared.query })
    history.replaceState(null, '', location.pathname + location.hash)
  }, [shared, setView, setQuery, setActiveViewId])

  // Results and calls named in a result_id / call_id filter are fetched even outside the time
  // range (or with their source off), so a pasted list of IDs always shows them.
  const viewRef = useRef(view)
  viewRef.current = view
  const pinnedResultIds = (filters: Filter[]) => {
    const f = filters.find((x) => x.col === 'result_id')
    return f?.type === 'set' && !f.exclude ? f.values.map(Number).filter(Number.isFinite) : []
  }
  const pinnedCallIds = (filters: Filter[]) => {
    const f = filters.find((x) => x.col === 'call_id')
    return f?.type === 'set' && !f.exclude ? pastedCallIds(f.values.filter((v): v is string => v != null)) : []
  }

  const load = useCallback(async (q: Query = query, pins?: { results?: number[]; calls?: string[] }) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError(null)
    let range
    try {
      range = resolveRange(q)
    } catch {
      setError('Invalid date range')
      return
    }
    if (Date.parse(range.to) - Date.parse(range.from) > MAX_RANGE_MS) {
      setError('Cekura only allows ranges up to 33 days')
      return
    }
    setProgress({ loaded: 0, total: 0 })
    const source = q.source ?? 'calls'
    const pinned = pins?.results ?? pinnedResultIds(viewRef.current.filters)
    const pinnedCalls = pins?.calls ?? pinnedCallIds(viewRef.current.filters)
    // Every agent is always loaded; picking agents is a filter on the loaded data, like any other.
    // (Older saved queries may still carry a server-side agentId; it's ignored so it can't hide calls.)
    const listQuery = { projectId: q.projectId, ...range }
    // Everything loads in parallel; the progress bar shows the combined count.
    const parts = { calls: { loaded: 0, total: 0 }, sims: { loaded: 0, total: 0 }, el: { loaded: 0, total: 0 } }
    const report = (key: keyof typeof parts) => (loaded: number, total: number) => {
      parts[key] = { loaded, total }
      const all = Object.values(parts)
      setProgress({ loaded: all.reduce((a, p) => a + p.loaded, 0), total: all.reduce((a, p) => a + p.total, 0) })
    }
    const withCalls = sourceIncludes(source, 'calls')
    const withSims = sourceIncludes(source, 'sims')
    // Only used to label rows (and find the 11Labs agents); a failure here shouldn't block the list.
    const agentsP: Promise<ProviderAgents> = listProviderAgents(settings, q.projectId)
      .catch(() => ({ byCekuraAgent: new Map(), elevenLabs: new Map() }))
    agentsP.then((a) => { if (abortRef.current === ctrl) setProjectElAgents(a.elevenLabs) })
    // ElevenLabs conversations, plus the provider IDs of whatever Cekura has that isn't being
    // loaded, so only conversations Cekura never imported get added.
    const elP = q.elevenLabs
      ? agentsP.then(async (agents) => {
        const [conversations, known] = await Promise.all([
          listConversations([...new Set([...agents.elevenLabs.keys(), ...(q.elevenLabsAgents ?? [])])].filter((id) => !q.elevenLabsSkip?.includes(id)), Date.parse(range.from), Date.parse(range.to), (n) => report('el')(n, n), ctrl.signal),
          listKnownProviderIds(settings, listQuery, { calls: !withCalls, sims: !withSims }, ctrl.signal),
        ])
        return { conversations, known, agents }
      }).catch((e: Error) => {
        if (e.name === 'AbortError') throw e
        return { error: String(e.message ?? e) }
      })
      : null
    try {
      const [callRes, simRes, providerAgents, el] = await Promise.all([
        withCalls ? listCalls(settings, listQuery, report('calls'), ctrl.signal) : null,
        withSims || pinned.length ? listSims(settings, listQuery, report('sims'), ctrl.signal, pinned, !withSims) : null,
        agentsP,
        elP,
      ])
      const cekuraRows = [...(callRes?.calls ?? []), ...(simRes?.calls ?? [])]
      let elRows: CallLog[] = []
      if (el && 'conversations' in el) {
        const known = new Set([...el.known, ...cekuraRows.map((c) => c.call_id)])
        elRows = el.conversations
          .filter((c) => !known.has(c.conversation_id))
          .map((c) => conversationToCallLog(c, q.projectId, el.agents.elevenLabs.get(c.agent_id)))
      }
      // Pasted call IDs that aren't loaded: look them up in Cekura first, then (for ElevenLabs
      // conversations Cekura doesn't have) in ElevenLabs. Retell calls can only come from Cekura.
      const loadedIds = new Set([...cekuraRows, ...elRows].map((c) => c.call_id))
      const missing = pinnedCalls.filter((id) => !loadedIds.has(id))
      if (missing.length) {
        const found = (await getByProviderIds(settings, q.projectId, missing, ctrl.signal)).map((c) => ({ ...c, pinned: true }))
        cekuraRows.push(...found)
        const foundIds = new Set(found.map((c) => c.call_id))
        const fromEl = await Promise.allSettled(missing
          .filter((id) => id.startsWith('conv_') && !foundIds.has(id))
          .map((id) => getConversationAsCallLog(id, q.projectId, (a) => providerAgents.elevenLabs.get(a))))
        elRows.push(...fromEl.flatMap((r) => (r.status === 'fulfilled' ? [{ ...r.value, pinned: true }] : [])))
      }
      const withAgents = cekuraRows.map((c) => ({
        ...c,
        providerAgentId: c.providerAgentId ?? providerAgents.byCekuraAgent.get(c.agent) ?? null,
        // Production ElevenLabs calls start with an unknown branch (undefined) until it's fetched.
        branchId: c.source === 'sim' ? c.branchId ?? null : c.call_id?.startsWith('conv_') ? undefined : null,
      }))
      setCalls([...withAgents, ...elRows])
      setMeta({
        elOnly: el && 'conversations' in el ? elRows.length : undefined,
        elError: el && 'error' in el ? el.error : undefined,
        total: (callRes?.total ?? 0) + (simRes?.total ?? 0),
        truncated: !!callRes?.truncated || !!simRes?.truncated,
        at: new Date(),
        calls: callRes?.calls.length,
        sims: simRes?.calls.length,
        results: simRes?.results,
        projectId: q.projectId,
        ...range,
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      // 401 means the key itself is missing or wrong; 403 means it's valid but can't see this project.
      setError(e instanceof ApiError && e.status === 401
        ? `${e.message}. Set an API key in Settings, or CEKURA_API_KEY in .env.local.`
        : e instanceof ApiError && e.status === 403
          ? `Your API key doesn't have access to project ${q.projectId}.`
          : String((e as Error).message ?? e))
    } finally {
      if (abortRef.current === ctrl) setProgress(null)
    }
  }, [query, settings])

  // Load once on startup with the last-used query.
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    loadRef.current(shared?.query ? { ...DEFAULT_QUERY, ...shared.query } : undefined)
  }, [shared])

  const model = useMemo(() => buildModel(calls), [calls])
  const loadedResultIds = useMemo(() => new Set(calls.flatMap((c) => (c.sim ? [c.sim.resultId] : []))), [calls])
  const loadedCallIds = useMemo(() => new Set(calls.map((c) => c.call_id)), [calls])

  // Branches for production ElevenLabs calls are expensive to fetch, so only do it while the
  // branch column is on screen or being filtered/sorted on.
  const needsBranch = view.visible.includes('branch') || view.filters.some((f) => f.col === 'branch') || view.sort.some((s) => s.col === 'branch')
  useEffect(() => {
    if (!needsBranch || !meta) return
    const pending = callsRef.current.filter((c) => c.source === 'call' && c.branchId === undefined).map((c) => c.id)
    if (pending.length === 0) return
    const ctrl = new AbortController()
    let done = 0
    setBranchProgress({ done, total: pending.length })
    fetchCallBranches(settings, meta.projectId, pending, meta, (found) => {
      done += found.size
      setBranchProgress({ done, total: pending.length })
      setCalls((prev) => prev.map((c) => {
        const f = c.source === 'call' ? found.get(c.id) : undefined
        return f ? { ...c, branchId: f.branchId, providerAgentId: f.agentId ?? c.providerAgentId } : c
      }))
    }, ctrl.signal).catch(() => {}).finally(() => setBranchProgress(null))
    return () => ctrl.abort()
  }, [needsBranch, meta, settings])

  // Dynamic variables add 5-25KB per call, so like branches they're only fetched once asked for
  // or while a variable column is shown, filtered, sorted or searched on.
  const [wantVariables, setWantVariables] = useState(false)
  const [variableProgress, setVariableProgress] = useState<{ done: number; total: number } | null>(null)
  const needsVariables = wantVariables || /\bdv\./i.test(search) ||
    view.visible.some(isVariableKey) || view.filters.some((f) => isVariableKey(f.col)) || view.sort.some((s) => isVariableKey(s.col))
  useEffect(() => {
    if (!needsVariables || !meta) return
    const pending = callsRef.current.filter((c) => c.variables === undefined)
    if (pending.length === 0) return
    const wanted = new Set(pending.map((c) => c.uid))
    const ctrl = new AbortController()
    let done = 0
    setVariableProgress({ done, total: pending.length })
    const apply = (found: Map<string, Record<string, string>>) => {
      const hits = [...found].filter(([uid]) => wanted.has(uid))
      if (hits.length === 0 || ctrl.signal.aborted) return
      done += hits.length
      setVariableProgress({ done, total: pending.length })
      const byUid = new Map(hits)
      setCalls((prev) => prev.map((c) => (byUid.has(c.uid) ? { ...c, variables: byUid.get(c.uid) } : c)))
    }
    const prefixed = (prefix: string) => (found: Map<number, Record<string, string>>) =>
      apply(new Map([...found].map(([id, v]) => [`${prefix}:${id}`, v])))
    const callIds = pending.filter((c) => c.source === 'call').map((c) => c.id)
    const resultIds = [...new Set(pending.flatMap((c) => (c.sim ? [c.sim.resultId] : [])))]
    // 11Labs-only rows have no Cekura copy, so their variables come from the conversation itself.
    const elRows = pending.filter((c) => c.source === 'el')
    // That's one request per conversation, so results are applied in batches rather than one by one.
    const fromElevenLabs = async () => {
      let next = 0
      let batch = new Map<string, Record<string, string>>()
      const flush = () => { if (batch.size) { apply(batch); batch = new Map() } }
      const worker = async () => {
        while (next < elRows.length && !ctrl.signal.aborted) {
          const c = elRows[next++]
          const dv = await getConversationVariables(c.call_id, ctrl.signal).catch(() => null)
          batch.set(c.uid, slimVariables(dv))
          if (batch.size >= 25) flush()
        }
      }
      await Promise.all(Array.from({ length: Math.min(8, elRows.length) }, worker))
      flush()
    }
    Promise.all([
      callIds.length && fetchCallVariables(settings, meta.projectId, callIds, meta, prefixed('call'), ctrl.signal),
      resultIds.length && fetchRunVariables(settings, meta.projectId, resultIds, prefixed('run'), ctrl.signal),
      elRows.length && fromElevenLabs(),
    ]).catch(() => {}).finally(() => { if (!ctrl.signal.aborted) setVariableProgress(null) })
    return () => { ctrl.abort(); setVariableProgress(null) }
  }, [needsVariables, meta, settings])
  const colMap = useMemo(() => new Map(model.columns.map((c) => [c.key, c])), [model.columns])

  // One-time: agent, provider agent, branch and ended reason left the default view after views were
  // already being persisted. Applied to the current view the same way earlier additions were.
  useEffect(() => {
    if (loadStored('migratedSlimDefaultColumns', false)) return
    save('migratedSlimDefaultColumns', true)
    const dropped = ['agent_name', 'provider_agent', 'branch', 'call_ended_reason']
    setView((v) => (v.visible.some((k) => dropped.includes(k)) ? { ...v, visible: v.visible.filter((k) => !dropped.includes(k)) } : v))
  }, [setView])

  // Default metric columns were added after views were already being persisted, so each one is
  // added to the current view once, the first time the loaded data has that metric.
  useEffect(() => {
    const applied = loadStored<string[]>('appliedDefaultMetrics',
      loadStored('migratedBusinessColumns', false) ? ['Info: Business Name', 'location name', 'business_id'] : [])
    const pending = DEFAULT_METRIC_NAMES.filter((n) => !applied.includes(n) && findMetricKey(model.columns, n))
    if (pending.length === 0) return
    save('appliedDefaultMetrics', [...applied, ...pending])
    setView((v) => ({ ...v, visible: withDefaultMetrics(v.visible, model.columns, pending) }))
  }, [model.columns, setView])
  const visibleCols = useMemo(() => view.visible.map((k) => colMap.get(k)).filter((c): c is Column => !!c), [view.visible, colMap])
  const filtered = useMemo(() => applyFilters(model.rows, view.filters, search), [model.rows, view.filters, search])
  const sorted = useMemo(() => applySort(filtered, view.sort, colMap), [filtered, view.sort, colMap])
  const facetRowsFor = useCallback(
    (col: string) => applyFilters(model.rows, view.filters, search, view.filters.findIndex((f) => f.col === col)),
    [model.rows, view.filters, search],
  )

  const setFilter = useCallback((col: string, f: Filter | null) => {
    setView((v) => {
      const rest = v.filters.filter((x) => x.col !== col)
      const idx = v.filters.findIndex((x) => x.col === col)
      if (!f) return { ...v, filters: rest }
      const filters = [...v.filters]
      if (idx >= 0) filters[idx] = f
      else filters.push(f)
      return { ...v, filters }
    })
  }, [setView])

  const onSort = useCallback((col: string, additive: boolean) => {
    setView((v) => {
      const existing = v.sort.find((s) => s.col === col)
      // asc -> desc -> off when clicking the same column; numeric/time columns start descending.
      const firstDir: SortSpec['dir'] = ['timestamp', 'duration'].includes(col) || col.startsWith('m:') ? 'desc' : 'asc'
      let next: SortSpec | null
      if (!existing) next = { col, dir: firstDir }
      else if (existing.dir === firstDir) next = { col, dir: firstDir === 'asc' ? 'desc' : 'asc' }
      else next = null
      const others = additive ? v.sort.filter((s) => s.col !== col) : []
      return { ...v, sort: next ? (additive ? [...others, next] : [next]) : others }
    })
  }, [setView])

  // Selection lives in the hash so browser back closes the detail panel and links are shareable.
  useEffect(() => {
    const onHash = () => setSelectedId(readHashSelection())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const select = useCallback((id: string | null) => {
    if (id == null) {
      history.pushState(null, '', location.pathname + location.search)
      setSelectedId(null)
    } else {
      location.hash = id.replace(':', '=')
    }
  }, [])

  const selectedIndex = sorted.findIndex((r) => r.call.uid === selectedId)
  const selectedRow = selectedIndex >= 0 ? sorted[selectedIndex] : model.rows.find((r) => r.call.uid === selectedId)

  const hasSims = useMemo(() => calls.some((c) => c.source === 'sim'), [calls])
  const grouped = groupByResult && hasSims
  const display = useMemo(() => buildDisplay(sorted, grouped, expandedResults), [sorted, grouped, expandedResults])
  const toggleGroup = useCallback((resultId: number, key?: string) => {
    setExpandedResults((prev) => {
      const next = new Set(prev)
      if (next.has(resultId)) next.delete(resultId)
      else next.add(resultId)
      return next
    })
    if (key) setCursorId(key)
  }, [])
  // Searching for a result ID is a request to see that result's runs, so unfold it.
  useEffect(() => {
    const id = /^\d+$/.test(search.trim()) ? Number(search.trim()) : null
    if (id == null || !calls.some((c) => c.sim?.resultId === id)) return
    setExpandedResults((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [search, calls])

  // A run opened from a link or the keyboard should be visible, so unfold its result.
  useEffect(() => {
    const id = selectedRow?.call.sim?.resultId
    if (id != null && grouped) setExpandedResults((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [selectedRow, grouped])

  // The cursor walks everything on screen, group headers included. With the detail panel open,
  // stepping skips headers and moves the panel from one call/run to the next.
  const step = useCallback((d: number) => {
    if (display.length === 0) return
    if (selectedId != null) {
      const rowItems = display.filter((it) => it.type === 'row')
      const from = rowItems.findIndex((it) => it.key === selectedId)
      const i = from < 0 ? 0 : Math.min(rowItems.length - 1, Math.max(0, from + d))
      if (rowItems[i]) select(rowItems[i].key)
      return
    }
    const from = display.findIndex((it) => it.key === cursorId)
    const i = from < 0 ? 0 : Math.min(display.length - 1, Math.max(0, from + d))
    setCursorId(display[i].key)
  }, [display, selectedId, cursorId, select])

  // Enter in the query bar puts the cursor on the first result, once the new filters have applied.
  const [jumpRequest, setJumpRequest] = useState(0)
  useEffect(() => {
    if (!jumpRequest) return
    if (display.length) {
      setCursorId(display[0].key)
      document.querySelector('.table-scroll')?.scrollTo({ top: 0 })
    }
    setJumpRequest(0)
  }, [jumpRequest, display])

  // Which detail pane (metrics or transcript/data) the arrow keys scroll; none means they step calls.
  const [detailPane, setDetailPane] = useState<DetailPane | null>(null)
  const paneEls = useRef<Record<DetailPane, HTMLElement | null>>({ metrics: null, main: null })
  const paneRef = useCallback((pane: DetailPane, el: HTMLElement | null) => { paneEls.current[pane] = el }, [])
  useEffect(() => { if (selectedId == null) setDetailPane(null) }, [selectedId])

  // vim-style "gg": the first g only arms the jump, which a second g within half a second completes.
  const pendingG = useRef(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      // Ctrl+R reloads the calls rather than the page (which would throw away everything loaded),
      // even from the search box. Cmd+R on a Mac and Ctrl+Shift+R still reload the page.
      if (e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey && e.key === 'r') {
        e.preventDefault()
        loadRef.current()
        return
      }
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.altKey) return
      // Let open popovers and modals handle their own keys (Esc closes them, not the detail panel).
      if (document.querySelector('.popover, .modal')) return
      if (e.ctrlKey) {
        if (e.key !== 'd' && e.key !== 'u') return
        e.preventDefault()
        const visibleRows = Math.floor((document.querySelector('.table-scroll')?.clientHeight ?? 0) / ROW_HEIGHT)
        const page = Math.max(1, visibleRows - 2)
        step(e.key === 'd' ? page : -page)
      }
      else if (e.key === 'g') {
        if (Date.now() - pendingG.current < 500) { pendingG.current = 0; step(-Infinity) }
        else pendingG.current = Date.now()
      }
      else if (e.key === 'G') step(Infinity)
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      else if (e.key === '?') setShowShortcuts(true)
      // Detail panes: ←/→ (or h/l, Tab) pick one, then ↑/↓ scroll it instead of stepping calls.
      else if (selectedId != null && !t.closest('audio') && (e.key === 'ArrowLeft' || e.key === 'h')) { e.preventDefault(); setDetailPane('metrics') }
      else if (selectedId != null && !t.closest('audio') && (e.key === 'ArrowRight' || e.key === 'l')) { e.preventDefault(); setDetailPane('main') }
      else if (selectedId != null && e.key === 'Tab' && !t.closest('button, a, audio')) {
        e.preventDefault()
        setDetailPane((p) => (p === 'metrics' ? 'main' : 'metrics'))
      }
      else if (selectedId != null && detailPane && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) {
        const el = paneEls.current[detailPane]
        if (el) {
          e.preventDefault()
          const page = e.shiftKey || e.key.startsWith('Page')
          const dir = e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 1
          el.scrollBy({ top: dir * (page ? el.clientHeight * 0.85 : 80), behavior: page ? 'smooth' : 'auto' })
        }
      }
      else if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); step(1) }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
      else if ((e.key === 'Enter' || e.key === ' ') && !t.closest('button, a, audio')) {
        e.preventDefault()
        const item = display.find((it) => it.key === cursorId) ?? display[0]
        if (item?.type === 'group') toggleGroup(item.resultId, item.key)
        // Space folds: on a run inside an open result it collapses that result back to its header.
        else if (e.key === ' ' && item?.inGroup && item.row.call.sim) {
          if (selectedId != null) select(null)
          toggleGroup(item.row.call.sim.resultId, groupKey(item.row.call.sim.resultId))
        }
        else if (item && item.key !== selectedId) select(item.key)
      }
      else if (e.key === 'Escape' && selectedId != null) select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, cursorId, display, step, select, toggleGroup, detailPane])

  const activeView = savedViews.find((v) => v.id === activeViewId) ?? null
  const viewModified = !!activeView && isModified(activeView, view, query)

  const applyView = (v: SavedView) => {
    setView({ ...DEFAULT_VIEW, ...v.view })
    setActiveViewId(v.id)
    setPopover(null)
    if (v.query) {
      setQuery(v.query)
      load(v.query)
    }
  }
  const saveNewView = (name: string, includeQuery: boolean) => {
    const v: SavedView = { id: newViewId(), name, view, query: includeQuery ? query : undefined, updatedAt: Date.now() }
    setSavedViews((vs) => [...vs, v])
    setActiveViewId(v.id)
  }
  const updateActiveView = () => {
    if (!activeView) return
    setSavedViews((vs) => vs.map((v) => (v.id === activeView.id ? { ...v, view, query: v.query && query, updatedAt: Date.now() } : v)))
  }

  const copyViewLink = () => {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ view, query }))))
    navigator.clipboard.writeText(`${location.origin}${location.pathname}?view=${payload}`)
  }


  const sourceLabel = { calls: 'calls', sims: 'simulation runs', both: 'calls & runs', none: 'conversations' }[query.source ?? 'calls']

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand"><span className="brand-mark" /><span className="brand-text">Cekura Calls</span></div>
        <ProjectPicker projects={projects} value={query.projectId}
          onChange={(projectId) => { const q = { ...query, projectId, agentId: '' }; setQuery(q); load(q) }} />
        <AgentFilter columns={model.columns} filters={view.filters} facetRowsFor={facetRowsFor} onSetFilter={setFilter} />
        <div className="source-toggles">
          {SOURCE_TOGGLES.map((t) => {
            const on = t.key === 'el' ? !!query.elevenLabs : sourceIncludes(query.source ?? 'calls', t.key)
            const next = toggleSource(query, t.key)
            return (
              <button key={t.key} className={`toggle ${on ? 'on' : ''}`} aria-pressed={on}
                title={next === query ? 'At least one source has to stay on' : on ? `Hide ${t.hint}` : `Include ${t.hint}`}
                onClick={() => {
                  if (next === query) return
                  setQuery(next)
                  load(next)
                }}>
                <span className="toggle-box">{on ? '✓' : ''}</span>{t.label}
              </button>
            )
          })}
        </div>
        {query.elevenLabs && (
          <ElevenLabsAgents projectAgents={projectElAgents} value={{ extra: query.elevenLabsAgents ?? [], skip: query.elevenLabsSkip ?? [] }}
            onChange={({ extra, skip }) => { const q = { ...query, elevenLabsAgents: extra, elevenLabsSkip: skip }; setQuery(q); load(q) }} />
        )}
        <select value={query.range} title="Time range" onChange={(e) => {
          const range = e.target.value
          if (range === 'custom') {
            const r = meta ?? resolveRange(query)
            const local = (iso: string) => new Date(Date.parse(iso) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
            setQuery({ ...query, range, from: query.from || local(r.from), to: query.to || local(r.to) })
            return
          }
          const q = { ...query, range }
          setQuery(q)
          load(q)
        }}>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.title}</option>)}
          <option value="custom">Custom range…</option>
        </select>
        {query.range === 'custom' && (
          <>
            <input type="datetime-local" value={query.from} onChange={(e) => setQuery({ ...query, from: e.target.value })} />
            <span className="muted">→</span>
            <input type="datetime-local" value={query.to} onChange={(e) => setQuery({ ...query, to: e.target.value })} />
          </>
        )}
        <button className="btn primary icon" onClick={() => load()} disabled={!!progress} title="Reload">{progress ? '…' : '↻'}</button>
        {progress && <button className="btn ghost" onClick={() => { abortRef.current?.abort(); setProgress(null) }}>Cancel</button>}
        <span className="toolbar-sep" />
        <BusinessFilter columns={model.columns} filters={view.filters} facetRowsFor={facetRowsFor} onSetFilter={setFilter} />
        <QualifiedFilter columns={model.columns} filters={view.filters} onSetFilter={setFilter} />
        <IdsFilter filters={view.filters} loadedResultIds={loadedResultIds} loadedCallIds={loadedCallIds} loading={!!progress}
          onApply={({ results, calls: callIds }) => {
            // Only a list filter belongs to this box; a pattern typed in the query bar is left alone.
            const isList = (col: string) => view.filters.some((f) => f.col === col && f.type === 'set')
            if (results.length || isList('result_id')) setFilter('result_id', results.length ? { col: 'result_id', type: 'set', values: results.map(String) } : null)
            if (callIds.length || isList('call_id')) setFilter('call_id', callIds.length ? { col: 'call_id', type: 'set', values: callIds } : null)
            // Rows that were only loaded for pasted IDs go when those IDs do.
            const simsOff = !sourceIncludes(query.source ?? 'calls', 'sims')
            setCalls((prev) => prev.filter((c) =>
              !(c.pinned && !callIds.includes(c.call_id)) && !(simsOff && c.source === 'sim' && !results.length && !c.pinned)))
            if (simsOff && !results.length) setMeta((m) => m && { ...m, sims: undefined, results: undefined })
            if (results.some((id) => !loadedResultIds.has(id)) || callIds.some((id) => !loadedCallIds.has(id))) load(query, { results, calls: callIds })
          }} />
        <span className="spacer" />
        <div className="popover-anchor">
          <button className="btn" onClick={() => setPopover('columns')}>Columns <span className="muted">{visibleCols.length}</span></button>
          {popover === 'columns' && (
            <Popover onClose={() => setPopover(null)} align="right" className="xwide">
              <ColumnPicker columns={model.columns} visible={view.visible} rows={filtered} defaultVisible={withDefaultMetrics(DEFAULT_VISIBLE, model.columns)}
                onChange={(visible) => setView((v) => ({ ...v, visible }))} />
            </Popover>
          )}
        </div>
        <div className="popover-anchor">
          <button className={`btn view-btn ${activeView ? 'has-view' : ''}`} onClick={() => setPopover('views')} title="Saved views">
            <span className="ellipsis">{activeView ? activeView.name : 'Unsaved view'}</span>
            {viewModified && <span className="view-dot" title="Unsaved changes" />}
            <span className="muted">▾</span>
          </button>
          {popover === 'views' && (
            <Popover onClose={() => setPopover(null)} align="right" className="views-popover">
              <ViewsMenu views={savedViews} activeId={activeViewId} modified={viewModified} storage={viewsFile}
                onApply={applyView}
                onSaveNew={saveNewView}
                onUpdate={updateActiveView}
                onRevert={() => activeView && applyView(activeView)}
                onRename={(id, name) => setSavedViews((vs) => vs.map((v) => (v.id === id ? { ...v, name } : v)))}
                onDelete={(id) => {
                  setSavedViews((vs) => vs.filter((v) => v.id !== id))
                  if (id === activeViewId) setActiveViewId(null)
                }}
                onCopyLink={copyViewLink}
                onReset={() => { setView({ ...DEFAULT_VIEW, visible: withDefaultMetrics(DEFAULT_VISIBLE, model.columns) }); setActiveViewId(null); setPopover(null) }} />
            </Popover>
          )}
        </div>
        <button className="btn" onClick={() => downloadCsv(sorted, visibleCols, settings)} disabled={!sorted.length} title="Export the filtered rows as CSV">
          <span>⤓</span><span className="export-text">Export</span>
        </button>
        <button className="btn ghost icon" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>{theme === 'dark' ? '☀' : '☾'}</button>
        <button className="btn ghost icon" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts (?)">?</button>
        <button className="btn ghost icon" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
      </header>

      <div className="body">
        {/* With a call open the detail panel needs the room, so the sidebar folds to a rail. */}
        <Sidebar collapsed={sidebarCollapsed || !!selectedRow} width={sidebarWidth} onResize={setSidebarWidth}
          onToggleCollapsed={() => { if (selectedRow) { select(null); setSidebarCollapsed(false) } else setSidebarCollapsed(!sidebarCollapsed) }}
          views={savedViews} activeViewId={activeViewId} viewModified={viewModified} onApplyView={applyView}
          onManageViews={() => setPopover('views')}
          columns={model.columns} facetKeys={facetKeys} filters={view.filters} facetRowsFor={facetRowsFor}
          onSetFilter={setFilter} onSetFacetKeys={setFacetKeys} />

        <div className="content">
          {error && <div className="error banner">{error}</div>}

          <div className="table-card">
            <div className="table-card-head">
              <QueryBar ref={searchRef} onSubmit={() => setJumpRequest((n) => n + 1)} columns={model.columns} colMap={colMap} rows={model.rows} filters={view.filters} search={search}
                facetRowsFor={facetRowsFor}
                onChange={(filters, freeText) => { if (filters) setView((v) => ({ ...v, filters })); setSearch(freeText) }} />
            </div>
            <div className="table-card-head sub">
              <div className="table-meta">
                {progress ? (
                  <span>Loading {progress.loaded.toLocaleString()} / {progress.total ? progress.total.toLocaleString() : '…'} {sourceLabel}
                    <span className="progress"><span style={{ width: `${progress.total ? (progress.loaded / progress.total) * 100 : 0}%` }} /></span>
                  </span>
                ) : meta && (
                  <span title={`${new Date(meta.from).toLocaleString()} → ${new Date(meta.to).toLocaleString()} · loaded ${meta.at.toLocaleTimeString()}`}>
                    <b>{sorted.length.toLocaleString()}</b> of {calls.length.toLocaleString()} {meta.sims == null ? (meta.calls == null ? 'conversations' : 'calls') : meta.calls == null ? 'runs' : 'rows'}
                    {meta.sims != null && <> · {meta.results?.toLocaleString()} result{meta.results === 1 ? '' : 's'}</>}
                    {meta.elOnly != null && (meta.calls != null || meta.sims != null) && <> · {meta.elOnly.toLocaleString()} 11Labs only</>}
                    {meta.elError && <span className="warn" title={meta.elError}> · 11Labs failed to load</span>}
                    {meta.truncated && <span className="warn" title="Narrow the range or raise the cap in Settings"> · capped at {calls.length.toLocaleString()}</span>}
                    {' '}· loaded {meta.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                {branchProgress && <span className="branch-progress">Loading 11Labs branches {branchProgress.done}/{branchProgress.total}…</span>}
                {variableProgress && <span className="branch-progress">Loading dynamic variables {variableProgress.done}/{variableProgress.total}…</span>}
                {meta && !needsVariables && !variableProgress && calls.some((c) => c.variables === undefined) && (
                  <button className="link" onClick={() => setWantVariables(true)}
                    title="Load each call's ElevenLabs / Retell dynamic variables as columns you can filter, sort and search on">
                    Load dynamic variables
                  </button>
                )}
                {!!meta?.sims && !SIM_COLUMNS.some((k) => view.visible.includes(k)) && (
                  <button className="link" onClick={() => setView((v) => ({ ...v, visible: [...v.visible, ...SIM_COLUMNS] }))}>Show result & scenario columns</button>
                )}
                {hasSims && (
                  <span className="group-controls">
                    <button className={`toggle small ${groupByResult ? 'on' : ''}`} aria-pressed={groupByResult} onClick={() => setGroupByResult(!groupByResult)}
                      title="Fold simulation runs under their result, like Cekura's result page">
                      <span className="toggle-box">{groupByResult ? '✓' : ''}</span>Group by result
                    </button>
                    {groupByResult && (
                      <>
                        <button className="link" onClick={() => setExpandedResults(new Set(sorted.flatMap((r) => (r.call.sim ? [r.call.sim.resultId] : []))))}>Expand all</button>
                        <button className="link" onClick={() => setExpandedResults(new Set())}>Collapse all</button>
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>
            <div className="table-card-body">
              <CallTable columns={visibleCols} rows={sorted} items={display} onToggleGroup={toggleGroup} sort={view.sort} filters={view.filters} widths={view.widths}
                selectedId={selectedId} cursorId={cursorId} settings={settings} facetRowsFor={facetRowsFor}
                onSort={onSort}
                onSelect={(r) => select(r.call.uid)}
                onResize={(col, w) => setView((v) => ({ ...v, widths: { ...v.widths, [col]: w } }))}
                onReorder={(from, to) => setView((v) => {
                  const next = v.visible.filter((k) => k !== from)
                  next.splice(next.indexOf(to), 0, from)
                  return { ...v, visible: next }
                })}
                onHide={(col) => setView((v) => ({ ...v, visible: v.visible.filter((k) => k !== col) }))}
                onSetFilter={setFilter} />
            </div>
          </div>
        </div>

        {selectedRow && (
          <CallDetail key={selectedRow.call.uid} row={selectedRow} settings={settings}
            position={selectedIndex >= 0 ? `${selectedIndex + 1} / ${sorted.length}` : 'not in filtered list'}
            onClose={() => select(null)} onPrev={() => step(-1)} onNext={() => step(1)}
            activePane={detailPane} onActivatePane={setDetailPane} paneRef={paneRef} />
        )}
      </div>

      {showSettings && (
        <SettingsDialog settings={settings} onClose={() => setShowSettings(false)}
          onSave={(s) => { setSettings(s); saveSettings(s) }} />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </div>
  )
}
