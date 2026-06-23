import { useEffect, useMemo, useState } from 'react'
import './CliToolsPage.css'

const CODE_AGENTS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    image: '/providers/claude.png',
    description: 'Anthropic Claude Code CLI',
    defaultModel: 'ag/claude-sonnet-4-6',
    protocol: 'Anthropic /v1/messages',
  },
  {
    id: 'openclaw',
    name: 'Open Claw',
    image: '/providers/openclaw.png',
    description: 'Open Claw AI Assistant',
    defaultModel: 'oc/deepseek-v4-flash-free',
    protocol: 'OpenAI compatible',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex CLI / App',
    image: '/providers/codex.png',
    description: 'OpenAI Codex CLI',
    defaultModel: 'ag/gpt-oss-120b-medium',
    protocol: 'OpenAI compatible',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    image: '/providers/opencode.png',
    description: 'OpenCode AI Terminal Assistant',
    defaultModel: 'oc/deepseek-v4-flash-free',
    protocol: 'OpenAI compatible',
  },
  {
    id: 'cowork',
    name: 'Claude Cowork',
    image: '/providers/claude.png',
    description: 'Claude Desktop Cowork (third-party inference)',
    defaultModel: 'ag/claude-sonnet-4-6',
    protocol: 'Anthropic /v1/messages',
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    image: '/providers/hermes.png',
    description: 'Nous Research self-improving AI agent',
    defaultModel: 'oc/deepseek-v4-flash-free',
    protocol: 'OpenAI compatible',
  },
  {
    id: 'droid',
    name: 'Factory Droid',
    image: '/providers/droid.png',
    description: 'Factory Droid AI Assistant',
    defaultModel: 'oc/deepseek-v4-flash-free',
    protocol: 'OpenAI compatible',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    image: '/providers/cursor.png',
    description: 'Cursor AI Code Editor',
    defaultModel: 'oc/deepseek-v4-flash-free',
    protocol: 'OpenAI compatible',
  },
  {
    id: 'cline',
    name: 'Cline',
    image: '/providers/cline.png',
    description: 'Cline AI Coding Assistant',
    defaultModel: 'oc/deepseek-v4-flash-free',
    protocol: 'OpenAI compatible',
  },
  {
    id: 'kilo',
    name: 'Kilo Code',
    image: '/providers/kilocode.png',
    description: 'Kilo Code AI Assistant',
    defaultModel: 'oc/deepseek-v4-flash-free',
    protocol: 'OpenAI compatible',
  },
  {
    id: 'roo',
    name: 'Roo',
    image: '/providers/roo.png',
    description: 'Roo AI Assistant',
    defaultModel: 'oc/deepseek-v4-flash-free',
    protocol: 'OpenAI compatible',
  },
  {
    id: 'continue',
    name: 'Continue',
    image: '/providers/continue.png',
    description: 'Continue AI Assistant',
    defaultModel: 'oc/deepseek-v4-flash-free',
    protocol: 'OpenAI compatible',
  },
]

const STATUS = {
  connected: { label: 'Connected', className: 'connected' },
  not_configured: { label: 'Not configured', className: 'not-configured' },
  not_installed: { label: 'Not installed', className: 'not-installed' },
  other: { label: 'Other config', className: 'other' },
  unknown: { label: 'Unknown', className: 'unknown' },
}

function defaultBaseUrl() {
  return `${window.location.origin}/v1`
}

