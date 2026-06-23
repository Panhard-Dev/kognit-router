import { useEffect, useState, useCallback, useRef } from 'react'
import './QuotaTrackerPage.css'

function formatResetTime(date) {
  if (!date) return '-'
  const diffMs = new Date(date) - new Date()
  if (diffMs <= 0) return 'expirada'
  const totalMin = Math.ceil(diffMs / 60000)
  if (totalMin < 60) return `em ${totalMin}min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h < 24) return `em ${h}h ${m}min`
  const d = Math.floor(h / 24)
  return `em ${d}d ${h % 24}h ${m}min`
}

function getBarColor(pct) {
  if (pct > 70) return '#4ade80'
  if (pct > 30) return '#facc15'
  return '#f87171'
}

function QuotaRow({ name, used, total, remainingPercentage, resetAt }) {
  const pct = remainingPercentage != null
    ? Math.round(remainingPercentage)
    : total > 0 ? Math.round(((total - used) / total) * 100) : 0
  const color = getBarColor(pct)
  const usedDisplay = typeof used === 'number' ? used.toLocaleString('pt-BR') : '?'
  const totalDisplay = total === Infinity || !total ? '\u221e' : total.toLocaleString('pt-BR')

  return (
    <div className="quota-row">
      <span className="quota-row__dot" style={{ background: color }} />
      <span className="quota-row__name" title={name}>{name}</span>
      <div className="quota-row__bar-area">
        <div className="quota-row__numbers">{usedDisplay} / {totalDisplay}</div>
        <div className="quota-row__bar">
          <div className="quota-row__bar-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
      <span className="quota-row__pct" style={{ color }}>{pct}%</span>
      <span className="quota-row__reset">{formatResetTime(resetAt)}</span>
    </div>
  )
}

export default function QuotaTrackerPage() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [countdown, setCountdown] = useState(60)
  const intervalRef = useRef(null)
  const countdownRef = useRef(null)

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch('/api/usage')
      if (res.ok) {
        const data = await res.json()
        setProviders(data)
      }
    } catch {
      setProviders([])
    }
    setLoading(false)
    setCountdown(60)
  }, [])

  useEffect(() => {
    const initialFetch = setTimeout(fetchAll, 0)
    return () => clearTimeout(initialFetch)
  }, [fetchAll])

  useEffect(() => {
    intervalRef.current = setInterval(fetchAll, 60000)
    countdownRef.current = setInterval(() => setCountdown(p => p <= 1 ? 60 : p - 1), 1000)
    return () => { clearInterval(intervalRef.current); clearInterval(countdownRef.current) }
  }, [fetchAll])

  return (
    <div className="quota">
      <header className="quota__top">
        <div>
          <span>LIMITS</span>
          <h1>Quota Tracker</h1>
          <p>Quotas reais dos providers conectados. Auto-refresh {countdown}s.</p>
        </div>
        <button type="button" onClick={fetchAll} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </header>

      {loading && providers.length === 0 && (
        <div className="quota__empty">Carregando quotas...</div>
      )}

      {!loading && providers.length === 0 && (
        <div className="quota__empty">Nenhum provider com quota tracking. Conecte Antigravity ou Kiro.</div>
      )}

      <div className="quota__grid">
        {providers.map((provider, idx) => {
          const quotaEntries = Object.entries(provider.quotas || {})
          return (
          <div key={provider.connectionId || idx} className="quota-card">
            <div className="quota-card__header">
              <div className="quota-card__identity">
                <img
                  className="quota-card__logo"
                  src={`/providers/${provider.providerId === 'antigravity' ? 'antigravity' : 'kiro'}.png`}
                  alt=""
                  onError={(e) => { e.target.style.display = 'none' }}
                />
                <div>
                  <strong>{provider.providerId === 'antigravity' ? 'Antigravity' : 'Kiro'}</strong>
                  <span>{provider.connectionName || `Account ${idx + 1}`}</span>
                </div>
              </div>
              <div className="quota-card__actions">
                {quotaEntries.length > 0 && (
                  <span className="quota-card__count">
                    {quotaEntries.length} {quotaEntries.length === 1 ? 'modelo' : 'modelos'}
                  </span>
                )}
                <button
                  className="quota-card__action"
                  onClick={fetchAll}
                  title="Atualizar quotas"
                  aria-label="Atualizar quotas"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
                </button>
              </div>
            </div>

            {provider.error && (
              <div className="quota-card__error">{provider.error}</div>
            )}

            {quotaEntries.length > 0 && (
              <div className="quota-card__rows">
                {quotaEntries.map(([key, q]) => (
                  <QuotaRow
                    key={key}
                    name={q.displayName || (key === 'credit' ? 'Créditos' : key)}
                    used={q.used}
                    total={q.total}
                    remainingPercentage={q.remainingPercentage}
                    resetAt={q.resetAt}
                  />
                ))}
              </div>
            )}

            {provider.plan && (
              <div className="quota-card__plan">{provider.plan}</div>
            )}
          </div>
          )
        })}
      </div>
    </div>
  )
}
