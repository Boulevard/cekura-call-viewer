import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'

const EDGE = 8

export function Popover({ onClose, children, className = '', align = 'left' }: {
  onClose: () => void
  children: ReactNode
  className?: string
  align?: 'left' | 'right'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Deferred so the click that opened the popover doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown))
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // The toolbar wraps on narrower windows, so a trigger can end up at either edge. Keep the preferred
  // alignment when it fits, flip to the other side when it doesn't, and clamp as a last resort.
  useLayoutEffect(() => {
    const el = ref.current
    const anchor = el?.offsetParent
    if (!el || !anchor) return
    const place = () => {
      const vw = document.documentElement.clientWidth
      const vh = window.innerHeight
      el.style.maxWidth = `${vw - EDGE * 2}px`
      const a = anchor.getBoundingClientRect()
      const w = el.offsetWidth
      const fits = (x: number) => x >= EDGE && x + w <= vw - EDGE
      const leftX = a.left
      const rightX = a.right - w
      const [first, second] = align === 'left' ? [leftX, rightX] : [rightX, leftX]
      const x = fits(first) ? first : fits(second) ? second : Math.min(Math.max(first, EDGE), vw - EDGE - w)
      el.style.left = `${x - a.left}px`
      el.style.right = 'auto'
      const room = vh - el.getBoundingClientRect().top - EDGE
      const tooTall = el.scrollHeight > room
      el.style.maxHeight = tooTall ? `${Math.max(room, 120)}px` : ''
      el.style.overflowY = tooTall ? 'auto' : ''
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [align])

  return (
    <div ref={ref} className={`popover popover-${align} ${className}`} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}