function setupSnippet(tool, form) {
  const key = form.apiKey || 'KOGNIT_API_KEY'

  if (tool.id === 'claude-code' || tool.id === 'cowork') {
    return JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: form.baseUrl,
        ANTHROPIC_AUTH_TOKEN: key,
        ANTHROPIC_MODEL: form.model,
      },
    }, null, 2)
  }

  if (tool.id === 'codex') {
    return `model = "${form.model}"
model_provider = "kognit"

[model_providers.kognit]
name = "Kognit"
base_url = "${form.baseUrl}"
env_key = "KOGNIT_API_KEY"
wire_api = "chat"`
  }

  if (tool.id === 'opencode') {
    return JSON.stringify({
      provider: {
        kognit: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Kognit',
          options: {
            baseURL: form.baseUrl,
            apiKey: key,
          },
          models: {
            [form.model]: { name: form.model },
          },
        },
      },
      model: `kognit/${form.model}`,
    }, null, 2)
  }

  return `Provider: OpenAI Compatible
Base URL: ${form.baseUrl}
API Key: ${key}
Model: ${form.model}`
}

function StatusBadge({ state = 'unknown' }) {
  const status = STATUS[state] || STATUS.unknown
  return <span className={`cli-agent-status cli-agent-status--${status.className}`}>{status.label}</span>
}

async function fetchCodeAgentStatuses() {
  const response = await fetch('/api/cli-tools/all-statuses')
  if (!response.ok) throw new Error('Falha ao verificar os agentes')
  return response.json()
}

async function fetchModelOptionGroups() {
  const response = await fetch('/api/cli-tools/model-options')
  if (!response.ok) throw new Error('Falha ao buscar modelos conectados')
  const data = await response.json()
  return Array.isArray(data.groups) ? data.groups : []
}

