import { useState } from 'react'

export const isPhoneNumber = (v: unknown) => typeof v === 'string' && /^\+?\d[\d\s().-]{7,}\d$/.test(v.trim())

/** Small copy-to-clipboard button; stops the click so it never opens or selects the row. */
export function CopyIcon({ text, title = 'Copy' }: { text: string; title?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className={`copy-icon ${done ? 'done' : ''}`} title={done ? 'Copied' : title}
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1000)
      }}>
      {done ? '✓' : '⧉'}
    </button>
  )
}
