# Cekura Call Viewer

A fast, local alternative to the Cekura dashboard's call list. It loads every call log and simulation run in a time range up front, so you can filter and sort by any metric instantly, choose which metrics appear as columns, fold simulation runs under their result, and read a call's metrics, transcript, tool calls and recording without leaving the list. Every row links back to Cekura and to the call in ElevenLabs or Retell.

It runs on your machine against the Cekura API with your own API key. There's nothing to deploy.

## Quick start

You need Node 22.12+ and pnpm (`brew install pnpm`, or `corepack enable`).

```sh
git clone git@github.com:Boulevard/cekura-call-viewer.git
cd cekura-call-viewer
pnpm install
cp .env.example .env.local   # then set CEKURA_API_KEY
pnpm dev                     # http://localhost:5173
```

To get a Cekura API key, create one in the Cekura dashboard ([docs](https://docs.cekura.ai/api-reference/user/create-api-key)). If you already have the ai-receptionist repo set up, `packages/cekura/.env.local` there has one.

## Configuration

All settings go in `.env.local` (gitignored). Only the API key is required.

| Variable | Default | What it's for |
| --- | --- | --- |
| `CEKURA_API_KEY` | – | Cekura API key. The dev server adds it to API requests, so it never reaches the browser. |
| `VITE_CEKURA_PROJECT_ID` | `3201` | Project the app opens on before you've picked one. |

The ⚙ Settings dialog also lets you set an API key in the browser (stored in localStorage), raise the cap on how many calls are loaded, and change the ElevenLabs, Retell and Datadog link formats.

## Using it

### Loading data

Pick a project and a time range, then use the **Calls** and **Simulations** toggles to choose what to load. Turn both on to see production calls and simulation runs in one list. Cekura caps a range at 33 days, and the app stops at 10,000 rows by default (configurable in Settings).

Simulation runs are found through their results (test-suite executions) created in the range. They show a `SIM` tag, and the **Simulation** column group adds result, scenario, personality, expected outcome (met / partial / not met), evaluation status and agent version.

### Layout

- **Sidebar:** your saved views, plus checkbox filters with counts for Source, Success, Agent and Ended reason. Use **+ Add filter section** for any other column, × to remove one, and « to collapse the sidebar. Drag its right edge to resize it (double-click to reset). While a call is open it shrinks to a slim rail.
- **Theme:** ☀ / ☾ in the toolbar switches between light and dark. Until you pick one, it follows your system setting.

### Quick filters

In the toolbar:

- **Agent** — search and tick any number of Cekura agents.
- **Business** — search and tick any number of businesses (by the `Info: Business Name` metric); counts follow the other filters, and picked businesses stay at the top of the list.
- **All / Qualified** — show every call, or only calls where the `Qualified Call` metric passed.
- **Results** — paste a list of simulation result IDs (one per line, or separated by commas, spaces or tabs) to show only those results. Results outside the loaded time range, or with Simulations off, are fetched by ID and stay loaded while the filter is on; IDs that don't exist in the project are listed as not found. It sets a `result_id:(… OR …)` filter.

These set ordinary filters, so they appear as pills in the query bar, in the sidebar and in saved views, and removing the pill clears them. Calls that are still being evaluated don't have these metrics yet, so they drop out while either filter is on.

### Columns, sorting and filtering

- **Columns:** open **Columns** to show, hide and drag-reorder any field or metric found in the loaded data. Each metric shows its pass rate and failure count for the loaded calls, and there's a one-click button to show every metric with failures. Drag a header's edge to resize.
- **Header summaries:** pass rate and failure count for pass/fail metrics, average for numbers, number of distinct values for text. Click a header's `N✗` to show only the failures.
- **Sorting:** click a header; shift-click to add a secondary sort. Empty values always sort last.
- **Filtering:** use **+ Filter** or a header's `⋮` menu. Value lists come with live counts, numbers and times filter by range, and text filters by substring. Alt-click any cell to filter to that value.
- **Query bar:** the box at the top of the table takes Datadog-style queries and plain search text. Every active filter shows as a pill, wherever it was set (query, sidebar, header menus, alt-click, saved views); a pill's × removes it, clicking it puts it back into the text to edit, and Backspace at the start of the text reopens the last one. A typed `field:value` becomes a pill once it's finished (space, Enter, Tab or clicking away) and matches the data; anything else stays as free-text search. Autocomplete suggests field names as you type, then that field's values with counts; **Tab** completes, **↑/↓** choose. Mistakes are listed in the dropdown and keep their text until fixed.

  | Syntax | Meaning |
  | --- | --- |
  | `agent:"AI Receptionist - 11Labs prod"` | equals (quote values with spaces; case-insensitive) |
  | `-success:fail` | exclude |
  | `ended_reason:(user_hangup OR agent_hangup)` | any of |
  | `business_name:*salon*`, `call_id:conv_*b2f` | wildcard |
  | `branch:*` / `-feedback:*` | has a value / is empty |
  | `duration:>60`, `duration:<=2:00`, `duration:[0:30 TO 2:00]` | numbers, durations (m:ss or seconds) and times (`time:[2026-10-16T09:00 TO 2026-10-16T12:00]`) |
  | `tool_call_failure:fail` | pass/fail metrics take `pass`, `fail` or `na` |
  | anything else | free-text search across every column and ID (call, run, result, scenario, Cekura agent); `*` works as a wildcard here too |

  Field names are short forms of the column names (`agent`, `provider_agent`, `branch`, `result`, `scenario`, `ended_reason`…); metrics use their name in snake_case. Searching a result ID unfolds that result.
- **CSV:** exports the filtered rows with the visible columns, plus Cekura and provider links.

Metrics that Cekura skipped (trigger not met, or `VALID_SKIP`) show as **N/A**. Cekura's own list reports them as passed, so pass rates here can be lower than in the dashboard.

### Result groups

With **Group by result** on, runs from the same result fold under a result row, like Cekura's result page. The row shows the run count, how many passed, how many met the expected outcome, and a per-column rollup. Filters apply to the runs inside a group, and results with a single matching run show as a plain row. Use **Expand all** / **Collapse all**, click a result row, or press `Space` on it.

### Provider agent and branch

**Provider agent** shows the ElevenLabs or Retell `agent_id` that handled each call or run (the **Agent** column is the Cekura agent), and **Branch (11Labs)** shows the ElevenLabs `branch_id`; add them from **Columns**. Branches for production ElevenLabs calls need a large extra request per call (about 250KB), so they're only fetched while the Branch column is shown or used in a filter or sort; hide the column to skip that on long time ranges.

### Call detail

Click a row, or press `Enter`. The panel shows:

- Every metric with Cekura's explanation, failures first.
- The recording, with playback speed controls. Click any timestamp in the transcript to play from there.
- The transcript, with tool calls you can expand. Failed tool calls are flagged, and Retell calls can also show flow-node transitions.
- The call summary, dynamic variables, latency, cost and raw JSON.
- For simulation runs, the scenario instructions and the expected-outcome breakdown.

Each call or run has its own URL (`#call=<id>` or `#run=<id>`), so you can share links to them.

The detail header also links to Boulevard's backend logs in Datadog:

- **Datadog: this call** — logs tagged with the call's cart (`@blvd_metadata.cart_id`, the cart every AI receptionist call creates) plus the evaluation log that names the call ID, over the call's time window. Precise, but only what's tagged with the cart.
- **Datadog: location during call** — everything logged for the call's location (`@blvd_metadata.location_id`) between the call's start and end. Includes the call's tool requests, but also any unrelated activity at that location at the same time.

The caller's phone number isn't in the logs, so it can't be used. Neither link filters by service, so they work for production calls (`sched-prod`) and simulation runs (`sched-rel-ai-receptionist`, `sched-dev3`) alike. The Datadog base URL is in Settings.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `j` / `k` (or ↓ / ↑) | Move down / up the list. With a call open, step the detail panel to the next or previous call. |
| `Ctrl+D` / `Ctrl+U` | Page down / up |
| `gg` / `G` | Jump to the first / last row |
| `Enter` | Open the highlighted call, or fold/unfold a result row |
| `Space` | Same as Enter; on a run inside an open result, collapses that result |
| `←` / `→` (or `h` / `l`) | With a call open: make the metrics or transcript pane active (outlined). `Tab` toggles between them; clicking a pane also activates it. |
| `↑` / `↓` | With a pane active: scroll it (`Shift` or `Page Up`/`Page Down` for a page). With no pane active: step to the previous/next call. |
| `Esc` | Close the detail panel or the open menu |
| `/` | Focus search |
| `?` | Show all shortcuts |

### Saved views

The **View:** menu saves your columns, filters and sort under a name, optionally with the project, agent, time range and Calls/Simulations setting. A dot on the button means the active view has unsaved changes; from the menu you can save, revert, rename or delete views, or copy a link that carries the current setup.

Views are stored in `views.json` in the project folder, written by the dev server. It's gitignored, so your views stay yours. The browser keeps a copy in localStorage as a fallback.

## How it works

- `pnpm dev` runs a Vite dev server that serves the app and proxies `/cekura/*` to `https://api.cekura.ai`, adding your API key. It also serves a small local endpoint that reads and writes `views.json`.
- Everything else happens in the browser. The list is loaded once per query and kept in memory, which is why filtering and sorting are instant. Row details are fetched when you open them.
- Because the proxy adds your API key to every request, only run it on your own machine. Don't expose the dev server on a network or deploy it.

```
src/
  api.ts            Cekura API client (call logs, results, runs, agents)
  columns.ts        Column definitions and how each row's values are derived
  filters.ts        Filtering, sorting and header summaries
  grouping.ts       Folding simulation runs under their result
  views.ts          Saved views and views.json sync
  App.tsx           State, loading, keyboard shortcuts, toolbar
  components/       Table, detail panel, transcript, filter and column pickers, menus
vite.config.ts      Dev server: API proxy and the views.json endpoint
```

## Development

```sh
pnpm dev        # dev server with hot reload
pnpm typecheck  # TypeScript only
pnpm build      # typecheck + production build (what CI runs)
```

## Troubleshooting

- **401/403 when loading:** `CEKURA_API_KEY` is missing or wrong in `.env.local`. Restart `pnpm dev` after changing it.
- **Some agents are missing:** they probably had no production calls in the time range. Dev agents usually only appear as simulation runs, so turn on **Simulations** or widen the range.
- **A run says "not linked to a provider call":** Cekura couldn't match the run to an ElevenLabs or Retell conversation. Hover the cell for Cekura's error message.
- **Saved views are missing:** the app isn't running under `pnpm dev`, so it can't reach `views.json` and falls back to the browser's copy. The Views menu says where views are being saved.