export default function CliToolsPage() {
  const [statuses, setStatuses] = useState({})
  const [modelGroups, setModelGroups] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({ baseUrl: '', model: '', apiKey: '' })
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelSearch, setModelSearch] = useState('')

  const selectedTool = useMemo(
    () => CODE_AGENTS.find(tool => tool.id === selectedId) || null,
    [selectedId],
  )
  const selectedStatus = selectedTool ? statuses[selectedTool.id] : null
  const selectedModelProtocol = selectedTool?.protocol?.includes('/v1/messages') ? 'messages' : 'chat'
  const compatibleModelGroups = useMemo(() => {
    const search = modelSearch.trim().toLowerCase()
    return modelGroups
      .map(group => ({
        ...group,
        models: (group.models || [])
          .filter(model => model.disabled || (model.protocols || []).includes(selectedModelProtocol))
          .filter(model => {
            if (!search) return true
            return `${group.providerName} ${group.connectionName} ${model.id} ${model.name}`.toLowerCase().includes(search)
          }),
      }))
      .filter(group => group.models.length > 0)
  }, [modelGroups, modelSearch, selectedModelProtocol])

  useEffect(() => {
    let active = true
    fetchCodeAgentStatuses()
      .then(data => {
        if (active) setStatuses(data)
      })
      .catch(error => {
        if (active) setNotice(error.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchModelOptionGroups()
      .then(groups => {
        if (active) setModelGroups(groups)
      })
      .catch(error => {
        if (active) setNotice(error.message)
      })
    return () => {
      active = false
    }
  }, [])

  function openTool(tool) {
    const config = statuses[tool.id]?.config || {}
    const useManagedConfig = config.configured === true
    setForm({
      baseUrl: useManagedConfig && config.baseUrl ? config.baseUrl : defaultBaseUrl(),
      model: useManagedConfig && config.model ? config.model : tool.defaultModel,
      apiKey: '',
    })
    setNotice('')
    setModelSearch('')
    setModelMenuOpen(false)
    setSelectedId(tool.id)
  }

  function selectModel(modelId) {
    setForm(current => ({ ...current, model: modelId }))
    setModelSearch('')
    setModelMenuOpen(false)
  }

  async function saveConfiguration(event) {
    event.preventDefault()
    if (!selectedTool) return
    setSaving(true)
    setNotice('')
    try {
      const response = await fetch(`/api/cli-tools/${selectedTool.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Falha ao salvar configuracao')
      setStatuses(current => ({
        ...current,
        [selectedTool.id]: {
          ...current[selectedTool.id],
          state: data.state,
          config: data.config,
        },
      }))
      setForm(current => ({ ...current, apiKey: '' }))
      setNotice(data.config?.configPath
        ? `Configuracao aplicada em ${data.config.configPath}. Reabra a CLI para recarregar.`
        : 'Configuracao aplicada no arquivo local do agente. Reabra a CLI para recarregar.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (!selectedTool) return
    setSaving(true)
    setNotice('')
    try {
      const response = await fetch(`/api/cli-tools/${selectedTool.id}/configuration`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Falha ao remover configuracao')
      setStatuses(await fetchCodeAgentStatuses())
      setNotice('Configuracao removida.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function copySetup() {
    if (!selectedTool) return
    await navigator.clipboard.writeText(setupSnippet(selectedTool, form))
    setNotice('Configuracao copiada.')
  }

  if (selectedTool) {
    const state = selectedStatus?.state || 'unknown'
    const snippet = setupSnippet(selectedTool, form)

    return (
      <div className="cli-tools cli-tools--detail">
        <header className="cli-agent-detail__header">
          <button className="cli-agent-back" type="button" onClick={() => setSelectedId(null)} aria-label="Voltar">
            &lt;-
          </button>
          <img src={selectedTool.image} alt="" className="cli-agent-detail__logo" />
          <div>
            <span className="cli-agent-detail__eyebrow">CODING AGENT</span>
            <h1>{selectedTool.name}</h1>
            <p>{selectedTool.description}</p>
          </div>
          <StatusBadge state={state} />
        </header>

        <section className="cli-agent-panel">
          <div className="cli-agent-panel__heading">
            <div>
              <h2>Connection</h2>
              <p>A configuracao e gravada diretamente no arquivo local usado pelo agente.</p>
            </div>
            <div className="cli-agent-detection">
              <span>{selectedStatus?.installed === true ? 'Detected' : selectedStatus?.installed === false ? 'Not detected' : 'Detection unavailable'}</span>
              {selectedStatus?.version && <code>v{selectedStatus.version}</code>}
            </div>
          </div>

          <form className="cli-agent-form" onSubmit={saveConfiguration}>
            <label>
              Base URL
              <input
                value={form.baseUrl}
                onChange={event => setForm(current => ({ ...current, baseUrl: event.target.value }))}
                placeholder="http://localhost:3001/v1"
                required
              />
            </label>
            <label>
              Model
              <div className="cli-agent-model-picker">
                <input
                  value={form.model}
                  onChange={event => setForm(current => ({ ...current, model: event.target.value }))}
                  onFocus={() => setModelMenuOpen(true)}
                  placeholder="provider/model"
                  required
                />
                <button
                  type="button"
                  className="cli-agent-model-picker__button"
                  onClick={() => setModelMenuOpen(open => !open)}
                >
                  Modelos
                </button>
                {modelMenuOpen && (
                  <div className="cli-agent-model-menu">
                    <input
                      className="cli-agent-model-menu__search"
                      value={modelSearch}
                      onChange={event => setModelSearch(event.target.value)}
                      placeholder="Buscar provider ou modelo..."
                    />
                    <div className="cli-agent-model-menu__list">
                      {compatibleModelGroups.length === 0 && (
                        <p className="cli-agent-model-menu__empty">Nenhum modelo compativel conectado.</p>
                      )}
                      {compatibleModelGroups.map(group => (
                        <div className="cli-agent-model-group" key={`${group.providerId}-${group.connectionId}`}>
                          <div className="cli-agent-model-group__heading">
                            <strong>{group.providerName}</strong>
                            <span>{group.connectionName}</span>
                          </div>
                          <div className="cli-agent-model-group__models">
                            {group.models.map(model => (
                              <button
                                key={model.id}
                                type="button"
                                className="cli-agent-model-option"
                                disabled={model.disabled}
                                title={model.note || model.id}
                                onClick={() => selectModel(model.id)}
                              >
                                <span>{model.name}</span>
                                <code>{model.id}</code>
                                {model.note && <small>{model.note}</small>}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </label>
            <label className="cli-agent-form__wide">
              API Key
              <input
                type="password"
                value={form.apiKey}
                onChange={event => setForm(current => ({ ...current, apiKey: event.target.value }))}
                placeholder={selectedStatus?.config?.hasApiKey ? 'Chave salva. Deixe vazio para manter.' : 'Opcional quando o endpoint local nao exige chave'}
              />
            </label>
            <div className="cli-agent-form__actions cli-agent-form__wide">
              <button
                className="cli-agent-button cli-agent-button--primary"
                type="submit"
                disabled={saving || selectedStatus?.config?.directlyConfigurable === false}
              >
                {saving ? 'Saving...' : selectedStatus?.config?.directlyConfigurable === false ? 'Manual setup required' : 'Save to agent config'}
              </button>
              {selectedStatus?.config?.configured && (
                <button className="cli-agent-button" type="button" onClick={disconnect} disabled={saving}>
                  Disconnect
                </button>
              )}
              {notice && <span className="cli-agent-notice">{notice}</span>}
            </div>
          </form>
          {(selectedStatus?.config?.configPath || selectedStatus?.config?.note || selectedStatus?.config?.configError) && (
            <div className="cli-agent-file-info">
              {selectedStatus?.config?.configPath && (
                <p><span>Config file</span><code>{selectedStatus.config.configPath}</code></p>
              )}
              {(selectedStatus?.config?.extraPaths || []).map(filePath => (
                <p key={filePath}><span>Related file</span><code>{filePath}</code></p>
              ))}
              {selectedStatus?.config?.note && <p className="cli-agent-file-info__note">{selectedStatus.config.note}</p>}
              {selectedStatus?.config?.otherConfiguration && (
                <p className="cli-agent-file-info__note">Outra configuracao foi detectada. Salvar aplicara o endpoint do Kognit sem reutilizar a chave anterior.</p>
              )}
              {selectedStatus?.config?.configError && <p className="cli-agent-file-info__error">{selectedStatus.config.configError}</p>}
            </div>
          )}
        </section>

        <section className="cli-agent-panel">
          <div className="cli-agent-panel__heading">
            <div>
              <h2>Setup</h2>
              <p>{selectedTool.protocol} configuration for {selectedTool.name}.</p>
            </div>
            <button className="cli-agent-button" type="button" onClick={copySetup}>Copy</button>
          </div>
          <pre className="cli-agent-snippet"><code>{snippet}</code></pre>
        </section>
      </div>
    )
  }

  const connected = CODE_AGENTS.filter(tool => statuses[tool.id]?.state === 'connected').length

  return (
    <div className="cli-tools">
      <header className="cli-tools__header">
        <div className="cli-tools__title">
          <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="4,17 10,11 4,5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <div>
            <span>DEVELOPER TOOLS</span>
            <h1>Coding Agents &amp; CLIs</h1>
          </div>
        </div>
        <span className="cli-tools__subtitle">
          {loading ? 'Checking...' : `${connected}/${CODE_AGENTS.length} connected`}
        </span>
      </header>

      <div className="cli-tools__grid">
        {CODE_AGENTS.map(tool => {
          const status = statuses[tool.id] || {}
          return (
            <button
              key={tool.id}
              type="button"
              className="cli-tools__card"
              onClick={() => openTool(tool)}
            >
              <img src={tool.image} alt="" className="cli-tools__card-logo" />
              <div className="cli-tools__card-copy">
                <div className="cli-tools__card-topline">
                  <span className="cli-tools__card-name">{tool.name}</span>
                  <span className="cli-tools__chevron">&gt;</span>
                </div>
                <StatusBadge state={status.state} />
                <span className="cli-tools__card-desc">{tool.description}</span>
              </div>
            </button>
          )
        })}
      </div>
      {notice && <p className="cli-tools__error">{notice}</p>}
    </div>
  )
}
