import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, fetchCallBranches, listCalls, listProjects, listProviderAgents, listSims, type Project } from './api'
import { buildModel, DEFAULT_METRIC_NAMES, DEFAULT_VISIBLE, SIM_COLUMNS, withDefaultMetrics, type Column } from './columns'
import { applyFilters, applySort, type Filter, type SortSpec, type ViewState } from './filters'
import { loadSettings, saveSettings, type Settings } from './settings'
import { load as loadStored, save, usePersistentState } from './storage'
import type { CallLog } from './types'
import { downloadCsv } from './csv'
import { buildDisplay, groupKey } from './grouping'
import { CallTable, ROW_HEIGHT } from './components/CallTable'
import { CallDetail } from './components/CallDetail'
import { ColumnPicker } from './components/ColumnPicker'
import { FilterBar } from './components/FilterBar'
import { Popover } from './components/Popover'
import { SettingsDialog } from './components/SettingsDialog'
import { ViewsMenu } from './components/ViewsMenu'
import { ProjectPicker } from './components/ProjectPicker'
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
  { key: 'calls', label: 'Calls' },
  { key: 'sims', label: 'Simulations' },
] as const

function sourceIncludes(source: DataSource, key: 'calls' | 'sims') {
  return source === 'both' || source === key
}

/** Flips one toggle; turning off the only active source is ignored so something is always loaded. */
function toggleSource(source: DataSource, key: 'calls' | 'sims'): DataSource {
  const calls = key === 'calls' ? !sourceIncludes(source, 'calls') : sourceIncludes(source, 'calls')
  const sims = key === 'sims' ? !sourceIncludes(source, 'sims') : sourceIncludes(source, 'sims')
  if (calls && sims) return 'both'
  if (calls) return 'calls'
  if (sims) return 'sims'
  return source
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

/** `#call=<id>` or `#run=<id>`, returned as the row uid (`call:<id>` / `run:<id>`). */
function readHashSelection(): string | null {
  const m = location.hash.match(/(call|run)=(\d+)/)
  return m ? `${m[1]}:${m[2]}` : null
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
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!shared) return
    if (shared.view) setView({ ...DEFAULT_VIEW, ...shared.view })
    setActiveViewId(null)
    if (shared.query) setQuery({ ...DEFAULT_QUERY, ...shared.query })
    history.replaceState(null, '', location.pathname + location.hash)
  }, [shared, setView, setQuery, setActiveViewId])

  const load = useCallback(async (q: Query = query) => {
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
    const listQuery = { projectId: q.projectId, agentId: q.agentId ? Number(q.agentId) : undefined, ...range }
    // Calls and simulations load in parallel; the progress bar shows their combined count.
    const parts = { calls: { loaded: 0, total: 0 }, sims: { loaded: 0, total: 0 } }
    const report = (key: 'calls' | 'sims') => (loaded: number, total: number) => {
      parts[key] = { loaded, total }
      setProgress({ loaded: parts.calls.loaded + parts.sims.loaded, total: parts.calls.total + parts.sims.total })
    }
    try {
      const [callRes, simRes, providerAgents] = await Promise.all([
        source !== 'sims' ? listCalls(settings, listQuery, report('calls'), ctrl.signal) : null,
        source !== 'calls' ? listSims(settings, listQuery, report('sims'), ctrl.signal) : null,
        // Only used to label rows; a failure here shouldn't block the list.
        listProviderAgents(settings, q.projectId).catch(() => new Map<number, string>()),
      ])
      const withAgents = [...(callRes?.calls ?? []), ...(simRes?.calls ?? [])].map((c) => ({
        ...c,
        providerAgentId: c.providerAgentId ?? providerAgents.get(c.agent) ?? null,
        // Production ElevenLabs calls start with an unknown branch (undefined) until it's fetched.
        branchId: c.source === 'sim' ? c.branchId ?? null : c.call_id?.startsWith('conv_') ? undefined : null,
      }))
      setCalls(withAgents)
      setMeta({
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
  const colMap = useMemo(() => new Map(model.columns.map((c) => [c.key, c])), [model.columns])

  // One-time: the provider agent and branch columns joined the default view after views were already being persisted.
  useEffect(() => {
    if (loadStored('migratedProviderColumns', false)) return
    save('migratedProviderColumns', true)
    setView((v) => {
      const missing = ['provider_agent', 'branch'].filter((k) => !v.visible.includes(k))
      if (missing.length === 0) return v
      const next = [...v.visible]
      const at = next.indexOf('agent_name')
      next.splice(at >= 0 ? at + 1 : next.length, 0, ...missing)
      return { ...v, visible: next }
    })
  }, [setView])

  // One-time: business and location columns joined the default view after views were already
  // being persisted. Applied once the loaded data actually has those metrics.
  useEffect(() => {
    if (loadStored('migratedBusinessColumns', false)) return
    const has = model.columns.some((c) => c.metricId != null && DEFAULT_METRIC_NAMES.some((n) => n.toLowerCase() === c.label.toLowerCase()))
    if (!has) return
    save('migratedBusinessColumns', true)
    setView((v) => ({ ...v, visible: withDefaultMetrics(v.visible, model.columns) }))
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

  // vim-style "gg": the first g only arms the jump, which a second g within half a second completes.
  const pendingG = useRef(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
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
  }, [selectedId, cursorId, display, step, select, toggleGroup])

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

  const agents = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of calls) m.set(c.agent, c.agent_name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [calls])

  const sourceLabel = (query.source ?? 'calls') === 'calls' ? 'calls' : query.source === 'sims' ? 'simulation runs' : 'calls & runs'

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand"><span className="brand-mark" /><span className="brand-text">Cekura Calls</span></div>
        <ProjectPicker projects={projects} value={query.projectId}
          onChange={(projectId) => { const q = { ...query, projectId, agentId: '' }; setQuery(q); load(q) }} />
        <label className="field-pill" title="Only load one Cekura agent (all agents when empty)">Agent
          <input list="agents" placeholder="all" value={query.agentId} onChange={(e) => setQuery({ ...query, agentId: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && load()} />
          <datalist id="agents">{agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</datalist>
        </label>
        <div className="source-toggles">
          {SOURCE_TOGGLES.map((t) => {
            const source = query.source ?? 'calls'
            const on = sourceIncludes(source, t.key)
            const only = on && source !== 'both'
            return (
              <button key={t.key} className={`toggle ${on ? 'on' : ''}`} aria-pressed={on}
                title={only ? 'At least one source has to stay on' : on ? `Hide ${t.label.toLowerCase()}` : `Include ${t.label.toLowerCase()}`}
                onClick={() => {
                  const next = toggleSource(source, t.key)
                  if (next === source) return
                  const q = { ...query, source: next }
                  setQuery(q)
                  load(q)
                }}>
                <span className="toggle-box">{on ? '✓' : ''}</span>{t.label}
              </button>
            )
          })}
        </div>
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
        <span className="spacer" />
        <input ref={searchRef} className="search" placeholder="Search IDs, phones, results, scenarios…  /" value={search} onChange={(e) => setSearch(e.target.value)} />
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
        <button className="btn" onClick={() => downloadCsv(sorted, visibleCols, settings)} disabled={!sorted.length}>Export</button>
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
              <FilterBar columns={model.columns} colMap={colMap} rows={model.rows} filters={view.filters} search={search}
                onSetFilter={setFilter} onClearAll={() => setView((v) => ({ ...v, filters: [] }))} />
              <div className="table-meta">
                {progress ? (
                  <span>Loading {progress.loaded.toLocaleString()} / {progress.total ? progress.total.toLocaleString() : '…'} {sourceLabel}
                    <span className="progress"><span style={{ width: `${progress.total ? (progress.loaded / progress.total) * 100 : 0}%` }} /></span>
                  </span>
                ) : meta && (
                  <span title={`${new Date(meta.from).toLocaleString()} → ${new Date(meta.to).toLocaleString()} · loaded ${meta.at.toLocaleTimeString()}`}>
                    <b>{sorted.length.toLocaleString()}</b> of {calls.length.toLocaleString()} {meta.sims == null ? 'calls' : meta.calls == null ? 'runs' : 'rows'}
                    {meta.sims != null && <> · {meta.results?.toLocaleString()} results</>}
                    {meta.truncated && <span className="warn" title="Narrow the range or raise the cap in Settings"> · capped at {calls.length.toLocaleString()}</span>}
                    {' '}· loaded {meta.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                {branchProgress && <span className="branch-progress">Loading 11Labs branches {branchProgress.done}/{branchProgress.total}…</span>}
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
            onClose={() => select(null)} onPrev={() => step(-1)} onNext={() => step(1)} />
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
