const SHORTCUTS: [string[], string][] = [
  [['j', 'k'], 'Move down / up (with a call open, step to the next / previous call)'],
  [['Ctrl+D', 'Ctrl+U'], 'Page down / up'],
  [['g g', 'G'], 'Jump to the first / last row'],
  [['Enter'], 'Open the highlighted call, or fold/unfold a result'],
  [['Space'], 'Same as Enter; on a run inside a result, collapses it'],
  [['Esc'], 'Close the detail panel or menu'],
  [['/'], 'Search'],
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
