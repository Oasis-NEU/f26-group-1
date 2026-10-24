import { useCallback, useEffect, useState } from 'react'

type AsyncState<T> = { data?: T; error?: string; loading: boolean }

// Runs `load` on mount and whenever it changes (wrap it in useCallback);
// `reload` runs it again after a change. Stale responses are ignored.
export function useAsync<T>(load: () => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>({ loading: true })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let active = true
    load().then(
      (data) => active && setState({ data, loading: false }),
      (e: unknown) => active && setState({ error: errorMessage(e), loading: false }),
    )
    return () => {
      active = false
    }
  }, [load, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { ...state, reload }
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}
