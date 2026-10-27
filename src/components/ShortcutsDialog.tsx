const SHORTCUTS: [string[], string][] = [
  [['j', 'k'], 'Move down / up (with a call open, step to the next / previous call)'],
  [['Ctrl+D', 'Ctrl+U'], 'Page down / up'],
  [['g g', 'G'], 'Jump to the first / last row'],
  [['Ctrl+R'], 'Reload the calls (keeps your filters, columns and open call)'],
  [['Enter'], 'Open the highlighted call, or fold/unfold a result'],
  [['Space'], 'Same as Enter; on a run inside a result, collapses it'],
  [['←', '→'], 'With a call open: make the metrics / transcript pane active (also h / l, or Tab to toggle)'],
  [['↑', '↓'], 'Scroll the active pane (Shift or Page Up/Down for a page); with no pane active, step calls'],
  [['Esc'], 'Close the detail panel or menu'],
  [['/'], 'Search (Enter jumps to the first result)'],
  [['?'], 'Show this list'],
]

const TIPS = [
  'Click a header to sort; shift-click to add a secondary sort.',
  'Alt-click any cell to filter to that value.',
  'Drag headers to reorder and their edges to resize.',
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <div className="shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what} style={{ display: 'contents' }}>
              <span>{keys.map((k) => <span key={k} className="kbd">{k}</span>)}</span>
              <span>{what}</span>
            </div>
          ))}
        </div>
        <h3>Mouse</h3>
        {TIPS.map((t) => <div key={t} className="muted">{t}</div>)}
        <div className="modal-actions"><span className="spacer" /><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
