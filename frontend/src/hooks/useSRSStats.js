import { useState, useEffect } from 'react'
import { getSRSStats } from '../api/client'

export function useSRSStats() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSRSStats()
      .then((r) => setStats(r.data))
      .finally(() => setLoading(false))
  }, [])

  return { stats, loading }
}
