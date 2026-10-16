import { useEffect, useState } from 'react'

const PREFIX = 'ccv.'

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value))
}

export function usePersistentState<T>(key: string, fallback: T | (() => T)) {
  const [value, setValue] = useState<T>(() =>
    typeof fallback === 'function' ? (fallback as () => T)() : load(key, fallback))
  useEffect(() => save(key, value), [key, value])
  return [value, setValue] as const
}
