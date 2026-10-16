import { useEffect, useState } from 'react'
import { load, save } from './storage'

export type Theme = 'light' | 'dark'

const systemTheme = (): Theme => (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark')

/** Follows the OS setting until the user picks a theme, then remembers that choice. */
export function useTheme() {
  const [chosen, setChosen] = useState<Theme | null>(() => load<Theme | null>('theme', null))
  const [system, setSystem] = useState<Theme>(systemTheme)
  const theme = chosen ?? system

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    const onChange = () => setSystem(systemTheme())
    mq?.addEventListener('change', onChange)
    return () => mq?.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setChosen(next)
    save('theme', next)
  }
  return [theme, toggle] as const
}
