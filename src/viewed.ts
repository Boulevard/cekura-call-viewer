import { useCallback, useEffect, useState } from 'react'
import type { CallLog } from './types'
import { load, save } from './storage'

/**
 * Which calls you've opened, kept in this browser only. Keyed by provider call ID where there is
 * one, so an 11Labs-only conversation stays viewed once Cekura imports it.
 */
export type ViewedMap = Record<string, number>

const KEY = 'viewed'
const MAX_AGE_MS = 60 * 86400e3

export const viewKey = (c: CallLog) => c.call_id || c.uid

function loadViewed(): ViewedMap {
  const cutoff = Date.now() - MAX_AGE_MS
  return Object.fromEntries(Object.entries(load<ViewedMap>(KEY, {})).filter(([, at]) => at >= cutoff))
}

export function useViewed() {
  const [viewed, setViewed] = useState<ViewedMap>(loadViewed)
  useEffect(() => save(KEY, viewed), [viewed])
  // Another tab viewing calls updates this one too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === `ccv.${KEY}`) setViewed(loadViewed()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /** Marks calls viewed now, or unviewed with `false`. */
  const mark = useCallback((keys: string[], isViewed: boolean) => {
    setViewed((prev) => {
      const next = { ...prev }
      const now = Date.now()
      for (const k of keys) {
        if (isViewed) next[k] = now
        else delete next[k]
      }
      return next
    })
  }, [])
  const clear = useCallback(() => setViewed({}), [])
  return { viewed, mark, clear }
}
