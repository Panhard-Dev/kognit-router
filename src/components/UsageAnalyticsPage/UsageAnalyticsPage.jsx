import { useEffect, useMemo, useState } from 'react'
import './UsageAnalyticsPage.css'

const API = '/api'

const emptyAnalytics = {
  summary: {
    totalRequests: 0,
    successRequests: 0,
    errorRequests: 0,
    errorRate: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    avgLatencyMs: 0,
  },
  timeline: [],
  topModels: [],
  providerStats: [],
  recentErrors: [],
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value) || 0)
}

function formatLatency(value) {
  const latency = Number(value) || 0
  return latency ? `${formatNumber(latency)}ms` : '0ms'
}

function formatPercent(value) {
  const number = Number(value) || 0
  return `${number.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function formatDate(value) {
  if (!value) return 'never'
  return new Date(value).toLocaleString('pt-BR')
}

function StatCard({ label, value, detail }) {
  return (
    <div className="usage-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  )
}

function TimelineChart({ data }) {
  const maxRequests = Math.max(1, ...data.map(item => item.requests || 0))

  return (
    <div className="usage-chart">
      <div className="usage-chart__bars">
        {data.map(item => {
          const height = Math.max(4, Math.round(((item.requests || 0) / maxRequests) * 100))
          return (
            <div className="usage-chart__bar-wrap" key={item.time} title={`${item.label}: ${item.requests} requests`}>
              <span
                className={`usage-chart__bar ${item.errors ? 'usage-chart__bar--error' : ''}`}
                style={{ height: `${height}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="usage-chart__labels">
        {data.filter((_, index) => index % 4 === 0).map(item => (
          <span key={item.time}>{item.label}</span>
        ))}
      </div>
    </div>
  )
}

export default function UsageAnalyticsPage() {
  const [analytics, setAnalytics] = useState(emptyAnalytics)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const summary = analytics.summary || emptyAnalytics.summary
  const hasUsage = summary.totalRequests > 0

  const stats = useMemo(() => ([
    {
      label: 'Total Requests',
      value: formatNumber(summary.totalRequests),
      detail: `${formatNumber(summary.successRequests)} sucesso / ${formatNumber(summary.errorRequests)} erro`,
    },
    {
      label: 'Tokens usados',
      value: formatNumber(summary.totalTokens),
      detail: `${formatNumber(summary.promptTokens)} input / ${formatNumber(summary.completionTokens)} output`,
    },
    {
      label: 'Latencia media',
      value: formatLatency(summary.avgLatencyMs),
      detail: 'media das chamadas /v1',
    },
    {
      label: 'Taxa de erro',
      value: formatPercent(summary.errorRate),
      detail: 'ultimas 24 horas',
    },
  ]), [summary])

  async function loadAnalytics() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API}/usage/analytics?range=24h`)
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Falha carregando analytics')
      setAnalytics({ ...emptyAnalytics, ...data })
    } catch (err) {
      setError(err.message || 'Backend nao acessivel')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let ignore = false

    fetch(`${API}/usage/analytics?range=24h`)
      .then(res => res.json().then(data => ({ res, data })))
      .then(({ res, data }) => {
        if (ignore) return
        if (!res.ok || data.error) throw new Error(data.error || 'Falha carregando analytics')
        setAnalytics({ ...emptyAnalytics, ...data })
      })
      .catch(err => {
        if (!ignore) setError(err.message || 'Backend nao acessivel')
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [])

  return (
    <div className="usage">
      <header className="usage__top">
        <div>
          <span>ANALYTICS</span>
          <h1>Usage & Analytics</h1>
          <p>Requests, tokens, latencia e erros das chamadas reais feitas no /v1.</p>
        </div>
        <button className="usage__refresh" type="button" onClick={loadAnalytics} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </header>

      {error && <div className="usage__error">{error}</div>}

      {!loading && !hasUsage && (
        <section className="usage__empty">
          <strong>Nenhuma chamada registrada ainda.</strong>
          <span>Use `http://localhost:3001/v1/chat/completions` ou `/v1/messages`; depois clique em Refresh.</span>
        </section>
      )}

      <section className="usage__stats">
        {stats.map(item => (
          <StatCard key={item.label} {...item} />
        ))}
      </section>

      <section className="usage__box">
        <div className="usage__box-header">
          <div>
            <h2>Requests por hora</h2>
            <p>Janela fixa de 24 horas.</p>
          </div>
          <span>{analytics.range || '24h'}</span>
        </div>
        <TimelineChart data={analytics.timeline || []} />
      </section>

      <div className="usage__split">
        <section className="usage__box">
          <div className="usage__box-header">
            <div>
              <h2>Modelos mais usados</h2>
              <p>Ordenado por volume de chamadas.</p>
            </div>
          </div>
          {(analytics.topModels || []).length === 0 ? (
            <div className="usage__muted">Sem modelos registrados.</div>
          ) : (
            <div className="usage-table">
              <table>
                <thead>
                  <tr>
                    <th>Modelo</th>
                    <th>Req</th>
                    <th>Tokens</th>
                    <th>Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.topModels.map(item => (
                    <tr key={`${item.providerId}:${item.model}`}>
                      <td>
                        <strong>{item.model}</strong>
                        <span>{item.providerName || item.providerId}</span>
                      </td>
                      <td>{formatNumber(item.requests)}</td>
                      <td>{formatNumber(item.tokens)}</td>
                      <td>{formatPercent(item.errorRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="usage__box">
          <div className="usage__box-header">
            <div>
              <h2>Providers</h2>
              <p>Uso agregado por provider.</p>
            </div>
          </div>
          {(analytics.providerStats || []).length === 0 ? (
            <div className="usage__muted">Sem providers registrados.</div>
          ) : (
            <div className="usage-table">
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Req</th>
                    <th>Latencia</th>
                    <th>Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.providerStats.map(item => (
                    <tr key={item.providerId}>
                      <td>
                        <strong>{item.providerName}</strong>
                        <span>{item.providerId}</span>
                      </td>
                      <td>{formatNumber(item.requests)}</td>
                      <td>{formatLatency(item.avgLatencyMs)}</td>
                      <td>{formatPercent(item.errorRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="usage__box">
        <div className="usage__box-header">
          <div>
            <h2>Erros recentes</h2>
            <p>Ultimos erros sanitizados. Sem prompt, resposta ou token salvo.</p>
          </div>
          <span>{(analytics.recentErrors || []).length}</span>
        </div>
        {(analytics.recentErrors || []).length === 0 ? (
          <div className="usage__muted">Nenhum erro registrado nas ultimas 24 horas.</div>
        ) : (
          <div className="usage-table usage-table--errors">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Rota</th>
                  <th>Modelo</th>
                  <th>Status</th>
                  <th>Erro</th>
                </tr>
              </thead>
              <tbody>
                {analytics.recentErrors.map(item => (
                  <tr key={item.id}>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>{item.route}</td>
                    <td>{item.model || 'unknown'}</td>
                    <td>{item.statusCode}</td>
                    <td>{item.error || item.errorType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
