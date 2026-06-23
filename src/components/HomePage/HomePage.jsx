import { useState, useEffect } from 'react'
import './HomePage.css'

const API = '/api'

export default function HomePage() {
  const [localUrl, setLocalUrl] = useState(null)
  const [tunnelActive, setTunnelActive] = useState(false)
  const [tunnelUrl, setTunnelUrl] = useState(null)
  const [tunnelLoading, setTunnelLoading] = useState(false)
  const [tunnelError, setTunnelError] = useState(null)

  const [compressRTK, setCompressRTK] = useState(true)
  const [compressCaveman, setCompressCaveman] = useState(true)
  const [cavemanMode, setCavemanMode] = useState('ultra')

  const [requireKey, setRequireKey] = useState(false)
  const [keys, setKeys] = useState([])

  useEffect(() => {
    fetch(`${API}/tunnel/status`)
      .then(r => r.json())
      .then(data => {
        setTunnelActive(data.active)
        setTunnelUrl(data.url)
        setLocalUrl(data.localUrl)
      })
      .catch(() => {})

    fetch(`${API}/keys`)
      .then(r => r.json())
      .then(setKeys)
      .catch(() => {})
  }, [])

  async function toggleTunnel() {
    setTunnelError(null)
    if (tunnelActive) {
      setTunnelLoading(true)
      const res = await fetch(`${API}/tunnel/stop`, { method: 'POST' })
      const data = await res.json()
      setTunnelActive(data.active)
      setTunnelUrl(data.url)
      setLocalUrl(data.localUrl || localUrl)
      setTunnelLoading(false)
    } else {
      setTunnelLoading(true)
      try {
        const res = await fetch(`${API}/tunnel/start`, { method: 'POST' })
        const data = await res.json()
        setLocalUrl(data.localUrl || localUrl)
        if (!res.ok || data.error) {
          setTunnelError(data.error)
          setTunnelActive(false)
          setTunnelUrl(null)
        } else {
          setTunnelActive(data.active)
          setTunnelUrl(data.url)
        }
      } catch {
        setTunnelError('Backend não acessível. Rode: node server/index.js')
      }
      setTunnelLoading(false)
    }
  }

  async function createKey() {
    const name = prompt('Nome da key:')
    if (!name) return
    const res = await fetch(`${API}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const key = await res.json()
    setKeys([...keys, key])
  }

  async function toggleKey(id, active) {
    await fetch(`${API}/keys/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    })
    setKeys(keys.map(k => k.id === id ? { ...k, active: !k.active } : k))
  }

  async function deleteKey(id) {
    if (!confirm('Deletar esta key?')) return
    await fetch(`${API}/keys/${id}`, { method: 'DELETE' })
    setKeys(keys.filter(k => k.id !== id))
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="home">
      <header className="home__header">
        <div className="home__logo-row">
          <svg className="home__orbital" viewBox="0 0 40 40" width="36" height="36">
            <circle cx="20" cy="20" r="3" fill="#fff" />
            <ellipse cx="20" cy="20" rx="12" ry="12" fill="none" stroke="#fff" strokeWidth="0.5" className="orbit orbit--1" />
            <ellipse cx="20" cy="20" rx="16" ry="8" fill="none" stroke="#fff" strokeWidth="0.4" className="orbit orbit--2" />
            <ellipse cx="20" cy="20" rx="8" ry="16" fill="none" stroke="#fff" strokeWidth="0.4" className="orbit orbit--3" />
          </svg>
          <h1 className="home__title">KOGNIT</h1>
        </div>
        <p className="home__tagline">Centralize. Traduza. Orquestre.</p>
      </header>

      <section className="home__box">
        <div className="home__box-header">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4m0 12v4m-7.07-2.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-2.93 7.07l-2.83-2.83M6.76 6.76L3.93 3.93" />
          </svg>
          <h2>API Endpoint</h2>
        </div>

        <div className="home__endpoint-row">
          <span className="home__endpoint-label">Local</span>
          <div className="home__endpoint-value">
            <code>{localUrl || 'Nenhum endpoint local /v1 ativo'}</code>
            {localUrl && (
              <button className="home__copy-btn" onClick={() => copyToClipboard(localUrl)} title="Copiar">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="home__endpoint-row">
          <span className="home__endpoint-label home__endpoint-label--tunnel">Tunnel</span>
          <div className="home__endpoint-value">
            <code>{tunnelLoading ? 'Conectando...' : (tunnelActive && tunnelUrl) || 'Nenhum tunnel ativo'}</code>
            {tunnelActive && tunnelUrl && (
              <button className="home__copy-btn" onClick={() => copyToClipboard(tunnelUrl)} title="Copiar">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
            <button
              className={`home__power-btn ${tunnelActive ? 'home__power-btn--active' : ''} ${tunnelLoading ? 'home__power-btn--loading' : ''}`}
              onClick={toggleTunnel}
              title={tunnelActive ? 'Desligar túnel' : 'Ligar túnel'}
              disabled={tunnelLoading}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="2" x2="12" y2="6" />
                <path d="M16.24 7.76a6 6 0 11-8.49 0" />
                <circle cx="12" cy="14" r="6" fill="none" />
              </svg>
            </button>
          </div>
        </div>

        {tunnelError && (
          <div className="home__error">{tunnelError}</div>
        )}
      </section>

      <section className="home__box">
        <div className="home__box-header home__box-header--accent">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13,2 3,14 12,14 11,22 21,10 12,10" />
          </svg>
          <h2>Token Saver</h2>
        </div>

        <div className="home__token-row">
          <div className="home__token-info">
            <span className="home__token-title">Compress tool output <span className="home__token-tag">(RTK)</span></span>
            <span className="home__token-desc">git/grep/ls/tree/logs → 60-90% fewer input tokens</span>
          </div>
          <label className="home__toggle">
            <input type="checkbox" checked={compressRTK} onChange={() => setCompressRTK(!compressRTK)} />
            <span className="home__toggle-slider"></span>
          </label>
        </div>

        <div className="home__token-row">
          <div className="home__token-info">
            <span className="home__token-title">Compress LLM output <span className="home__token-tag">(Caveman)</span></span>
            <span className="home__token-desc">Terse-style system prompt → ~65% fewer output tokens (up to 87%)</span>
          </div>
          <div className="home__token-controls">
            <div className="home__mode-group">
              {['Lite', 'Full', 'Ultra'].map((mode) => (
                <button
                  key={mode}
                  className={`home__mode-btn ${cavemanMode === mode.toLowerCase() ? 'home__mode-btn--active' : ''}`}
                  onClick={() => setCavemanMode(mode.toLowerCase())}
                >
                  {mode}
                </button>
              ))}
            </div>
            <label className="home__toggle">
              <input type="checkbox" checked={compressCaveman} onChange={() => setCompressCaveman(!compressCaveman)} />
              <span className="home__toggle-slider"></span>
            </label>
          </div>
        </div>
      </section>

      <section className="home__box">
        <div className="home__box-header">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 7h2a5 5 0 010 10h-2m-6 0H7A5 5 0 017 7h2" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          <h2>API Keys</h2>
          <button className="home__create-key-btn" onClick={createKey}>+ Create Key</button>
        </div>

        <div className="home__token-row">
          <div className="home__token-info">
            <span className="home__token-title">Require API key</span>
            <span className="home__token-desc">Requests without a valid key will be rejected</span>
          </div>
          <label className="home__toggle">
            <input type="checkbox" checked={requireKey} onChange={() => setRequireKey(!requireKey)} />
            <span className="home__toggle-slider"></span>
          </label>
        </div>

        {keys.map((key) => (
          <div className="home__key-row" key={key.id}>
            <div className="home__key-info">
              <span className="home__key-name">{key.name}</span>
              <span className="home__key-preview">{key.preview}</span>
              <span className="home__key-date">Created {key.created}</span>
            </div>
            <button className="home__delete-btn" onClick={() => deleteKey(key.id)} title="Deletar">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="3,6 5,6 21,6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6m4-6v6" />
              </svg>
            </button>
            <label className="home__toggle">
              <input type="checkbox" checked={key.active} onChange={() => toggleKey(key.id, key.active)} />
              <span className="home__toggle-slider"></span>
            </label>
          </div>
        ))}

        {keys.length === 0 && (
          <div className="home__empty">Nenhuma key criada.</div>
        )}
      </section>
    </div>
  )
}
