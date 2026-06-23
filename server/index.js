import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { spawn, execSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer as createHttpServer } from 'http'
import https from 'https'
import net from 'net'
import {
  completeOAuthCallbackFromUrl,
  completeOAuthSession,
  completePendingCallbackSession,
  createBrowserOAuthSession,
  createDeviceOAuthSession,
  getOAuthProviderMeta,
  getOAuthSessionStatus,
  importOAuthToken,
  pollDeviceOAuthSession,
} from './oauthProviders.js'
import {
  applyCliToolConfig,
  inspectCliToolConfig,
  removeCliToolConfig,
} from './cliToolConfigs.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const app = express()
const httpServer = createHttpServer(app)
const REQUEST_BODY_LIMIT = process.env.KOGNIT_REQUEST_BODY_LIMIT || '50mb'
app.use(express.json({ limit: REQUEST_BODY_LIMIT }))
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: {
        message: `Request body too large for Kognit local parser. Current limit: ${REQUEST_BODY_LIMIT}.`,
        type: 'request_too_large',
      },
    })
  }
  return next(err)
})

const DATA_FILE = process.env.KOGNIT_DATA_FILE || path.join(__dirname, 'data.json')
const CLOUDFLARED_PATH = path.join(__dirname, 'cloudflared.exe')
const ROOT_CLOUDFLARED_PATH = path.join(ROOT, 'cloudflared.exe')
const PORT = process.env.PORT || 3001
const LOCAL_API_ORIGIN = process.env.KOGNIT_LOCAL_ORIGIN || process.env.KOGNIT_LOCAL_API_ORIGIN || `http://localhost:${PORT}`
const PUBLIC_ORIGIN = process.env.KOGNIT_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || ''

app.set('trust proxy', 1)

function cleanBearerToken(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '')
}

function environmentZCodeToken() {
  return cleanBearerToken(
    process.env.KOGNIT_ZCODE_TOKEN
      || process.env.ZCODE_TOKEN
      || process.env.ZCODE_AUTHORIZATION
  )
}

function createInitialData() {
  const initial = {
    keys: [],
    providers: [],
    providerConnections: [],
    providerSettings: {},
    cliToolSettings: {},
    usageEvents: [],
    tunnelUrl: null,
  }

  let accounts = []
  if (process.env.KOGNIT_ZCODE_ACCOUNTS_JSON) {
    try {
      const parsed = JSON.parse(process.env.KOGNIT_ZCODE_ACCOUNTS_JSON)
      accounts = Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.warn(`[KOGNIT] KOGNIT_ZCODE_ACCOUNTS_JSON invalido: ${error.message}`)
    }
  }

  if (accounts.length === 0 && environmentZCodeToken()) {
    accounts = [{
      name: 'ZCode no Render',
      accessToken: environmentZCodeToken(),
      defaultModel: 'zc/GLM-5-Turbo',
    }]
  }

  const now = new Date().toISOString()
  for (const [index, account] of accounts.entries()) {
    const accessToken = cleanBearerToken(account?.accessToken || account?.token)
    if (!accessToken) continue
    const email = String(account?.email || '').trim()
    initial.providerConnections.push({
      id: account.id || uuidv4(),
      providerId: 'zcode-ai',
      providerName: 'ZCode / Z.ai',
      category: 'oauth',
      authType: 'oauth',
      connectionMode: 'oauth',
      name: String(account.name || email || `Conta ZCode ${index + 1}`).trim(),
      email,
      baseUrl: '',
      defaultModel: account.defaultModel || 'zc/GLM-5-Turbo',
      apiKey: '',
      accessToken,
      refreshToken: cleanBearerToken(account.refreshToken),
      sessionToken: '',
      expiresAt: account.expiresAt || null,
      providerSpecificData: account.providerSpecificData || { authMethod: 'environment' },
      notes: account.notes || 'Conta carregada por variavel de ambiente.',
      enabled: account.enabled !== false,
      priority: Number.isFinite(Number(account.priority)) ? Number(account.priority) : index,
      status: 'active',
      testStatus: 'untested',
      lastTested: null,
      created: now,
      updated: now,
    })
  }

  if (initial.providerConnections.length > 0) {
    initial.providerSettings['zcode-ai'] = {
      roundRobin: initial.providerConnections.length > 1,
      cursor: 0,
    }
  }

  return initial
}

function writeDataFile(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`
  fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(temporaryFile, DATA_FILE)
  try { fs.chmodSync(DATA_FILE, 0o600) } catch { /* filesystem may not support chmod */ }
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = createInitialData()
    writeDataFile(initial)
    return initial
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8').replace(/^\uFEFF/, ''))
  return {
    keys: Array.isArray(data.keys) ? data.keys : [],
    providers: Array.isArray(data.providers) ? data.providers : [],
    providerConnections: Array.isArray(data.providerConnections) ? data.providerConnections : [],
    providerSettings: data.providerSettings && typeof data.providerSettings === 'object' ? data.providerSettings : {},
    cliToolSettings: data.cliToolSettings && typeof data.cliToolSettings === 'object' ? data.cliToolSettings : {},
    usageEvents: Array.isArray(data.usageEvents) ? data.usageEvents : [],
    tunnelUrl: data.tunnelUrl ?? null,
  }
}

function saveData(data) {
  writeDataFile(data)
}

function normalizeOrigin(origin) {
  try {
    const url = new URL(origin)
    return url.origin
  } catch {
    return null
  }
}

function localDisplayEndpoint(origin) {
  const url = new URL(origin)
  const host = ['127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname) ? 'localhost' : url.hostname
  const port = url.port ? `:${url.port}` : ''
  return `${url.protocol}//${host}${port}/v1`
}

async function resolveLocalApi() {
  const origin = normalizeOrigin(LOCAL_API_ORIGIN)
  return origin ? { origin, endpoint: localDisplayEndpoint(origin) } : null
}

function isTunnelAlive() {
  return !!tunnelProcess && !tunnelProcess.killed && tunnelProcess.exitCode === null
}

function clearTunnelState() {
  tunnelProcess = null
  tunnelUrl = null
  clearStoredTunnelUrl()
}

function clearStoredTunnelUrl() {
  const db = loadData()
  db.tunnelUrl = null
  saveData(db)
}

// --- GLM 5.2 PROXY (child process, auto-start no boot) ---
// Mesma filosofia do tunnel cloudflared: um child process gerenciado em escopo de modulo.
// O binario expoe uma API OpenAI-compatible local e faz ponte para o Z.ai.

const GLM_PROXY_BIN = path.join(ROOT, 'program', 'glm5.2proxy', 'glm5.2proxy-server')
const GLM_PROXY_DATA_DIR = process.env.ZCODE_PROXY_DATA_DIR || path.join(ROOT, 'data', 'glm5.2proxy')
const ZCODE_CONFIG_FILE = process.env.ZCODE_CONFIG_FILE || path.join(os.homedir(), '.zcode', 'v2', 'config.json')
const GLM_PROXY_HOST = process.env.ZCODE_PROXY_HOST || '127.0.0.1'
const GLM_PROXY_PORT = Number(process.env.ZCODE_PROXY_PORT || 3075)

let glmProxyProcess = null
let glmProxyStatus = { active: false, pid: null, error: null, startedAt: null }
let glmProxyLogs = []
let glmProxyShuttingDown = false
let glmProxyRestartPromise = null

function isGlmProxyAlive() {
  return !!glmProxyProcess && !glmProxyProcess.killed && glmProxyProcess.exitCode === null
}

function readZCodeTokenFromConfig() {
  try {
    if (!fs.existsSync(ZCODE_CONFIG_FILE)) return null
    const config = JSON.parse(fs.readFileSync(ZCODE_CONFIG_FILE, 'utf8'))
    return config?.provider?.['builtin:zai-start-plan']?.options?.apiKey || null
  } catch {
    return null
  }
}

// Token salvo via OAuth no painel tem prioridade sobre o config.json do CLI.
function readZCodeTokenFromDb() {
  try {
    const db = loadData()
    const conn = (db.providerConnections || []).find(c => c.providerId === 'zcode-ai' && c.enabled)
    return conn?.accessToken || null
  } catch {
    return null
  }
}

function resolveZCodeToken() {
  return readZCodeTokenFromDb() || environmentZCodeToken() || readZCodeTokenFromConfig()
}

function resolveCaptchaBrowserExecutable() {
  const candidates = [
    process.env.ZCODE_CAPTCHA_HEADLESS_EXECUTABLE,
    fs.existsSync('/usr/bin/chromium') ? path.join(__dirname, 'chromium-container') : null,
    '/usr/bin/brave-browser',
    '/usr/bin/brave-browser-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean)

  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}

function rememberGlmLog(data) {
  const text = data.toString()
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  glmProxyLogs.push(...lines)
  while (glmProxyLogs.length > 50) glmProxyLogs.shift()
  return text
}

function startGlmProxy(reason = 'boot') {
  if (isGlmProxyAlive()) {
    return { started: false, reason: 'already-running', pid: glmProxyProcess.pid }
  }
  if (glmProxyShuttingDown) {
    return { started: false, reason: 'shutting-down' }
  }

  if (!fs.existsSync(GLM_PROXY_BIN)) {
    glmProxyStatus = { active: false, pid: null, error: `Binario nao encontrado: ${GLM_PROXY_BIN}`, startedAt: null }
    console.warn(`[glm-proxy] binario ausente, proxy desativado: ${GLM_PROXY_BIN}`)
    return { started: false, reason: 'no-binary' }
  }

  const token = resolveZCodeToken()
  if (!token) {
    glmProxyStatus = { active: false, pid: null, error: 'Token ZCode ausente (config.json nem OAuth).', startedAt: null }
    console.warn('[glm-proxy] sem token ZCode, proxy desativado. Faca OAuth do ZCode ou exporte o token em ~/.zcode/v2/config.json.')
    return { started: false, reason: 'no-token' }
  }

  // PORT e removido do ambiente do proxy (igual ao `env -u PORT` do 9router):
  // sem isso, o binario faz fallback de ZCODE_PROXY_PORT para PORT e conflita com o Kognit.
  const parentEnv = { ...process.env }
  delete parentEnv.PORT
  const env = {
    ...parentEnv,
    ZCODE_AUTHORIZATION: `Bearer ${token}`,
    ZCODE_PROXY_DATA_DIR: GLM_PROXY_DATA_DIR,
    ZCODE_PROXY_HOST: GLM_PROXY_HOST,
    ZCODE_PROXY_PORT: String(GLM_PROXY_PORT),
    ZCODE_CAPTCHA_BRIDGE: process.env.ZCODE_CAPTCHA_BRIDGE || 'true',
    ZCODE_CAPTCHA_HEADLESS: process.env.ZCODE_CAPTCHA_HEADLESS || 'false',
    ZCODE_CAPTCHA_CLIENT_PREFERENCE: process.env.ZCODE_CAPTCHA_CLIENT_PREFERENCE || 'standalone-browser',
    ZCODE_CAPTCHA_HEADLESS_EXECUTABLE: resolveCaptchaBrowserExecutable(),
    ZCODE_CAPTCHA_HEADLESS_PROFILE_DIR: process.env.ZCODE_CAPTCHA_HEADLESS_PROFILE_DIR
      || path.join(GLM_PROXY_DATA_DIR, 'captcha-headless-profile'),
    // Evita loop agressivo de restart do navegador de captcha quando o Aliyun exige desafio interativo.
    ZCODE_CAPTCHA_HEADLESS_RESTART_DELAY_MS: process.env.ZCODE_CAPTCHA_HEADLESS_RESTART_DELAY_MS || '30000',
    ZCODE_ACCOUNT_CREATOR_ENABLED: process.env.ZCODE_ACCOUNT_CREATOR_ENABLED || 'false',
  }

  let child
  try {
    child = spawn(GLM_PROXY_BIN, [], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (err) {
    glmProxyStatus = { active: false, pid: null, error: `Falha ao spawnar: ${err.message}`, startedAt: null }
    console.error(`[glm-proxy] spawn falhou: ${err.message}`)
    return { started: false, reason: 'spawn-error', error: err.message }
  }

  glmProxyProcess = child
  glmProxyStatus = { active: true, pid: child.pid, error: null, startedAt: new Date().toISOString() }
  console.log(`[glm-proxy] iniciado (pid ${child.pid}, motivo: ${reason}) em ${GLM_PROXY_HOST}:${GLM_PROXY_PORT}`)

  child.stdout.on('data', chunk => {
    const text = rememberGlmLog(chunk)
    if (process.env.ZCODE_PROXY_VERBOSE === '1') process.stdout.write(`[glm-proxy] ${text}`)
  })
  child.stderr.on('data', chunk => {
    const text = rememberGlmLog(chunk)
    process.stderr.write(`[glm-proxy] ${text}`)
  })

  child.on('error', err => {
    glmProxyStatus = { active: false, pid: null, error: err.message, startedAt: null }
    console.error(`[glm-proxy] erro no processo: ${err.message}`)
  })

  child.on('exit', (code, signal) => {
    console.warn(`[glm-proxy] processo encerrou (code=${code}, signal=${signal})`)
    glmProxyProcess = null
    glmProxyStatus = { active: false, pid: null, error: `exit code ${code} signal ${signal}`, startedAt: null }
    // Auto-restart leve (igual ao supervisor do 9router), exceto em shutdown intencional.
    if (!glmProxyShuttingDown) {
      setTimeout(() => startGlmProxy('auto-restart'), 3000)
    }
  })

  return { started: true, pid: child.pid, reason }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function waitForProcessExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.killed) return Promise.resolve(true)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

function isTcpPortOpen(host, port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port })
    socket.setTimeout(500)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

async function waitForTcpPortState(host, port, shouldBeOpen, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const open = await isTcpPortOpen(host, port)
    if (open === shouldBeOpen) return true
    await sleep(150)
  }
  return false
}

async function stopGlmProxy({ force = true } = {}) {
  glmProxyShuttingDown = true
  const child = glmProxyProcess
  if (isGlmProxyAlive()) {
    try { child.kill('SIGTERM') } catch { /* noop */ }
    const exited = await waitForProcessExit(child, 5000)
    if (!exited && force) {
      try { child.kill('SIGKILL') } catch { /* noop */ }
      await waitForProcessExit(child, 2000)
    }
  }
  if (glmProxyProcess === child) glmProxyProcess = null
  glmProxyStatus = { active: false, pid: null, error: null, startedAt: null }
  await waitForTcpPortState(GLM_PROXY_HOST, GLM_PROXY_PORT, false, 8000)
}

async function restartGlmProxy(reason = 'manual-restart') {
  if (glmProxyRestartPromise) return glmProxyRestartPromise
  glmProxyRestartPromise = (async () => {
    console.log(`[glm-proxy] reinicio seguro solicitado (${reason})...`)
    await stopGlmProxy()
    glmProxyShuttingDown = false
    const result = startGlmProxy(reason)
    if (result.started) {
      const ready = await waitForTcpPortState(GLM_PROXY_HOST, GLM_PROXY_PORT, true, 10000)
      if (!ready) {
        glmProxyStatus = {
          active: isGlmProxyAlive(),
          pid: glmProxyProcess?.pid ?? null,
          error: `Proxy iniciou, mas a porta ${GLM_PROXY_PORT} nao respondeu a tempo.`,
          startedAt: glmProxyStatus.startedAt,
        }
      }
    }
    return result
  })().finally(() => {
    glmProxyRestartPromise = null
  })
  return glmProxyRestartPromise
}

function previewSecret(secret) {
  if (!secret) return ''
  if (secret.length <= 10) return '***'
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`
}

function publicProvider(provider) {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    keyPreview: previewSecret(provider.apiKey),
    enabled: provider.enabled,
    created: provider.created,
  }
}

function publicProviderConnection(connection) {
  return {
    id: connection.id,
    providerId: connection.providerId,
    providerName: connection.providerName,
    category: connection.category,
    authType: connection.authType,
    connectionMode: connection.connectionMode,
    name: connection.name,
    email: connection.email,
    baseUrl: connection.baseUrl,
    defaultModel: connection.defaultModel,
    enabled: connection.enabled,
    priority: connection.priority,
    status: connection.status,
    testStatus: connection.testStatus,
    lastTested: connection.lastTested,
    expiresAt: connection.expiresAt,
    projectId: connection.projectId,
    created: connection.created,
    updated: connection.updated,
    secretPreview: previewSecret(connection.apiKey || connection.accessToken || connection.sessionToken),
    refreshPreview: previewSecret(connection.refreshToken),
    notes: connection.notes,
  }
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(value)
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function normalizeOptionalBaseUrl(value) {
  if (!value?.trim()) return ''
  return normalizeBaseUrl(value)
}

function normalizeProviderId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseConnectionPayload(body) {
  const providerName = body.providerName?.trim()
  const providerId = normalizeProviderId(body.providerId || providerName)
  const connectionMode = body.connectionMode || 'api-key'
  const authType = body.authType || (
    connectionMode === 'oauth' ? 'oauth'
      : connectionMode === 'browser-session' ? 'browser_session'
        : connectionMode === 'public' ? 'public'
          : 'apikey'
  )

  const baseUrl = normalizeOptionalBaseUrl(body.baseUrl)
  if (baseUrl === null) {
    return { error: 'Base URL invalida' }
  }

  const connection = {
    id: uuidv4(),
    providerId,
    providerName,
    category: body.category || '',
    authType,
    connectionMode,
    name: body.name?.trim() || providerName || 'Connection',
    email: body.email?.trim() || '',
    baseUrl,
    defaultModel: body.defaultModel?.trim() || '',
    apiKey: body.apiKey?.trim() || '',
    accessToken: body.accessToken?.trim() || '',
    refreshToken: body.refreshToken?.trim() || '',
    sessionToken: body.sessionToken?.trim() || '',
    notes: body.notes?.trim() || '',
    enabled: true,
    priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0,
    status: 'active',
    testStatus: 'untested',
    lastTested: null,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }

  if (!connection.providerId || !connection.providerName) {
    return { error: 'Provider invalido' }
  }

  if (!connection.name) {
    return { error: 'Nome da conexao e obrigatorio' }
  }

  if (connectionMode === 'api-key' && !connection.apiKey) {
    return { error: 'API key e obrigatoria para este provider' }
  }

  if (connectionMode === 'oauth' && !connection.accessToken) {
    return { error: 'Access token OAuth/CLI e obrigatorio para este provider' }
  }

  if (connectionMode === 'browser-session' && !connection.sessionToken) {
    return { error: 'Session token ou cookie e obrigatorio para browser session' }
  }

  return { connection }
}

function createConnectionRecord(data) {
  const db = loadData()
  const nextPriority = db.providerConnections
    .filter(connection => connection.providerId === data.providerId)
    .reduce((max, connection) => Math.max(max, Number(connection.priority) || 0), -1) + 1
  const now = new Date().toISOString()
  const connection = {
    id: uuidv4(),
    category: '',
    authType: 'oauth',
    connectionMode: 'oauth',
    name: data.providerName || data.providerId,
    email: '',
    baseUrl: '',
    defaultModel: '',
    apiKey: '',
    accessToken: '',
    refreshToken: '',
    sessionToken: '',
    providerSpecificData: {},
    enabled: true,
    priority: nextPriority,
    status: 'active',
    testStatus: 'active',
    lastTested: now,
    created: now,
    updated: now,
    ...data,
  }

  db.providerConnections.push(connection)

  if (!db.providerSettings[connection.providerId]) {
    db.providerSettings[connection.providerId] = { roundRobin: false, cursor: 0 }
  }

  saveData(db)
  return publicProviderConnection(connection)
}

function saveOAuthProviderTokens(provider, tokens) {
  const expiresAt = tokens.expiresIn
    ? new Date(Date.now() + Number(tokens.expiresIn) * 1000).toISOString()
    : null
  const email = tokens.email || ''
  const accountLabel = email ? ` (${email})` : ''

  const connection = createConnectionRecord({
    providerId: provider.id,
    providerName: provider.providerName,
    category: provider.category,
    authType: 'oauth',
    connectionMode: 'oauth',
    name: `${provider.providerName}${accountLabel}`,
    email,
    apiKey: tokens.apiKey || '',
    accessToken: tokens.accessToken || '',
    refreshToken: tokens.refreshToken || '',
    expiresAt,
    projectId: tokens.projectId || '',
    scope: tokens.scope || '',
    providerSpecificData: tokens.providerSpecificData || {},
  })

  // OAuth do ZCode concluido: reinicia o proxy GLM com o token novo.
  if (provider.id === 'zcode-ai' && tokens.accessToken) {
    restartGlmProxy('oauth-refresh').catch(error => {
      glmProxyStatus = { active: false, pid: null, error: error.message, startedAt: null }
      console.error(`[glm-proxy] reinicio pos-OAuth falhou: ${error.message}`)
    })
  }

  return connection
}

const MODEL_TEST_TIMEOUT_MS = 25000
const MODEL_ALIAS_PREFIXES = new Set(['ag', 'cc', 'cx', 'gh', 'gc', 'kr', 'cu', 'kc', 'cl', 'oc', 'oa', 'or', 'gr', 'ms', 'ds', 'xa', 'co', 'ta', 'pp', 'fw', 'cb', 'rp', 'hf', 'az', 'nv', 'cf', 'bp', 'ol', 'zc'])
const PROVIDER_DISPLAY_NAMES = {
  antigravity: 'Antigravity',
  'claude-code': 'Claude Code',
  'openai-codex': 'OpenAI Codex',
  'github-copilot': 'GitHub Copilot',
  'gemini-cli': 'Gemini CLI',
  'kiro-ai': 'Kiro AI',
  'cursor-ide': 'Cursor IDE',
  'kilo-code': 'Kilo Code',
  cline: 'Cline',
  'opencode-free': 'OpenCode Free',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'google-ai-studio': 'Google AI Studio',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  'openrouter-free': 'OpenRouter',
  groq: 'Groq',
  'mistral-ai': 'Mistral AI',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  cohere: 'Cohere',
  'together-ai': 'Together AI',
  perplexity: 'Perplexity',
  'fireworks-ai': 'Fireworks AI',
  cerebras: 'Cerebras',
  replicate: 'Replicate',
  'hugging-face': 'Hugging Face',
  huggingface: 'Hugging Face',
  'azure-openai': 'Azure OpenAI',
  'aws-bedrock': 'AWS Bedrock',
  'nvidia-nim': 'NVIDIA NIM',
  'nvidia-nim-api': 'NVIDIA NIM',
  cloudflare: 'Cloudflare Workers AI',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  'byteplus-modelark': 'BytePlus ModelArk',
  'byteplus-modelark-api': 'BytePlus ModelArk',
  'ollama-cloud': 'Ollama Cloud',
  ollama: 'Ollama',
  vertex: 'Vertex AI',
  'zcode-ai': 'ZCode / Z.ai',
}

function providerMeta(providerId, providerName) {
  return { id: providerId, name: providerName || PROVIDER_DISPLAY_NAMES[providerId] || readableModelName(providerId) }
}

const MODEL_PREFIX_PROVIDERS = {
  ag: providerMeta('antigravity'),
  cc: providerMeta('claude-code'),
  cx: providerMeta('openai-codex'),
  gh: providerMeta('github-copilot'),
  gc: providerMeta('gemini-cli'),
  zc: providerMeta('zcode-ai'),
  kr: providerMeta('kiro-ai'),
  cu: providerMeta('cursor-ide'),
  kc: providerMeta('kilo-code'),
  cl: providerMeta('cline'),
  oc: providerMeta('opencode-free'),
  oa: providerMeta('openai'),
  or: providerMeta('openrouter'),
  gr: providerMeta('groq'),
  ms: providerMeta('mistral-ai'),
  ds: providerMeta('deepseek'),
  xa: providerMeta('xai'),
  co: providerMeta('cohere'),
  ta: providerMeta('together-ai'),
  pp: providerMeta('perplexity'),
  fw: providerMeta('fireworks-ai'),
  cb: providerMeta('cerebras'),
  rp: providerMeta('replicate'),
  hf: providerMeta('hugging-face'),
  az: providerMeta('azure-openai'),
  nv: providerMeta('nvidia-nim'),
  cf: providerMeta('cloudflare-workers-ai'),
  bp: providerMeta('byteplus-modelark'),
  ol: providerMeta('ollama-cloud'),
}

const MODEL_ROUTE_PREFIX_PROVIDERS = {
  ...MODEL_PREFIX_PROVIDERS,
  antigravity: providerMeta('antigravity'),
  claude: providerMeta('anthropic'),
  anthropic: providerMeta('anthropic'),
  openai: providerMeta('openai'),
  chatgpt: providerMeta('openai'),
  codex: providerMeta('openai-codex'),
  gemini: providerMeta('gemini'),
  google: providerMeta('google-ai-studio'),
  'google-ai-studio': providerMeta('google-ai-studio'),
  openrouter: providerMeta('openrouter'),
  groq: providerMeta('groq'),
  mistral: providerMeta('mistral-ai'),
  'mistral-ai': providerMeta('mistral-ai'),
  deepseek: providerMeta('deepseek'),
  xai: providerMeta('xai'),
  grok: providerMeta('xai'),
  cohere: providerMeta('cohere'),
  together: providerMeta('together-ai'),
  'together-ai': providerMeta('together-ai'),
  perplexity: providerMeta('perplexity'),
  fireworks: providerMeta('fireworks-ai'),
  'fireworks-ai': providerMeta('fireworks-ai'),
  cerebras: providerMeta('cerebras'),
  replicate: providerMeta('replicate'),
  hf: providerMeta('hugging-face'),
  huggingface: providerMeta('hugging-face'),
  'hugging-face': providerMeta('hugging-face'),
  azure: providerMeta('azure-openai'),
  'azure-openai': providerMeta('azure-openai'),
  aws: providerMeta('aws-bedrock'),
  bedrock: providerMeta('aws-bedrock'),
  'aws-bedrock': providerMeta('aws-bedrock'),
  nvidia: providerMeta('nvidia-nim'),
  'nvidia-nim': providerMeta('nvidia-nim'),
  cloudflare: providerMeta('cloudflare-workers-ai'),
  'cloudflare-workers-ai': providerMeta('cloudflare-workers-ai'),
  byteplus: providerMeta('byteplus-modelark'),
  modelark: providerMeta('byteplus-modelark'),
  'byteplus-modelark': providerMeta('byteplus-modelark'),
  ollama: providerMeta('ollama-cloud'),
  'ollama-cloud': providerMeta('ollama-cloud'),
  vertex: providerMeta('vertex'),
}

const MODEL_UPSTREAM_ALIASES = {
  antigravity: {
    'ag/gemini-3-flash-agent': 'gemini-3-flash-agent',
    'ag/gemini-3.5-flash-low': 'gemini-3.5-flash-low',
    'ag/gemini-pro-agent': 'gemini-pro-agent',
    'ag/gemini-3.1-pro-low': 'gemini-3.1-pro-low',
    'ag/claude-sonnet-4-6': 'claude-sonnet-4-6',
    'ag/claude-opus-4-6-thinking': 'claude-opus-4-6-thinking',
    'ag/gpt-oss-120b-medium': 'gpt-oss-120b-medium',
    'ag/gemini-3-flash': 'gemini-3-flash',
  },
  'zcode-ai': {
    'zc/GLM-5.2': 'GLM-5.2',
    'zc/GLM-5-Turbo': 'GLM-5-Turbo',
  },
}

const CLI_PROVIDER_MODEL_CATALOG = {
  antigravity: [
    { id: 'ag/gemini-3-flash-agent', name: 'Gemini 3.5 Flash High', protocols: ['chat', 'messages'] },
    { id: 'ag/gemini-3.5-flash-low', name: 'Gemini 3.5 Flash Medium', protocols: ['chat', 'messages'] },
    { id: 'ag/gemini-pro-agent', name: 'Gemini 3.1 Pro High', protocols: ['chat', 'messages'] },
    { id: 'ag/gemini-3.1-pro-low', name: 'Gemini 3.1 Pro Low', protocols: ['chat', 'messages'] },
    { id: 'ag/claude-sonnet-4-6', name: 'Claude Sonnet 4.6 Thinking', protocols: ['chat', 'messages'] },
    { id: 'ag/claude-opus-4-6-thinking', name: 'Claude Opus 4.6 Thinking', protocols: ['chat', 'messages'] },
    { id: 'ag/gpt-oss-120b-medium', name: 'GPT OSS 120B Medium', protocols: ['chat', 'messages'] },
    { id: 'ag/gemini-3-flash', name: 'Gemini 3 Flash', protocols: ['chat', 'messages'] },
  ],
  'opencode-free': [
    { id: 'oc/mimo-v2.5-free', name: 'MiMo V2.5 Free', protocols: ['chat'] },
    { id: 'oc/deepseek-v4-flash-free', name: 'DeepSeek V4 Flash Free', protocols: ['chat'] },
    { id: 'oc/minimax-m3-free', name: 'MiniMax M3 Free', protocols: ['chat'] },
    { id: 'oc/minimax-m2.5-free', name: 'MiniMax M2.5 Free', protocols: ['chat'] },
    { id: 'oc/qwen3.6-plus-free', name: 'Qwen3.6 Plus Free', protocols: ['chat'] },
    { id: 'oc/nemotron-3-super-free', name: 'Nemotron 3 Super Free', protocols: ['chat'] },
  ],
  'kiro-ai': [
    { id: 'kr/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', protocols: [], disabled: true, note: 'Kiro conectado, mas ainda sem proxy /v1 para CLI.' },
    { id: 'kr/claude-haiku-4.5', name: 'Claude Haiku 4.5', protocols: [], disabled: true, note: 'Kiro conectado, mas ainda sem proxy /v1 para CLI.' },
    { id: 'kr/deepseek-3.2', name: 'DeepSeek 3.2', protocols: [], disabled: true, note: 'Kiro conectado, mas ainda sem proxy /v1 para CLI.' },
    { id: 'kr/qwen3-coder-next', name: 'Qwen3 Coder Next', protocols: [], disabled: true, note: 'Kiro conectado, mas ainda sem proxy /v1 para CLI.' },
    { id: 'kr/glm-5', name: 'GLM 5', protocols: [], disabled: true, note: 'Kiro conectado, mas ainda sem proxy /v1 para CLI.' },
    { id: 'kr/MiniMax-M2.5', name: 'MiniMax M2.5', protocols: [], disabled: true, note: 'Kiro conectado, mas ainda sem proxy /v1 para CLI.' },
  ],
  'zcode-ai': [
    { id: 'zc/GLM-5.2', name: 'GLM-5.2', upstreamId: 'GLM-5.2', protocols: ['chat'] },
    { id: 'zc/GLM-5-Turbo', name: 'GLM-5-Turbo', upstreamId: 'GLM-5-Turbo', protocols: ['chat'] },
  ],
}

const OPENAI_COMPATIBLE_PROVIDER_URLS = {
  'openai': 'https://api.openai.com/v1/chat/completions',
  'google-ai-studio': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  'gemini': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  'openrouter': 'https://openrouter.ai/api/v1/chat/completions',
  'openrouter-free': 'https://openrouter.ai/api/v1/chat/completions',
  'groq': 'https://api.groq.com/openai/v1/chat/completions',
  'mistral-ai': 'https://api.mistral.ai/v1/chat/completions',
  'deepseek': 'https://api.deepseek.com/chat/completions',
  'xai': 'https://api.x.ai/v1/chat/completions',
  'cohere': 'https://api.cohere.com/compatibility/v1/chat/completions',
  'together-ai': 'https://api.together.xyz/v1/chat/completions',
  'perplexity': 'https://api.perplexity.ai/chat/completions',
  'fireworks-ai': 'https://api.fireworks.ai/inference/v1/chat/completions',
  'cerebras': 'https://api.cerebras.ai/v1/chat/completions',
  'replicate': 'https://api.replicate.com/v1/chat/completions',
  'hugging-face': 'https://router.huggingface.co/v1/chat/completions',
  'huggingface': 'https://router.huggingface.co/v1/chat/completions',
  'nvidia-nim': 'https://integrate.api.nvidia.com/v1/chat/completions',
  'nvidia-nim-api': 'https://integrate.api.nvidia.com/v1/chat/completions',
  'byteplus-modelark': 'https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions',
  'byteplus-modelark-api': 'https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions',
  // ZCode/GLM: o binario glm5.2proxy-server expoe a API localmente neste host/porta.
  'zcode-ai': `http://${GLM_PROXY_HOST}:${GLM_PROXY_PORT}/v1/chat/completions`,
}

function stripModelAlias(modelId) {
  const raw = String(modelId || '').trim()
  const parts = raw.split('/')
  if (parts.length > 1 && MODEL_ALIAS_PREFIXES.has(parts[0])) {
    return parts.slice(1).join('/')
  }
  return raw
}

function readableModelName(modelId) {
  return String(modelId || '')
    .split('/')
    .pop()
    .replace(/[-_:]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function resolveUpstreamModel(providerId, modelId, upstreamId) {
  const aliases = MODEL_UPSTREAM_ALIASES[providerId] || {}
  const mapped = aliases[modelId]
    || Object.entries(aliases).find(([id]) => id.toLowerCase() === String(modelId || '').toLowerCase())?.[1]
  const selected = upstreamId && upstreamId !== modelId ? upstreamId : mapped || modelId
  return stripModelAlias(selected)
}

function modelsForCliProvider(providerId, defaultModel = '') {
  const configuredModels = CLI_PROVIDER_MODEL_CATALOG[providerId] || []
  const aliasModels = Object.keys(MODEL_UPSTREAM_ALIASES[providerId] || {}).map(id => ({
    id,
    name: readableModelName(id),
    protocols: ['chat', 'messages'],
  }))
  const models = configuredModels.length > 0 ? configuredModels : aliasModels
  const seen = new Set()
  const normalized = []

  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    normalized.push({
      id: model.id,
      name: model.name || readableModelName(model.id),
      upstreamId: model.upstreamId || model.id,
      protocols: Array.isArray(model.protocols) ? model.protocols : ['chat'],
      disabled: model.disabled === true,
      note: model.note || '',
    })
  }

  if (defaultModel && !seen.has(defaultModel)) {
    normalized.unshift({
      id: defaultModel,
      name: readableModelName(defaultModel),
      upstreamId: defaultModel,
      protocols: ['chat'],
      disabled: false,
      note: 'Modelo salvo nesta conexao.',
    })
  }

  return normalized
}

function buildCliModelOptionGroups() {
  const db = loadData()
  const activeConnections = db.providerConnections
    .filter(connection => connection.enabled)
    .sort((a, b) => {
      const providerOrder = String(a.providerName || a.providerId).localeCompare(String(b.providerName || b.providerId))
      return providerOrder || (Number(a.priority) || 0) - (Number(b.priority) || 0)
    })

  const groups = activeConnections
    .map(connection => ({
      providerId: connection.providerId,
      providerName: connection.providerName,
      connectionId: connection.id,
      connectionName: connection.name || connection.providerName,
      category: connection.category,
      public: connection.connectionMode === 'public',
      models: modelsForCliProvider(connection.providerId, connection.defaultModel),
    }))
    .filter(group => group.models.length > 0)

  if (!groups.some(group => group.providerId === 'opencode-free')) {
    groups.push({
      providerId: 'opencode-free',
      providerName: 'OpenCode Free',
      connectionId: 'public-opencode-free',
      connectionName: 'Public Free',
      category: 'free-tier',
      public: true,
      models: modelsForCliProvider('opencode-free'),
    })
  }

  return groups
}

function resolveModelProvider(modelId) {
  const raw = String(modelId || '').trim()
  const normalizedRaw = raw.toLowerCase()
  const prefix = normalizedRaw.split('/')[0]

  try {
    const db = loadData()
    const connections = db.providerConnections
      .filter(connection => connection.enabled)
      .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))

    const exactDefault = connections.find(connection =>
      String(connection.defaultModel || '').trim().toLowerCase() === normalizedRaw
    )
    if (exactDefault) {
      return providerMeta(exactDefault.providerId, exactDefault.providerName)
    }

    const prefixedDefault = connections.find(connection => {
      const providerPrefix = `${connection.providerId}/`
      return normalizedRaw.startsWith(providerPrefix)
    })
    if (prefixedDefault) {
      return providerMeta(prefixedDefault.providerId, prefixedDefault.providerName)
    }
  } catch {
    // If the local data file is temporarily unavailable, fall back to static routing.
  }

  if (MODEL_ROUTE_PREFIX_PROVIDERS[prefix]) {
    return MODEL_ROUTE_PREFIX_PROVIDERS[prefix]
  }

  if (/^(gpt-|o[0-9]|text-embedding-|dall-e)/i.test(raw)) return providerMeta('openai')
  if (/^claude-/i.test(raw)) return providerMeta('anthropic')
  if (/^(gemini-|gemma-)/i.test(raw)) return providerMeta('gemini')
  if (/^grok-/i.test(raw)) return providerMeta('xai')
  if (/^sonar/i.test(raw)) return providerMeta('perplexity')
  if (/^@cf\//i.test(raw)) return providerMeta('cloudflare-workers-ai')
  if (/^accounts\/fireworks\//i.test(raw)) return providerMeta('fireworks-ai')

  return providerMeta('antigravity')
}

function sanitizeErrorMessage(value) {
  return String(value || 'Erro desconhecido')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer ***')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, 'ya29.***')
    .replace(/sk-[A-Za-z0-9._-]+/gi, 'sk-***')
    .slice(0, 600)
}

function normalizeChatCompletionsUrl(baseUrl) {
  const normalized = normalizeOptionalBaseUrl(baseUrl)
  if (!normalized) return null
  if (normalized.endsWith('/chat/completions')) return normalized
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`
  if (normalized.endsWith('/openai/v1')) return `${normalized}/chat/completions`
  return `${normalized}/chat/completions`
}

function normalizeAzureChatCompletionsUrl(baseUrl) {
  const normalized = normalizeOptionalBaseUrl(baseUrl)
  if (!normalized) return null
  if (normalized.includes('/chat/completions')) return normalized
  if (!normalized.includes('/openai/deployments/')) return null
  return `${normalized}/chat/completions?api-version=2024-02-01`
}

function extractCloudflareAccountId(connection) {
  return connection.providerSpecificData?.accountId
    || String(connection.baseUrl || '').match(/\/accounts\/([^/]+)/)?.[1]
    || String(connection.notes || '').match(/account(?:Id|ID)?\s*[:=]\s*([a-f0-9]{20,})/i)?.[1]
}

function openAICompatibleProxyBaseUrlRequired(providerId) {
  return providerId === 'aws-bedrock' || providerId === 'vertex'
}

function selectProviderConnection(providerId) {
  const db = loadData()
  const connections = db.providerConnections
    .filter(connection => connection.providerId === providerId && connection.enabled)
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))

  if (connections.length === 0) {
    if (providerId === 'zcode-ai') {
      const token = resolveZCodeToken()
      return {
        db,
        transient: true,
        connection: {
          id: 'local-zcode-ai',
          providerId,
          providerName: 'ZCode / Z.ai',
          category: 'oauth',
          authType: 'oauth',
          connectionMode: 'oauth',
          name: 'GLM 5.2 Proxy local',
          email: '',
          baseUrl: '',
          defaultModel: 'zc/GLM-5.2',
          apiKey: '',
          accessToken: token || '',
          refreshToken: '',
          sessionToken: '',
          enabled: true,
          priority: 0,
          status: 'active',
          testStatus: token ? 'untested' : 'offline',
          lastTested: null,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
      }
    }
    if (providerId === 'opencode-free') {
      return {
        db,
        transient: true,
        connection: {
          id: 'public-opencode-free',
          providerId,
          providerName: 'OpenCode Free',
          category: 'free-tier',
          authType: 'public',
          connectionMode: 'public',
          name: 'OpenCode Free public',
          email: '',
          baseUrl: 'https://opencode.ai/zen/v1',
          defaultModel: '',
          apiKey: '',
          accessToken: '',
          refreshToken: '',
          sessionToken: '',
          enabled: true,
          priority: 0,
          status: 'active',
          testStatus: 'untested',
          lastTested: null,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
      }
    }
    return { db, error: 'Nenhuma conexao ativa para este provider. Conecte uma conta/API key primeiro.' }
  }

  const settings = db.providerSettings[providerId] || { roundRobin: false, cursor: 0 }
  const index = settings.roundRobin && connections.length > 1
    ? (Number(settings.cursor) || 0) % connections.length
    : 0

  if (settings.roundRobin && connections.length > 1) {
    db.providerSettings[providerId] = {
      ...settings,
      cursor: index + 1,
      updated: new Date().toISOString(),
    }
  }

  return { db, connection: connections[index] }
}

async function refreshKiroToken(connection) {
  const psd = connection.providerSpecificData || {}
  if (!psd.clientId || !psd.clientSecret || !connection.refreshToken) {
    throw new Error('Kiro: sem credenciais para refresh. Refaca o login.')
  }
  const res = await fetch('https://oidc.us-east-1.amazonaws.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      clientId: psd.clientId,
      clientSecret: psd.clientSecret,
      refreshToken: connection.refreshToken,
      grantType: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error('Kiro: falha ao renovar token: ' + await res.text())
  const data = await res.json()
  connection.accessToken = data.accessToken
  connection.expiresAt = new Date(Date.now() + (data.expiresIn || 3600) * 1000).toISOString()
  if (data.refreshToken) connection.refreshToken = data.refreshToken
  const db = loadData()
  const stored = db.providerConnections.find(c => c.id === connection.id)
  if (stored) {
    stored.accessToken = connection.accessToken
    stored.expiresAt = connection.expiresAt
    if (data.refreshToken) stored.refreshToken = connection.refreshToken
    stored.updated = new Date().toISOString()
    stored.status = 'active'
    saveData(db)
  }
  console.log(`[KOGNIT] Token Kiro renovado. Expira: ${connection.expiresAt}`)
}

const OAUTH_REFRESH_CONFIGS = {
  'claude-code': { tokenUrl: 'https://api.anthropic.com/v1/oauth/token', clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', pkce: true },
  'openai-codex': { tokenUrl: 'https://auth.openai.com/oauth/token', clientId: 'app_EMoamEEZ73f0CkXaXp7hrann', pkce: true },
  'gemini-cli': { tokenUrl: 'https://oauth2.googleapis.com/token', clientId: '012777658812-l5km4htjgbn7i3skpud34rv3lrku0nr2.apps.googleusercontent.com', clientSecret: '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', pkce: false },
  'github-copilot': { tokenUrl: 'https://github.com/login/oauth/access_token', clientId: 'Iv1.b507a08c87ecfe98', clientSecret: '', pkce: false },
  'cline': { tokenUrl: null },
  'kilo-code': { tokenUrl: null },
}

async function refreshGenericOAuthToken(connection) {
  const config = OAUTH_REFRESH_CONFIGS[connection.providerId]
  if (!config || !config.tokenUrl || !connection.refreshToken) {
    throw new Error(`${connection.providerId}: refresh nao suportado. Refaca o login.`)
  }

  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: connection.refreshToken, client_id: config.clientId })
  if (config.clientSecret) body.set('client_secret', config.clientSecret)

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }

  const res = await fetch(config.tokenUrl, { method: 'POST', headers, body })
  if (!res.ok) throw new Error(`${connection.providerId}: falha refresh: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()

  connection.accessToken = data.access_token
  connection.expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  if (data.refresh_token) connection.refreshToken = data.refresh_token

  const db = loadData()
  const stored = db.providerConnections.find(c => c.id === connection.id)
  if (stored) {
    stored.accessToken = connection.accessToken
    stored.expiresAt = connection.expiresAt
    if (data.refresh_token) stored.refreshToken = connection.refreshToken
    stored.updated = new Date().toISOString()
    stored.status = 'active'
    saveData(db)
  }
  console.log(`[KOGNIT] Token ${connection.providerId} renovado. Expira: ${connection.expiresAt}`)
}

async function ensureModelCredential(connection) {
  if (!connection.enabled) {
    throw new Error('Conexao desligada para este provider.')
  }

  if (connection.expiresAt && new Date(connection.expiresAt).getTime() <= Date.now() + 300000) {
    if (connection.refreshToken) {
      if (connection.providerId === 'kiro-ai' && connection.providerSpecificData?.clientId) {
        await refreshKiroToken(connection)
      } else if (connection.providerId === 'antigravity') {
        await refreshAntigravityToken(connection)
      } else if (OAUTH_REFRESH_CONFIGS[connection.providerId]?.tokenUrl) {
        await refreshGenericOAuthToken(connection)
      } else if (new Date(connection.expiresAt).getTime() <= Date.now()) {
        throw new Error('Login expirado. Refaca a conexao.')
      }
    } else if (new Date(connection.expiresAt).getTime() <= Date.now()) {
      throw new Error('Login expirado. Refaca a conexao.')
    }
  }

  if (connection.connectionMode === 'public') return

  if (!connection.apiKey && !connection.accessToken && !connection.sessionToken) {
    throw new Error('Conexao sem token/API key. Adicione ou refaca o login.')
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = MODEL_TEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function readResponseMessage(response) {
  const text = await response.text().catch(() => '')
  if (!text) return response.statusText || 'sem corpo de resposta'

  try {
    const json = JSON.parse(text)
    return json.error?.message || json.error_description || json.message || json.detail || JSON.stringify(json).slice(0, 360)
  } catch {
    return text.slice(0, 360)
  }
}

async function assertResponseOk(response) {
  if (response.ok) return
  const detail = await readResponseMessage(response)
  throw new Error(`HTTP ${response.status}: ${detail}`)
}

async function testOpenAICompatibleModel({ url, token, model, headers = {}, authHeader = 'Authorization', bearer = true, timeoutMs = MODEL_TEST_TIMEOUT_MS }) {
  const authValue = token && authHeader
    ? { [authHeader]: bearer ? `Bearer ${token}` : token }
    : {}

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...authValue,
      ...headers,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      max_tokens: 8,
      stream: false,
    }),
  }, timeoutMs)

  await assertResponseOk(response)
  return { ok: true, message: 'modelo funcionando' }
}

function openAICompatibleTarget(providerId, connection) {
  if (providerId === 'opencode-free') {
    return {
      url: 'https://opencode.ai/zen/v1/chat/completions',
      token: 'public',
      headers: { 'x-opencode-client': 'desktop' },
    }
  }

  if (providerId === 'openai-codex') {
    return {
      url: 'https://chatgpt.com/backend-api/codex/responses',
      token: connection.accessToken || connection.apiKey,
      headers: { 'originator': 'codex-cli', 'User-Agent': 'codex-cli/1.0.18 (windows; x64)' },
      customTest: true,
    }
  }

  if (providerId === 'github-copilot') {
    return {
      url: normalizeChatCompletionsUrl(connection.baseUrl) || 'https://api.githubcopilot.com/chat/completions',
      token: connection.providerSpecificData?.copilotToken || connection.accessToken,
      headers: {
        'copilot-integration-id': 'vscode-chat',
        'editor-version': 'vscode/1.110.0',
        'editor-plugin-version': 'copilot-chat/0.38.0',
        'user-agent': 'GitHubCopilotChat/0.38.0',
        'openai-intent': 'conversation-panel',
        'x-github-api-version': '2025-04-01',
        'x-vscode-user-agent-library-version': 'electron-fetch',
        'X-Initiator': 'user',
      },
    }
  }

  if (providerId === 'cursor-ide' || providerId === 'cursor') {
    return {
      url: normalizeChatCompletionsUrl(connection.baseUrl) || 'https://api2.cursor.sh/v1/chat/completions',
      token: connection.accessToken || connection.sessionToken,
      headers: {},
    }
  }

  if (providerId === 'cline') {
    return {
      url: normalizeChatCompletionsUrl(connection.baseUrl) || 'https://api.cline.bot/api/v1/chat/completions',
      token: connection.accessToken,
      headers: { 'HTTP-Referer': 'https://cline.bot', 'X-Title': 'Cline' },
    }
  }

  if (providerId === 'kilo-code') {
    return {
      url: normalizeChatCompletionsUrl(connection.baseUrl) || 'https://api.kilo.ai/api/openrouter/chat/completions',
      token: connection.accessToken,
      headers: connection.providerSpecificData?.orgId
        ? { 'X-Kilocode-OrganizationID': connection.providerSpecificData.orgId }
        : {},
    }
  }

  if (providerId === 'azure-openai') {
    const url = normalizeAzureChatCompletionsUrl(connection.baseUrl)
    if (!url) {
      throw new Error('Azure OpenAI precisa da Base URL do deployment: https://SEU_RECURSO.openai.azure.com/openai/deployments/SEU_DEPLOYMENT')
    }
    return {
      url,
      token: null,
      headers: { 'api-key': connection.apiKey },
    }
  }

  if (providerId === 'cloudflare' || providerId === 'cloudflare-workers-ai') {
    const customUrl = normalizeChatCompletionsUrl(connection.baseUrl)
    if (customUrl && !customUrl.includes('/client/v4/accounts/')) {
      return {
        url: customUrl,
        token: connection.apiKey,
        headers: {},
      }
    }

    const accountId = extractCloudflareAccountId(connection)
    if (!accountId) {
      throw new Error('Cloudflare Workers AI precisa do accountId. Use Base URL https://api.cloudflare.com/client/v4/accounts/SEU_ACCOUNT_ID ou coloque accountId=... em Notes.')
    }
    return {
      url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
      token: connection.apiKey,
      headers: {},
    }
  }

  if (providerId === 'ollama-cloud' || providerId === 'ollama') {
    const baseUrl = normalizeOptionalBaseUrl(connection.baseUrl) || 'http://localhost:11434'
    return {
      url: `${baseUrl}/v1/chat/completions`,
      token: connection.apiKey || null,
      headers: {},
    }
  }

  if (openAICompatibleProxyBaseUrlRequired(providerId)) {
    const url = normalizeChatCompletionsUrl(connection.baseUrl)
    if (!url) {
      const name = PROVIDER_DISPLAY_NAMES[providerId] || providerId
      throw new Error(`${name} precisa de uma Base URL OpenAI-compatible no Kognit. O formulario atual nao coleta credenciais nativas suficientes para chamada direta.`)
    }
    return {
      url,
      token: connection.apiKey || connection.accessToken || connection.sessionToken,
      headers: {},
    }
  }

  if (OPENAI_COMPATIBLE_PROVIDER_URLS[providerId]) {
    return {
      url: normalizeChatCompletionsUrl(connection.baseUrl) || OPENAI_COMPATIBLE_PROVIDER_URLS[providerId],
      token: connection.apiKey || connection.accessToken || connection.sessionToken,
      headers: {},
      timeoutMs: providerId === 'zcode-ai' ? 180000 : undefined,
    }
  }

  if (connection.baseUrl) {
    return {
      url: normalizeChatCompletionsUrl(connection.baseUrl),
      token: connection.apiKey || connection.accessToken || connection.sessionToken,
      headers: {},
    }
  }

  return null
}

async function testOpenAICompatibleProvider(providerId, connection, model) {
  const target = openAICompatibleTarget(providerId, connection)
  if (!target) {
    throw new Error(`O provider ${PROVIDER_DISPLAY_NAMES[providerId] || providerId} ainda nao possui alvo OpenAI-compatible configurado.`)
  }

  return testOpenAICompatibleModel({
    url: target.url,
    token: target.token,
    model,
    headers: target.headers,
    authHeader: target.authHeader,
    bearer: target.bearer,
    timeoutMs: target.timeoutMs,
  })
}

async function proxyOpenAICompatibleChat({
  req,
  res,
  route,
  startedAt,
  providerId,
  providerName,
  requestedModel,
  upstreamModel,
}) {
  const selected = selectProviderConnection(providerId)
  if (selected.error) {
    recordUsageEvent({
      route,
      providerId,
      providerName,
      model: requestedModel,
      upstreamModel,
      ok: false,
      statusCode: 503,
      latencyMs: Date.now() - startedAt,
      errorType: 'service_unavailable',
      error: selected.error,
    })
    return res.status(503).json({
      error: { message: selected.error, type: 'service_unavailable' },
    })
  }

  const { db, connection, transient } = selected
  try {
    await ensureModelCredential(connection)
    const target = openAICompatibleTarget(providerId, connection)
    if (!target) {
      throw new Error(`O provider ${providerName} ainda nao possui proxy OpenAI-compatible no Kognit.`)
    }

    if (!transient) saveData(db)
    const authHeader = target.authHeader === false ? null : (target.authHeader || 'Authorization')
    const authValue = target.token && authHeader
      ? { [authHeader]: target.bearer === false ? target.token : `Bearer ${target.token}` }
      : {}
    const response = await fetch(target.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': req.body?.stream ? 'text/event-stream' : 'application/json',
        ...authValue,
        ...target.headers,
      },
      body: JSON.stringify({
        ...req.body,
        model: upstreamModel,
      }),
    })

    if (!response.ok) {
      const errorMessage = sanitizeErrorMessage(await response.text().catch(() => ''))
      recordUsageEvent({
        route,
        providerId,
        providerName: connection.providerName || providerName,
        model: requestedModel,
        upstreamModel,
        ok: false,
        statusCode: response.status,
        latencyMs: Date.now() - startedAt,
        errorType: 'upstream_error',
        error: errorMessage,
      })
      return res.status(response.status).json({
        error: { message: errorMessage, type: 'upstream_error' },
      })
    }

    const contentType = response.headers.get('content-type') || 'application/json'
    if (req.body?.stream && response.body) {
      res.status(response.status)
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
      }
      res.end()
      recordUsageEvent({
        route,
        providerId,
        providerName: connection.providerName || providerName,
        model: requestedModel,
        upstreamModel,
        ok: true,
        statusCode: response.status,
        latencyMs: Date.now() - startedAt,
      })
      return
    }

    const responseText = await response.text()
    let responseJson = null
    try {
      responseJson = JSON.parse(responseText)
      normalizeOpenAICompatibleResponse(responseJson)
    } catch {
      responseJson = null
    }

    recordUsageEvent({
      route,
      providerId,
      providerName: connection.providerName || providerName,
      model: requestedModel,
      upstreamModel,
      ok: true,
      statusCode: response.status,
      latencyMs: Date.now() - startedAt,
      tokens: responseJson?.usage,
    })
    if (responseJson) {
      res.status(response.status).json(responseJson)
    } else {
      res.status(response.status).type(contentType).send(responseText)
    }
  } catch (err) {
    const errorMessage = sanitizeErrorMessage(err.message)
    recordUsageEvent({
      route,
      providerId,
      providerName: connection.providerName || providerName,
      model: requestedModel,
      upstreamModel,
      ok: false,
      statusCode: 502,
      latencyMs: Date.now() - startedAt,
      errorType: 'upstream_error',
      error: errorMessage,
    })
    res.status(502).json({
      error: { message: errorMessage, type: 'upstream_error' },
    })
  }
}

function normalizeOpenAICompatibleResponse(data) {
  if (!data || !Array.isArray(data.choices)) return data

  for (const choice of data.choices) {
    const message = choice?.message
    if (!message || message.content !== null && message.content !== undefined) continue
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) continue

    const fallbackText = message.reasoning
      || message.reasoning_content
      || choice.text
      || ''

    message.content = typeof fallbackText === 'string' ? fallbackText : ''
  }

  return data
}

async function testGeminiApiKeyModel(connection, model) {
  const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(connection.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }],
      generationConfig: { maxOutputTokens: 8 },
    }),
  })

  await assertResponseOk(response)
  return { ok: true, message: 'modelo funcionando' }
}

async function testAnthropicModel(connection, model) {
  const baseUrl = normalizeOptionalBaseUrl(connection.baseUrl) || 'https://api.anthropic.com/v1'
  const url = baseUrl.endsWith('/messages') ? baseUrl : `${baseUrl}/messages`
  const authHeaders = connection.apiKey
    ? { 'x-api-key': connection.apiKey }
    : { Authorization: `Bearer ${connection.accessToken || connection.sessionToken}` }
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...authHeaders,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'claude-code-20250219,interleaved-thinking-2025-05-14',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
    }),
  })

  await assertResponseOk(response)
  return { ok: true, message: 'modelo funcionando' }
}

async function testCohereModel(connection, model) {
  const url = normalizeChatCompletionsUrl(connection.baseUrl) || OPENAI_COMPATIBLE_PROVIDER_URLS.cohere
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${connection.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      max_tokens: 8,
    }),
  })

  await assertResponseOk(response)
  return { ok: true, message: 'modelo funcionando' }
}

async function testCloudflareWorkersAiModel(connection, model) {
  const customUrl = normalizeChatCompletionsUrl(connection.baseUrl)
  if (customUrl && !customUrl.includes('/client/v4/accounts/')) {
    return testOpenAICompatibleModel({
      url: customUrl,
      token: connection.apiKey,
      model,
    })
  }

  const accountId = extractCloudflareAccountId(connection)
  if (!accountId) {
    throw new Error('Cloudflare Workers AI precisa do accountId. Coloque a Base URL como https://api.cloudflare.com/client/v4/accounts/SEU_ACCOUNT_ID ou coloque accountId=... em Notes.')
  }

  const response = await fetchWithTimeout(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${connection.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      max_tokens: 8,
    }),
  })

  await assertResponseOk(response)
  return { ok: true, message: 'modelo funcionando' }
}

async function testAntigravityModel(connection, model) {
  const projectId = await ensureAntigravityProject(connection)
  const sessionId = uuidv4() + Date.now().toString()
  const response = await fetchWithTimeout('https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${connection.accessToken}`,
      'User-Agent': `antigravity/1.107.0 ${process.platform}/${process.arch}`,
      'x-request-source': 'local',
      'X-Machine-Session-Id': sessionId,
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      project: projectId,
      model,
      userAgent: 'antigravity',
      requestType: 'agent',
      requestId: `agent-${uuidv4()}`,
      request: {
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }],
        generationConfig: { maxOutputTokens: 8 },
        sessionId,
      },
    }),
  })

  await assertResponseOk(response)
  return { ok: true, message: 'modelo funcionando' }
}

async function testGeminiCliModel(connection, model) {
  const response = await fetchWithTimeout('https://cloudcode-pa.googleapis.com/v1internal:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${connection.accessToken}`,
      'User-Agent': `GeminiCLI/0.34.0/${model} (${process.platform}; ${process.arch}; terminal)`,
      'X-Goog-Api-Client': 'google-genai-sdk/1.41.0 gl-node/v22.19.0',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      project: connection.projectId || '',
      model,
      request: {
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }],
        generationConfig: { maxOutputTokens: 8 },
      },
    }),
  })

  await assertResponseOk(response)
  return { ok: true, message: 'modelo funcionando' }
}

async function testKiroModel(connection, model) {
  const baseModel = model
    .replace(/-thinking-agentic$/, '')
    .replace(/-agentic$/, '')
    .replace(/-thinking$/, '')

  const response = await fetchWithTimeout('https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.amazon.eventstream',
      'X-Amz-Target': 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
      'User-Agent': 'AWS-SDK-JS/3.0.0 kiro-ide/1.0.0',
      'X-Amz-User-Agent': 'aws-sdk-js/3.0.0 kiro-ide/1.0.0',
      'Amz-Sdk-Request': 'attempt=1; max=3',
      'Amz-Sdk-Invocation-Id': uuidv4(),
      'Authorization': `Bearer ${connection.accessToken}`,
    },
    body: JSON.stringify({
      conversationState: {
        chatTriggerType: 'MANUAL',
        conversationId: uuidv4(),
        currentMessage: {
          userInputMessage: {
            content: 'Reply with OK only.',
            modelId: baseModel,
            origin: 'AI_EDITOR',
            userInputMessageContext: {},
          },
        },
        history: [],
      },
    }),
  })

  if (response.status === 400) {
    const text = await response.text().catch(() => '')
    if (text.includes('Invalid model')) {
      throw new Error(`Modelo "${baseModel}" nao disponivel nesta conta Kiro. Modelos validos: claude-sonnet-4.5, claude-sonnet-4, claude-haiku-4.5, deepseek-3.2, auto`)
    }
    throw new Error(`Kiro retornou 400: ${text.slice(0, 200)}`)
  }

  await assertResponseOk(response)
  return { ok: true, message: 'modelo funcionando' }
}

async function testProviderModel(body) {
  const providerId = normalizeProviderId(body.providerId)
  const modelId = String(body.modelId || '').trim()

  if (!providerId || !modelId) {
    throw new Error('Provider/modelo invalido para teste.')
  }

  const upstreamModel = resolveUpstreamModel(providerId, modelId, body.upstreamId)
  const selected = selectProviderConnection(providerId)
  if (selected.error) throw new Error(selected.error)

  const { db, connection, transient } = selected

  try {
    await ensureModelCredential(connection)

    let result
    if (providerId === 'antigravity') {
      result = await testAntigravityModel(connection, upstreamModel)
    } else if (providerId === 'gemini-cli') {
      result = await testGeminiCliModel(connection, upstreamModel)
    } else if (providerId === 'github-copilot') {
      result = await testOpenAICompatibleProvider(providerId, connection, upstreamModel)
    } else if (providerId === 'cline') {
      result = await testOpenAICompatibleProvider(providerId, connection, upstreamModel)
    } else if (providerId === 'kilo-code') {
      result = await testOpenAICompatibleProvider(providerId, connection, upstreamModel)
    } else if (providerId === 'kiro-ai') {
      result = await testKiroModel(connection, upstreamModel)
    } else if (providerId === 'opencode-free') {
      result = await testOpenAICompatibleProvider(providerId, connection, upstreamModel)
    } else if (providerId === 'anthropic') {
      result = await testAnthropicModel(connection, upstreamModel)
    } else if (providerId === 'cohere') {
      result = await testCohereModel(connection, upstreamModel)
    } else if (providerId === 'cloudflare' || providerId === 'cloudflare-workers-ai') {
      result = await testCloudflareWorkersAiModel(connection, upstreamModel)
    } else if (providerId === 'gemini' || providerId === 'google-ai-studio') {
      if (connection.baseUrl) {
        result = await testOpenAICompatibleModel({
          url: normalizeChatCompletionsUrl(connection.baseUrl),
          token: connection.apiKey,
          model: upstreamModel,
        })
      } else {
        result = await testGeminiApiKeyModel(connection, upstreamModel)
      }
    } else if (providerId === 'openai-codex') {
      const codexRes = await fetchWithTimeout('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${connection.accessToken}`,
          'originator': 'codex-cli',
          'User-Agent': 'codex-cli/1.0.18 (windows; x64)',
        },
        body: JSON.stringify({ model: upstreamModel, input: [], stream: false, store: false }),
      })
      if (codexRes.status === 401 || codexRes.status === 403) {
        throw new Error('Token Codex invalido ou expirado. Refaca o login.')
      }
      result = { ok: true, message: 'modelo funcionando (auth valida)' }
    } else if (providerId === 'claude-code') {
      result = await testAnthropicModel(connection, upstreamModel)
    } else if (providerId === 'cursor-ide' || providerId === 'cursor') {
      result = await testOpenAICompatibleProvider(providerId, connection, upstreamModel)
    } else if (providerId === 'ollama-cloud' || providerId === 'ollama') {
      const baseUrl = normalizeOptionalBaseUrl(connection.baseUrl) || 'http://localhost:11434'
      result = await testOpenAICompatibleModel({
        url: `${baseUrl}/v1/chat/completions`,
        token: connection.apiKey || null,
        model: upstreamModel,
      })
    } else if (providerId === 'replicate') {
      result = await testOpenAICompatibleModel({
        url: normalizeChatCompletionsUrl(connection.baseUrl) || OPENAI_COMPATIBLE_PROVIDER_URLS.replicate,
        token: connection.apiKey,
        model: upstreamModel,
      })
    } else if (providerId === 'hugging-face' || providerId === 'huggingface') {
      result = await testOpenAICompatibleModel({
        url: normalizeChatCompletionsUrl(connection.baseUrl) || OPENAI_COMPATIBLE_PROVIDER_URLS['hugging-face'],
        token: connection.apiKey,
        model: upstreamModel,
      })
    } else if (providerId === 'azure-openai') {
      const url = normalizeAzureChatCompletionsUrl(connection.baseUrl)
      if (!url) throw new Error('Azure OpenAI precisa da Base URL do deployment: https://SEU_RECURSO.openai.azure.com/openai/deployments/SEU_DEPLOYMENT')
      result = await testOpenAICompatibleModel({
        url,
        token: null,
        model: upstreamModel,
        headers: { 'api-key': connection.apiKey },
      })
    } else if (providerId === 'aws-bedrock') {
      const url = normalizeChatCompletionsUrl(connection.baseUrl)
      if (!url) {
        throw new Error('AWS Bedrock precisa de Base URL OpenAI-compatible no Kognit ou de implementacao SigV4 nativa. O formulario atual nao coleta access key/secret/region suficientes.')
      }
      result = await testOpenAICompatibleModel({
        url,
        token: connection.apiKey || connection.accessToken || connection.sessionToken,
        model: upstreamModel,
      })
    } else if (providerId === 'vertex') {
      const url = normalizeChatCompletionsUrl(connection.baseUrl)
      if (!url) {
        throw new Error('Vertex AI precisa de Base URL OpenAI-compatible ou token Google Cloud valido via proxy. API key simples nao cobre todos os projetos Vertex.')
      }
      result = await testOpenAICompatibleModel({
        url,
        token: connection.apiKey || connection.accessToken || connection.sessionToken,
        model: upstreamModel,
      })
    } else if (OPENAI_COMPATIBLE_PROVIDER_URLS[providerId]) {
      result = await testOpenAICompatibleModel({
        url: normalizeChatCompletionsUrl(connection.baseUrl) || OPENAI_COMPATIBLE_PROVIDER_URLS[providerId],
        token: connection.apiKey || connection.accessToken || connection.sessionToken,
        model: upstreamModel,
      })
    } else if (connection.baseUrl) {
      result = await testOpenAICompatibleModel({
        url: normalizeChatCompletionsUrl(connection.baseUrl),
        token: connection.apiKey || connection.accessToken || connection.sessionToken,
        model: upstreamModel,
      })
    } else {
      throw new Error('Teste live deste provider ainda nao foi implementado no Kognit.')
    }

    const now = new Date().toISOString()
    connection.testStatus = 'ready'
    connection.status = 'active'
    connection.lastTested = now
    connection.updated = now
    if (!transient) saveData(db)
    return { ok: true, providerId, modelId, upstreamModel, connection: publicProviderConnection(connection), ...result }
  } catch (err) {
    const now = new Date().toISOString()
    connection.testStatus = 'error'
    connection.status = 'error'
    connection.lastTested = now
    connection.updated = now
    if (!transient) saveData(db)
    return {
      ok: false,
      providerId,
      modelId,
      upstreamModel,
      connection: publicProviderConnection(connection),
      error: sanitizeErrorMessage(err.message),
    }
  }
}

function isCloudflaredUsable(bin) {
  const result = spawnSync(bin, ['--version'], {
    encoding: 'utf-8',
    timeout: 10000,
    windowsHide: true,
  })

  return !result.error && result.status === 0
}

function getCloudflaredBin() {
  const candidates = []

  try {
    const output = execSync('where.exe cloudflared', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    candidates.push(...output.split(/\r?\n/).map(line => line.trim()).filter(Boolean))
  } catch {
    // cloudflared is not on PATH.
  }

  candidates.push(CLOUDFLARED_PATH, ROOT_CLOUDFLARED_PATH)

  for (const candidate of candidates) {
    const isNamedCommand = candidate === 'cloudflared'
    if (isNamedCommand || fs.existsSync(candidate)) {
      if (isCloudflaredUsable(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function downloadCloudflared() {
  return new Promise((resolve, reject) => {
    const url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    const tempPath = `${CLOUDFLARED_PATH}.download`

    function follow(u) {
      https.get(u, { headers: { 'User-Agent': 'kognit' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(new URL(res.headers.location, u).toString())
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`))
          return
        }
        fs.mkdirSync(__dirname, { recursive: true })
        const file = fs.createWriteStream(tempPath)
        res.pipe(file)
        file.on('finish', () => {
          file.close(() => {
            fs.renameSync(tempPath, CLOUDFLARED_PATH)
            if (!isCloudflaredUsable(CLOUDFLARED_PATH)) {
              fs.rmSync(CLOUDFLARED_PATH, { force: true })
              reject(new Error('cloudflared baixado, mas o executavel nao roda neste Windows'))
              return
            }
            resolve(CLOUDFLARED_PATH)
          })
        })
        file.on('error', reject)
      }).on('error', reject).setTimeout(120000, function onTimeout() {
        this.destroy(new Error('Timeout baixando cloudflared'))
      })
    }

    follow(url)
  })
}

let tunnelProcess = null
let tunnelUrl = null

// --- TUNNEL ---

app.get('/api/tunnel/status', async (req, res) => {
  const localApi = await resolveLocalApi()

  if (tunnelProcess && !isTunnelAlive()) {
    clearTunnelState()
  }

  const active = isTunnelAlive()
  if (!active) {
    clearStoredTunnelUrl()
  }

  res.json({
    active,
    url: active ? tunnelUrl : null,
    localUrl: localApi?.endpoint ?? null,
    localActive: !!localApi,
  })
})

app.post('/api/tunnel/start', async (req, res) => {
  const localApi = await resolveLocalApi()

  if (!localApi) {
    clearTunnelState()
    return res.status(503).json({
      error: 'Nenhum endpoint local /v1 ativo. Abra o servidor local antes de ligar o tunnel.',
      active: false,
      url: null,
      localUrl: null,
    })
  }

  if (isTunnelAlive()) {
    return res.json({ active: true, url: tunnelUrl, localUrl: localApi.endpoint })
  }

  if (tunnelProcess) {
    clearTunnelState()
  }

  let bin = getCloudflaredBin()

  if (!bin) {
    try {
      bin = await downloadCloudflared()
    } catch (err) {
      return res.status(500).json({ error: `Falha ao baixar cloudflared: ${err.message}` })
    }
  }

  const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', localApi.origin], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  })

  let resolved = false
  const logs = []

  function rememberLog(data) {
    const text = data.toString()
    logs.push(text.trim())
    if (logs.length > 20) logs.shift()
    return text
  }

  function recentLogs() {
    return logs.filter(Boolean).join('\n').slice(-2000)
  }

  function extractUrl(data) {
    const text = rememberLog(data)
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
    if (match && !resolved) {
      resolved = true
      tunnelUrl = match[0] + '/v1'
      tunnelProcess = child
      const db = loadData()
      db.tunnelUrl = tunnelUrl
      saveData(db)
      res.json({ active: true, url: tunnelUrl, localUrl: localApi.endpoint })
    }
  }

  child.stdout.on('data', extractUrl)
  child.stderr.on('data', extractUrl)

  child.on('error', (err) => {
    if (!resolved) {
      resolved = true
      res.status(500).json({ error: `Erro ao executar cloudflared: ${err.message}` })
    }
  })

  child.on('exit', (code, signal) => {
    clearTunnelState()
    if (!resolved) {
      resolved = true
      const detail = recentLogs()
      const suffix = detail ? `\n${detail}` : ''
      res.status(500).json({ error: `cloudflared encerrou antes de gerar URL (code=${code}, signal=${signal}).${suffix}` })
    }
  })

  setTimeout(() => {
    if (!resolved) {
      resolved = true
      child.kill()
      const detail = recentLogs()
      const suffix = detail ? `\n${detail}` : ''
      res.status(504).json({ error: `Timeout esperando URL do tunel.${suffix}` })
    }
  }, 45000)
})

app.post('/api/tunnel/stop', async (req, res) => {
  if (isTunnelAlive()) {
    tunnelProcess.kill()
  }
  clearTunnelState()
  const localApi = await resolveLocalApi()
  res.json({ active: false, url: null, localUrl: localApi?.endpoint ?? null })
})

// --- GLM 5.2 PROXY STATUS ---
// Endpoint de leitura (auto-start no boot, sem controle manual conforme design).

app.get('/api/glm-proxy/status', async (req, res) => {
  const token = resolveZCodeToken()
  res.json({
    active: isGlmProxyAlive(),
    restarting: !!glmProxyRestartPromise,
    pid: glmProxyProcess?.pid ?? null,
    host: GLM_PROXY_HOST,
    port: GLM_PROXY_PORT,
    hasToken: !!token,
    error: isGlmProxyAlive() ? null : glmProxyStatus.error,
    startedAt: glmProxyStatus.startedAt,
    recentLogs: glmProxyLogs.slice(-25),
    captcha: {
      bridge: process.env.ZCODE_CAPTCHA_BRIDGE || 'true',
      headless: process.env.ZCODE_CAPTCHA_HEADLESS || 'false',
      clientPreference: process.env.ZCODE_CAPTCHA_CLIENT_PREFERENCE || 'standalone-browser',
      browserUrl: '/zcode/captcha/browser?client=standalone-browser',
    },
  })
})

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'kognit',
    zcodeProxy: {
      active: isGlmProxyAlive(),
      port: GLM_PROXY_PORT,
      configured: !!resolveZCodeToken(),
    },
  })
})

app.use('/zcode/captcha', async (req, res) => {
  const targetUrl = `http://${GLM_PROXY_HOST}:${GLM_PROXY_PORT}${req.originalUrl}`
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  try {
    const hasBody = !['GET', 'HEAD'].includes(req.method)
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        Accept: req.get('accept') || '*/*',
        ...(req.get('content-type') ? { 'Content-Type': req.get('content-type') } : {}),
      },
      body: hasBody && req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    })

    res.status(upstream.status)
    for (const header of ['content-type', 'cache-control', 'access-control-allow-origin']) {
      const value = upstream.headers.get(header)
      if (value) res.setHeader(header, value)
    }

    if (!upstream.body) return res.end()
    const reader = upstream.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    return res.end()
  } catch (error) {
    if (error.name === 'AbortError') return
    return res.status(502).json({
      error: {
        type: 'captcha_proxy_error',
        message: `Broker CAPTCHA indisponivel: ${sanitizeErrorMessage(error.message)}`,
      },
    })
  }
})

// --- OAUTH CONNECTION FLOWS ---

app.get('/api/oauth-connections/:providerId/meta', (req, res) => {
  try {
    res.json(getOAuthProviderMeta(req.params.providerId))
  } catch (err) {
    res.status(404).json({ error: err.message })
  }
})

app.post('/api/oauth-connections/:providerId/start', async (req, res) => {
  try {
    const meta = getOAuthProviderMeta(req.params.providerId)

    if (meta.flowType === 'device_code') {
      const device = await createDeviceOAuthSession(req.params.providerId, req.body || {})
      return res.json({ mode: 'device', ...device })
    }

    if (['authorization_code', 'authorization_code_pkce'].includes(meta.flowType)) {
      const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim()
      const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim()
      const requestOrigin = normalizeOrigin(PUBLIC_ORIGIN)
        || normalizeOrigin(`${forwardedProto || req.protocol}://${forwardedHost || req.get('host')}`)
        || `http://localhost:${PORT}`
      const auth = await createBrowserOAuthSession(req.params.providerId, requestOrigin)
      return res.json({ mode: 'browser', ...auth })
    }

    if (meta.flowType === 'import_token') {
      return res.json({
        mode: 'import',
        providerId: req.params.providerId,
        fields: ['accessToken', 'machineId'],
      })
    }

    res.status(400).json({ error: 'Unsupported OAuth flow' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/oauth-connections/callback/:sessionId', async (req, res) => {
  try {
    await completeOAuthCallbackFromUrl(`${req.protocol}://${req.get('host')}${req.originalUrl}`, saveOAuthProviderTokens)
    res.send(`
      <!doctype html>
      <html>
        <body style="background:#000;color:#fff;font-family:monospace">
          <h3>Kognit OAuth connected.</h3>
          <p>You can close this window and return to Kognit.</p>
          <script>setTimeout(() => window.close(), 1200)</script>
        </body>
      </html>
    `)
  } catch (err) {
    res.status(500).send(`
      <!doctype html>
      <html>
        <body style="background:#000;color:#ffb4b4;font-family:monospace">
          <h3>Kognit OAuth failed.</h3>
          <pre>${String(err.message).replace(/[<>&]/g, '')}</pre>
        </body>
      </html>
    `)
  }
})

app.get('/api/oauth-connections/session/:sessionId', async (req, res) => {
  try {
    const status = getOAuthSessionStatus(req.params.sessionId)
    if (status.status === 'callback_received') {
      await completePendingCallbackSession(req.params.sessionId, saveOAuthProviderTokens)
      return res.json(getOAuthSessionStatus(req.params.sessionId))
    }
    res.json(status)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/oauth-connections/session/:sessionId/poll', async (req, res) => {
  try {
    const result = await pollDeviceOAuthSession(req.params.sessionId, saveOAuthProviderTokens)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/oauth-connections/:providerId/manual-callback', async (req, res) => {
  try {
    const { callbackUrl, code, sessionId } = req.body || {}
    const result = callbackUrl
      ? await completeOAuthCallbackFromUrl(callbackUrl, saveOAuthProviderTokens)
      : await completeOAuthSession(sessionId, code, saveOAuthProviderTokens)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/oauth-connections/:providerId/import', async (req, res) => {
  try {
    const result = await importOAuthToken(req.params.providerId, req.body || {}, saveOAuthProviderTokens)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// --- PROVIDER MODEL TESTS ---

app.post('/api/provider-models/test', async (req, res) => {
  const startedAt = Date.now()
  const providerId = normalizeProviderId(req.body?.providerId)
  const providerName = String(req.body?.providerName || providerId || 'Provider')
  const modelId = String(req.body?.modelId || '')

  try {
    const result = await testProviderModel(req.body || {})
    recordUsageEvent({
      route: '/api/provider-models/test',
      providerId: result.providerId || providerId,
      providerName: result.connection?.providerName || providerName,
      model: result.modelId || modelId,
      upstreamModel: result.upstreamModel,
      ok: !!result.ok,
      statusCode: result.ok ? 200 : 400,
      latencyMs: Date.now() - startedAt,
      errorType: result.ok ? '' : 'model_test_error',
      error: result.error,
    })
    res.status(result.ok ? 200 : 400).json(result)
  } catch (err) {
    const errorMessage = sanitizeErrorMessage(err.message)
    recordUsageEvent({
      route: '/api/provider-models/test',
      providerId: providerId || 'unknown',
      providerName,
      model: modelId,
      upstreamModel: String(req.body?.upstreamId || ''),
      ok: false,
      statusCode: 400,
      latencyMs: Date.now() - startedAt,
      errorType: 'model_test_error',
      error: errorMessage,
    })
    res.status(400).json({ ok: false, error: errorMessage })
  }
})

// --- PROVIDER CONNECTIONS ---

app.get('/api/provider-connections', (req, res) => {
  const db = loadData()
  const providerId = normalizeProviderId(req.query.providerId)
  const connections = providerId
    ? db.providerConnections.filter(connection => connection.providerId === providerId)
    : db.providerConnections

  res.json(connections.map(publicProviderConnection))
})

app.post('/api/provider-connections', (req, res) => {
  const parsed = parseConnectionPayload(req.body)
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error })
  }

  const db = loadData()
  const nextPriority = db.providerConnections
    .filter(connection => connection.providerId === parsed.connection.providerId)
    .reduce((max, connection) => Math.max(max, Number(connection.priority) || 0), -1) + 1

  const connection = { ...parsed.connection, priority: nextPriority }
  db.providerConnections.push(connection)

  if (!db.providerSettings[connection.providerId]) {
    db.providerSettings[connection.providerId] = { roundRobin: false, cursor: 0 }
  }

  saveData(db)
  res.json(publicProviderConnection(connection))
})

app.patch('/api/provider-connections/:id', (req, res) => {
  const db = loadData()
  const connection = db.providerConnections.find(item => item.id === req.params.id)

  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' })
  }

  if (req.body.name !== undefined) {
    if (!req.body.name?.trim()) {
      return res.status(400).json({ error: 'Nome da conexao e obrigatorio' })
    }
    connection.name = req.body.name.trim()
  }

  if (req.body.email !== undefined) connection.email = req.body.email?.trim() || ''
  if (req.body.defaultModel !== undefined) connection.defaultModel = req.body.defaultModel?.trim() || ''
  if (req.body.notes !== undefined) connection.notes = req.body.notes?.trim() || ''
  if (req.body.enabled !== undefined) connection.enabled = !!req.body.enabled
  if (req.body.priority !== undefined && Number.isFinite(Number(req.body.priority))) {
    connection.priority = Number(req.body.priority)
  }

  if (req.body.baseUrl !== undefined) {
    const baseUrl = normalizeOptionalBaseUrl(req.body.baseUrl)
    if (baseUrl === null) {
      return res.status(400).json({ error: 'Base URL invalida' })
    }
    connection.baseUrl = baseUrl
  }

  if (req.body.apiKey) connection.apiKey = req.body.apiKey.trim()
  if (req.body.accessToken) connection.accessToken = req.body.accessToken.trim()
  if (req.body.refreshToken) connection.refreshToken = req.body.refreshToken.trim()
  if (req.body.sessionToken) connection.sessionToken = req.body.sessionToken.trim()

  connection.updated = new Date().toISOString()
  saveData(db)
  res.json(publicProviderConnection(connection))
})

app.delete('/api/provider-connections/:id', (req, res) => {
  const db = loadData()
  const before = db.providerConnections.length
  db.providerConnections = db.providerConnections.filter(item => item.id !== req.params.id)

  if (db.providerConnections.length === before) {
    return res.status(404).json({ error: 'Connection not found' })
  }

  saveData(db)
  res.json({ success: true })
})

app.post('/api/provider-connections/:id/test', (req, res) => {
  const db = loadData()
  const connection = db.providerConnections.find(item => item.id === req.params.id)

  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' })
  }

  const hasCredential =
    connection.connectionMode === 'public' ||
    !!connection.apiKey ||
    !!connection.accessToken ||
    !!connection.sessionToken

  connection.testStatus = hasCredential ? 'ready' : 'missing_credentials'
  connection.status = hasCredential ? 'active' : 'error'
  connection.lastTested = new Date().toISOString()
  connection.updated = connection.lastTested

  saveData(db)
  res.json(publicProviderConnection(connection))
})

app.get('/api/provider-settings', (req, res) => {
  const db = loadData()
  const providerId = normalizeProviderId(req.query.providerId)

  if (providerId) {
    return res.json(db.providerSettings[providerId] || { roundRobin: false, cursor: 0 })
  }

  res.json(db.providerSettings)
})

app.patch('/api/provider-settings/:providerId', (req, res) => {
  const db = loadData()
  const providerId = normalizeProviderId(req.params.providerId)

  if (!providerId) {
    return res.status(400).json({ error: 'Provider invalido' })
  }

  const current = db.providerSettings[providerId] || { roundRobin: false, cursor: 0 }
  const next = {
    ...current,
    roundRobin: req.body.roundRobin !== undefined ? !!req.body.roundRobin : !!current.roundRobin,
    cursor: Number.isFinite(Number(req.body.cursor)) ? Number(req.body.cursor) : Number(current.cursor) || 0,
    updated: new Date().toISOString(),
  }

  db.providerSettings[providerId] = next
  saveData(db)
  res.json(next)
})

// --- PROVIDERS ---

app.get('/api/providers', (req, res) => {
  const db = loadData()
  res.json(db.providers.map(publicProvider))
})

app.post('/api/providers', (req, res) => {
  const { name, baseUrl, model, apiKey } = req.body
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Nome do provider e obrigatorio' })
  }

  if (!normalizedBaseUrl) {
    return res.status(400).json({ error: 'Base URL invalida' })
  }

  const db = loadData()
  const provider = {
    id: uuidv4(),
    name: name.trim(),
    baseUrl: normalizedBaseUrl,
    model: model?.trim() || '',
    apiKey: apiKey?.trim() || '',
    enabled: true,
    created: new Date().toLocaleDateString('pt-BR'),
  }

  db.providers.push(provider)
  saveData(db)
  res.json(publicProvider(provider))
})

app.patch('/api/providers/:id', (req, res) => {
  const db = loadData()
  const provider = db.providers.find(item => item.id === req.params.id)

  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' })
  }

  if (req.body.name !== undefined) {
    if (!req.body.name?.trim()) {
      return res.status(400).json({ error: 'Nome do provider e obrigatorio' })
    }
    provider.name = req.body.name.trim()
  }

  if (req.body.baseUrl !== undefined) {
    const normalizedBaseUrl = normalizeBaseUrl(req.body.baseUrl)
    if (!normalizedBaseUrl) {
      return res.status(400).json({ error: 'Base URL invalida' })
    }
    provider.baseUrl = normalizedBaseUrl
  }

  if (req.body.model !== undefined) {
    provider.model = req.body.model?.trim() || ''
  }

  if (req.body.apiKey !== undefined && req.body.apiKey !== '') {
    provider.apiKey = req.body.apiKey?.trim() || ''
  }

  if (req.body.enabled !== undefined) {
    provider.enabled = !!req.body.enabled
  }

  saveData(db)
  res.json(publicProvider(provider))
})

app.delete('/api/providers/:id', (req, res) => {
  const db = loadData()
  db.providers = db.providers.filter(item => item.id !== req.params.id)
  saveData(db)
  res.json({ success: true })
})

// --- API KEYS ---

app.get('/api/keys', (req, res) => {
  const db = loadData()
  res.json(db.keys)
})

app.post('/api/keys', (req, res) => {
  const { name } = req.body
  const db = loadData()
  const key = {
    id: uuidv4(),
    name: name || `key-${Date.now()}`,
    secret: 'sk-' + uuidv4().replace(/-/g, '').slice(0, 32),
    preview: '',
    created: new Date().toLocaleDateString('pt-BR'),
    active: true,
  }
  key.preview = key.secret.slice(0, 7) + '...'
  db.keys.push(key)
  saveData(db)
  res.json(key)
})

app.patch('/api/keys/:id', (req, res) => {
  const db = loadData()
  const key = db.keys.find(k => k.id === req.params.id)
  if (!key) return res.status(404).json({ error: 'Key not found' })
  if (req.body.active !== undefined) key.active = req.body.active
  if (req.body.name !== undefined) key.name = req.body.name
  saveData(db)
  res.json(key)
})

app.delete('/api/keys/:id', (req, res) => {
  const db = loadData()
  db.keys = db.keys.filter(k => k.id !== req.params.id)
  saveData(db)
  res.json({ success: true })
})

// --- USAGE ANALYTICS ---

const MAX_USAGE_EVENTS = 2000

function safeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalizeUsageTokens(tokens = {}) {
  const prompt = safeNumber(tokens.prompt ?? tokens.prompt_tokens ?? tokens.input_tokens)
  const completion = safeNumber(tokens.completion ?? tokens.completion_tokens ?? tokens.output_tokens)
  const total = safeNumber(tokens.total ?? tokens.total_tokens) || prompt + completion
  return { prompt, completion, total }
}

function recordUsageEvent(event) {
  try {
    const db = loadData()
    const tokens = normalizeUsageTokens(event.tokens)
    const safeEvent = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      route: String(event.route || ''),
      providerId: normalizeProviderId(event.providerId || 'antigravity') || 'antigravity',
      providerName: String(event.providerName || 'Antigravity'),
      model: String(event.model || ''),
      upstreamModel: String(event.upstreamModel || ''),
      ok: !!event.ok,
      statusCode: safeNumber(event.statusCode) || (event.ok ? 200 : 500),
      latencyMs: Math.max(0, Math.round(safeNumber(event.latencyMs))),
      tokens,
      errorType: event.ok ? '' : sanitizeErrorMessage(event.errorType || 'error'),
      error: event.ok ? '' : sanitizeErrorMessage(event.error),
    }

    db.usageEvents = [...db.usageEvents, safeEvent].slice(-MAX_USAGE_EVENTS)
    saveData(db)
    return safeEvent
  } catch (err) {
    console.warn(`Usage analytics write failed: ${err.message}`)
    return null
  }
}

function hourBucket(date) {
  const bucket = new Date(date)
  bucket.setMinutes(0, 0, 0)
  return bucket
}

function bucketKey(date) {
  return date.toISOString()
}

function buildUsageAnalytics() {
  const db = loadData()
  const now = new Date()
  const endHour = hourBucket(now)
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const events = db.usageEvents
    .filter(event => {
      const created = new Date(event.createdAt).getTime()
      return Number.isFinite(created) && created >= since.getTime()
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const timelineMap = new Map()
  for (let i = 23; i >= 0; i -= 1) {
    const bucket = new Date(endHour.getTime() - i * 60 * 60 * 1000)
    timelineMap.set(bucketKey(bucket), {
      time: bucketKey(bucket),
      label: bucket.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      requests: 0,
      errors: 0,
      tokens: 0,
      latencyTotal: 0,
      avgLatencyMs: 0,
    })
  }

  const modelMap = new Map()
  const providerMap = new Map()
  let totalTokens = 0
  let promptTokens = 0
  let completionTokens = 0
  let latencyTotal = 0
  let errorRequests = 0

  for (const event of events) {
    const tokens = normalizeUsageTokens(event.tokens)
    const latency = safeNumber(event.latencyMs)
    const ok = !!event.ok
    const eventHour = bucketKey(hourBucket(new Date(event.createdAt)))
    const timeline = timelineMap.get(eventHour)

    totalTokens += tokens.total
    promptTokens += tokens.prompt
    completionTokens += tokens.completion
    latencyTotal += latency
    if (!ok) errorRequests += 1

    if (timeline) {
      timeline.requests += 1
      timeline.errors += ok ? 0 : 1
      timeline.tokens += tokens.total
      timeline.latencyTotal += latency
    }

    const modelKey = `${event.providerId || 'unknown'}:${event.model || 'unknown'}`
    const modelStats = modelMap.get(modelKey) || {
      providerId: event.providerId || 'unknown',
      providerName: event.providerName || event.providerId || 'Unknown',
      model: event.model || 'unknown',
      requests: 0,
      errors: 0,
      tokens: 0,
      latencyTotal: 0,
      avgLatencyMs: 0,
    }
    modelStats.requests += 1
    modelStats.errors += ok ? 0 : 1
    modelStats.tokens += tokens.total
    modelStats.latencyTotal += latency
    modelMap.set(modelKey, modelStats)

    const providerKey = event.providerId || 'unknown'
    const providerStats = providerMap.get(providerKey) || {
      providerId: providerKey,
      providerName: event.providerName || providerKey,
      requests: 0,
      errors: 0,
      tokens: 0,
      latencyTotal: 0,
      avgLatencyMs: 0,
    }
    providerStats.requests += 1
    providerStats.errors += ok ? 0 : 1
    providerStats.tokens += tokens.total
    providerStats.latencyTotal += latency
    providerMap.set(providerKey, providerStats)
  }

  const timeline = Array.from(timelineMap.values()).map(bucket => ({
    ...bucket,
    avgLatencyMs: bucket.requests ? Math.round(bucket.latencyTotal / bucket.requests) : 0,
    latencyTotal: undefined,
  }))

  const topModels = Array.from(modelMap.values())
    .map(item => ({
      ...item,
      avgLatencyMs: item.requests ? Math.round(item.latencyTotal / item.requests) : 0,
      errorRate: item.requests ? Math.round((item.errors / item.requests) * 1000) / 10 : 0,
      latencyTotal: undefined,
    }))
    .sort((a, b) => b.requests - a.requests || b.tokens - a.tokens)
    .slice(0, 8)

  const providerStats = Array.from(providerMap.values())
    .map(item => ({
      ...item,
      avgLatencyMs: item.requests ? Math.round(item.latencyTotal / item.requests) : 0,
      errorRate: item.requests ? Math.round((item.errors / item.requests) * 1000) / 10 : 0,
      latencyTotal: undefined,
    }))
    .sort((a, b) => b.requests - a.requests)

  const recentErrors = events
    .filter(event => !event.ok)
    .slice(-10)
    .reverse()
    .map(event => ({
      id: event.id,
      createdAt: event.createdAt,
      route: event.route,
      providerId: event.providerId,
      providerName: event.providerName,
      model: event.model,
      statusCode: event.statusCode,
      errorType: event.errorType,
      error: event.error,
      latencyMs: event.latencyMs,
    }))

  return {
    range: '24h',
    since: since.toISOString(),
    until: now.toISOString(),
    summary: {
      totalRequests: events.length,
      successRequests: events.length - errorRequests,
      errorRequests,
      errorRate: events.length ? Math.round((errorRequests / events.length) * 1000) / 10 : 0,
      totalTokens,
      promptTokens,
      completionTokens,
      avgLatencyMs: events.length ? Math.round(latencyTotal / events.length) : 0,
    },
    timeline,
    topModels,
    providerStats,
    recentErrors,
  }
}

app.get('/api/usage/analytics', (req, res) => {
  res.json(buildUsageAnalytics())
})

// --- V1 PROXY (OpenAI-compatible) ---

const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
const ANTIGRAVITY_CLIENT_SECRET = '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'
const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ANTIGRAVITY_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent'
const ANTIGRAVITY_STREAM_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse'
const ANTIGRAVITY_LOAD_CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'

function antigravityClientMetadata() {
  return {
    ideType: 9,
    platform: process.platform === 'win32' ? 2 : process.platform === 'darwin' ? 3 : 1,
    pluginType: 2,
  }
}

function extractAntigravityProjectId(data) {
  const project = data?.cloudaicompanionProject
  if (!project) return ''
  if (typeof project === 'string') return project
  return project.id || project.projectId || ''
}

function describeAntigravityProjectIssue(data) {
  const ineligible = Array.isArray(data?.ineligibleTiers) ? data.ineligibleTiers[0] : null
  if (ineligible?.reasonCode === 'RESTRICTED_AGE') {
    return 'Conta Google nao elegivel para Gemini Code Assist individual: precisa verificar idade/ter 18+ nessa conta. O login OAuth funcionou, mas o Google nao liberou um projeto Antigravity para ela.'
  }
  if (ineligible?.reasonMessage) {
    return `Conta Google nao elegivel para Gemini Code Assist: ${ineligible.reasonMessage}`
  }
  if (Array.isArray(data?.allowedTiers) && data.allowedTiers.some(t => t.userDefinedCloudaicompanionProject)) {
    return 'Antigravity nao retornou projectId para esta conta. Ela parece exigir um projeto Google Cloud configurado/selecionado antes de usar os modelos.'
  }
  return 'Antigravity nao retornou projectId para esta conta. Abra o Antigravity/Gemini Code Assist com essa conta e conclua o onboarding, depois reconecte.'
}

async function loadAntigravityProjectInfo(connection) {
  const metadata = antigravityClientMetadata()
  const response = await fetch(ANTIGRAVITY_LOAD_CODE_ASSIST_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'google-api-nodejs-client/9.15.1',
      'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
      'Client-Metadata': JSON.stringify(metadata),
      'x-request-source': 'local',
    },
    body: JSON.stringify({ metadata }),
  })
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const err = new Error(`Antigravity loadCodeAssist HTTP ${response.status}: ${sanitizeErrorMessage(text)}`)
    err.statusCode = response.status
    throw err
  }
  return { data, projectId: extractAntigravityProjectId(data) }
}

async function ensureAntigravityProject(connection) {
  if (connection.projectId) return connection.projectId

  const { data, projectId } = await loadAntigravityProjectInfo(connection)
  if (projectId) {
    connection.projectId = projectId
    const db = loadData()
    const stored = db.providerConnections.find(c => c.id === connection.id)
    if (stored) {
      stored.projectId = projectId
      stored.status = 'active'
      stored.updated = new Date().toISOString()
      saveData(db)
    }
    return projectId
  }

  const err = new Error(describeAntigravityProjectIssue(data))
  err.statusCode = 403
  err.code = 'ANTIGRAVITY_PROJECT_NOT_AVAILABLE'
  throw err
}

async function refreshAntigravityToken(connection) {
  if (!connection.refreshToken) throw new Error('Sem refresh token')
  const res = await fetch(ANTIGRAVITY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken,
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error('Falha ao renovar token: ' + await res.text())
  const data = await res.json()
  connection.accessToken = data.access_token
  connection.expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  if (data.refresh_token) {
    connection.refreshToken = data.refresh_token
  }
  const db = loadData()
  const stored = db.providerConnections.find(c => c.id === connection.id)
  if (stored) {
    stored.accessToken = connection.accessToken
    stored.expiresAt = connection.expiresAt
    if (data.refresh_token) stored.refreshToken = connection.refreshToken
    stored.updated = new Date().toISOString()
    stored.status = 'active'
    saveData(db)
  }
  console.log(`[KOGNIT] Token Antigravity renovado. Expira: ${connection.expiresAt}`)
}

async function ensureAntigravityToken(connection) {
  const expiresMs = connection.expiresAt ? new Date(connection.expiresAt).getTime() : 0
  if (expiresMs <= Date.now() + 300000) {
    await refreshAntigravityToken(connection)
  }
}

// Auto-refresh: renova tokens Antigravity a cada 30min preventivamente
async function autoRefreshAllTokens() {
  try {
    const db = loadData()
    const oauthConnections = db.providerConnections.filter(
      c => c.enabled && c.refreshToken && c.expiresAt
    )
    for (const conn of oauthConnections) {
      const expiresMs = new Date(conn.expiresAt).getTime()
      if (expiresMs <= Date.now() + 600000) {
        try {
          if (conn.providerId === 'antigravity') {
            await refreshAntigravityToken(conn)
          } else if (conn.providerId === 'kiro-ai' && conn.providerSpecificData?.clientId) {
            await refreshKiroToken(conn)
          } else if (OAUTH_REFRESH_CONFIGS[conn.providerId]?.tokenUrl) {
            await refreshGenericOAuthToken(conn)
          }
        } catch (err) {
          console.error(`[KOGNIT] Auto-refresh ${conn.providerId} falhou:`, err.message)
        }
      }
    }
  } catch (err) {
    console.error('[KOGNIT] Auto-refresh falhou:', err.message)
  }
}

setInterval(autoRefreshAllTokens, 30 * 60 * 1000)
setTimeout(autoRefreshAllTokens, 5000)

function sanitizeGeminiFunctionName(name) {
  if (!name) return '_unknown'
  let s = name.replace(/[^a-zA-Z0-9_.:-]/g, '_')
  if (!/^[a-zA-Z_]/.test(s)) s = '_' + s
  return s.substring(0, 64)
}

const GEMINI_TOOL_CALL_CACHE_TTL_MS = 30 * 60 * 1000
const geminiToolCallCache = new Map()
const PROVIDER_HISTORY_CHAR_LIMIT = 140000
const PROVIDER_KEEP_FIRST_MESSAGES = 4
const PROVIDER_KEEP_RECENT_MESSAGES = 18
const PROVIDER_TEXT_PART_MAX_CHARS = 16000
const PROVIDER_TOOL_OUTPUT_MAX_CHARS = 8000
const PROVIDER_OLD_TOOL_OUTPUT_MAX_CHARS = 2500
const PROVIDER_SYSTEM_MAX_CHARS = 32000
const PROVIDER_COMPACTION_SUMMARY_MAX_CHARS = 16000

function cleanupGeminiToolCallCache() {
  const cutoff = Date.now() - GEMINI_TOOL_CALL_CACHE_TTL_MS
  for (const [id, item] of geminiToolCallCache.entries()) {
    if (!item?.createdAt || item.createdAt < cutoff) geminiToolCallCache.delete(id)
  }
}

function cloneGeminiFunctionCallPart(part) {
  if (!part?.functionCall) return null
  const cloned = {
    functionCall: {
      name: part.functionCall.name,
      args: part.functionCall.args || {},
    },
  }

  for (const key of ['thought', 'thoughtSignature', 'thought_signature']) {
    if (part[key] !== undefined) cloned[key] = part[key]
  }
  for (const key of ['thoughtSignature', 'thought_signature']) {
    if (part.functionCall[key] !== undefined) cloned.functionCall[key] = part.functionCall[key]
  }

  return cloned
}

function cacheGeminiFunctionCallPart(toolCallId, part) {
  const cloned = cloneGeminiFunctionCallPart(part)
  if (!toolCallId || !cloned) return
  cleanupGeminiToolCallCache()
  geminiToolCallCache.set(toolCallId, {
    createdAt: Date.now(),
    name: cloned.functionCall.name,
    part: cloned,
  })
}

function getCachedGeminiFunctionCall(toolCallId) {
  if (!toolCallId) return null
  const item = geminiToolCallCache.get(toolCallId)
  if (!item) return null
  if (Date.now() - item.createdAt > GEMINI_TOOL_CALL_CACHE_TTL_MS) {
    geminiToolCallCache.delete(toolCallId)
    return null
  }
  return {
    name: item.name,
    part: cloneGeminiFunctionCallPart(item.part),
  }
}

function truncateForProvider(text, maxChars, label = 'content') {
  const value = String(text || '')
  if (!maxChars || value.length <= maxChars) return value

  const marker = `\n\n[Kognit compacted ${value.length - maxChars} chars from ${label} to keep the provider request under the payload limit.]\n\n`
  const available = Math.max(0, maxChars - marker.length)
  const head = Math.ceil(available * 0.65)
  const tail = Math.max(0, available - head)
  return `${value.slice(0, head)}${marker}${tail > 0 ? value.slice(-tail) : ''}`
}

function contentToPlainText(content, options = {}) {
  const { maxChars = 0, label = 'content' } = options
  let text

  if (content === null || content === undefined) {
    text = ''
  } else if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content.map(part => {
      if (!part) return ''
      if (typeof part === 'string') return part
      if (part.type === 'text') return part.text || ''
      if (part.type === 'tool_result') return contentToPlainText(part.content, { label: 'tool result' })
      if (part.text) return part.text
      try {
        return JSON.stringify(part)
      } catch {
        return ''
      }
    }).filter(Boolean).join('\n')
  } else {
    try {
      text = JSON.stringify(content)
    } catch {
      text = String(content)
    }
  }

  return maxChars ? truncateForProvider(text, maxChars, label) : text
}

function estimateProviderTextLength(value) {
  return contentToPlainText(value).length
}

function messageTextLength(message) {
  if (!message || typeof message !== 'object') return 0
  let length = String(message.role || '').length + estimateProviderTextLength(message.content)
  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      length += estimateProviderTextLength(toolCall?.function?.name)
      length += estimateProviderTextLength(toolCall?.function?.arguments)
    }
  }
  return length
}

function compactMessageContent(message, maxChars, label) {
  if (!message || !Object.prototype.hasOwnProperty.call(message, 'content')) return message
  const text = contentToPlainText(message.content, { maxChars, label })
  return { ...message, content: text }
}

function compactToolOutputMessage(message, isRecent, protocol) {
  const maxChars = isRecent ? PROVIDER_TOOL_OUTPUT_MAX_CHARS : PROVIDER_OLD_TOOL_OUTPUT_MAX_CHARS
  if (protocol === 'anthropic' && Array.isArray(message?.content)) {
    return {
      ...message,
      content: message.content.map(block => {
        if (block?.type !== 'tool_result') return block
        return {
          ...block,
          content: contentToPlainText(block.content, {
            maxChars,
            label: `tool_result ${block.tool_use_id || ''}`.trim(),
          }),
        }
      }),
    }
  }
  return compactMessageContent(message, maxChars, `tool output ${message?.tool_call_id || message?.name || ''}`.trim())
}

function compactSingleProviderMessage(message, isRecent, protocol) {
  if (!message || typeof message !== 'object') return message
  if (message.role === 'tool') return compactToolOutputMessage(message, isRecent, protocol)
  if (protocol === 'anthropic' && Array.isArray(message.content) && message.content.some(block => block?.type === 'tool_result')) {
    return compactToolOutputMessage(message, isRecent, protocol)
  }
  if (protocol === 'anthropic' && Array.isArray(message.content) && message.content.some(block => block?.type === 'tool_use')) {
    const maxChars = isRecent ? PROVIDER_TEXT_PART_MAX_CHARS : Math.min(PROVIDER_TEXT_PART_MAX_CHARS, 8000)
    return {
      ...message,
      content: message.content.map(block => {
        if (block?.type !== 'text') return block
        return {
          ...block,
          text: truncateForProvider(block.text || '', maxChars, 'assistant text content'),
        }
      }),
    }
  }

  const maxChars = isRecent ? PROVIDER_TEXT_PART_MAX_CHARS : Math.min(PROVIDER_TEXT_PART_MAX_CHARS, 8000)
  return compactMessageContent(message, maxChars, `${message.role || 'message'} content`)
}

function summarizeCompactedMessage(message, index) {
  if (!message || typeof message !== 'object') return `${index + 1}. unknown message`
  const role = message.role || 'message'
  const toolNames = []
  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (toolCall?.function?.name) toolNames.push(toolCall.function.name)
    }
  }
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block?.type === 'tool_use' && block.name) toolNames.push(block.name)
      if (block?.type === 'tool_result' && block.tool_use_id) toolNames.push(`result:${block.tool_use_id}`)
    }
  }

  const text = truncateForProvider(contentToPlainText(message.content).replace(/\s+/g, ' ').trim(), 260, `${role} summary`)
  const suffix = toolNames.length > 0 ? ` tools=${toolNames.slice(0, 4).join(',')}` : ''
  return `${index + 1}. ${role}${suffix}${text ? `: ${text}` : ''}`
}

function compactMessagesForProvider(messages, protocol) {
  if (!Array.isArray(messages)) return messages

  const totalChars = messages.reduce((sum, message) => sum + messageTextLength(message), 0)
  const shouldDropMiddle = totalChars > PROVIDER_HISTORY_CHAR_LIMIT
  const keepFirst = Math.min(PROVIDER_KEEP_FIRST_MESSAGES, messages.length)
  const keepRecent = Math.min(PROVIDER_KEEP_RECENT_MESSAGES, Math.max(0, messages.length - keepFirst))

  if (!shouldDropMiddle) {
    const recentStart = Math.max(0, messages.length - keepRecent)
    return messages.map((message, index) => compactSingleProviderMessage(message, index >= recentStart, protocol))
  }

  const first = messages
    .slice(0, keepFirst)
    .map(message => compactSingleProviderMessage(message, false, protocol))
  const recent = messages
    .slice(messages.length - keepRecent)
    .map(message => compactSingleProviderMessage(message, true, protocol))
  const middle = messages.slice(keepFirst, messages.length - keepRecent)
  const summaryText = truncateForProvider(
    [
      `Kognit compacted ${middle.length} older messages because the provider rejected large long-task payloads.`,
      `Original estimated history size: ${totalChars} chars.`,
      'Compacted message index:',
      ...middle.map((message, index) => summarizeCompactedMessage(message, keepFirst + index)),
    ].join('\n'),
    PROVIDER_COMPACTION_SUMMARY_MAX_CHARS,
    'compacted history summary',
  )

  const summaryMessage = protocol === 'anthropic'
    ? { role: 'user', content: summaryText }
    : { role: 'user', content: summaryText }
  const ackMessage = protocol === 'anthropic'
    ? { role: 'assistant', content: 'Understood. I will continue using the compacted history and the recent tool results.' }
    : { role: 'assistant', content: 'Understood. I will continue using the compacted history and the recent tool results.' }

  return [...first, summaryMessage, ackMessage, ...recent]
}

function normalizeGeminiFunctionResponse(content) {
  const rawText = contentToPlainText(content)
  const text = truncateForProvider(rawText, PROVIDER_TOOL_OUTPUT_MAX_CHARS, 'tool function response')
  if (!text) return { result: '' }

  if (rawText.length <= PROVIDER_TOOL_OUTPUT_MAX_CHARS) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // Tool output is often plain text, so invalid JSON is expected here.
    }
  }

  return {
    result: text,
    ...(rawText.length > text.length ? { kognit_compacted: true, original_chars: rawText.length } : {}),
  }
}

function describeHistoricalToolCall(name, args) {
  return [
    `Previous assistant tool request: ${name || 'tool'}.`,
    `Arguments JSON: ${args || '{}'}`
  ].join('\n')
}

function openaiToolsToGemini(tools) {
  if (!tools || tools.length === 0) return null
  const declarations = tools.map(t => {
    const fn = t.function || t
    return {
      name: sanitizeGeminiFunctionName(fn.name),
      description: fn.description || `Tool: ${fn.name}`,
      parameters: fn.parameters || { type: 'object', properties: {}, required: [] },
    }
  })
  return [{ functionDeclarations: declarations }]
}

function openaiToGeminiMessages(messages) {
  const contents = []
  const toolNamesById = new Map()

  for (const m of messages) {
    if (m.role === 'system') {
      contents.push({ role: 'user', parts: [{ text: contentToPlainText(m.content) }] })
      contents.push({ role: 'model', parts: [{ text: 'Understood.' }] })
      continue
    }

    if (m.role === 'tool') {
      const cached = getCachedGeminiFunctionCall(m.tool_call_id)
      const name = cached?.name || m.name || toolNamesById.get(m.tool_call_id)
      if (cached && name) {
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name,
              response: normalizeGeminiFunctionResponse(m.content),
            },
          }],
        })
      } else {
        contents.push({
          role: 'user',
          parts: [{ text: `Tool output from ${name || m.tool_call_id || 'tool'}:\n${contentToPlainText(m.content)}` }]
        })
      }
      continue
    }

    if (m.role === 'assistant') {
      const parts = []
      const text = contentToPlainText(m.content)
      if (text) parts.push({ text })
      if (m.tool_calls && m.tool_calls.length > 0) {
        const fallbackToolText = []
        for (const tc of m.tool_calls) {
          const fn = tc.function || {}
          const cached = getCachedGeminiFunctionCall(tc.id)
          if (tc.id && fn.name) toolNamesById.set(tc.id, fn.name)
          if (cached?.part) {
            parts.push(cached.part)
          } else {
            fallbackToolText.push(describeHistoricalToolCall(fn.name, fn.arguments || '{}'))
          }
        }
        if (fallbackToolText.length > 0) parts.push({ text: fallbackToolText.join('\n\n') })
      }
      if (parts.length > 0) contents.push({ role: 'model', parts })
      continue
    }

    if (m.role === 'function') {
      contents.push({
        role: 'user',
        parts: [{ text: `Function output from ${m.name || 'function'}:\n${contentToPlainText(m.content)}` }],
      })
      continue
    }

    // user
    const parts = []
    if (typeof m.content === 'string') {
      parts.push({ text: m.content })
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === 'text') parts.push({ text: part.text })
      }
    } else if (m.content !== null && m.content !== undefined) {
      parts.push({ text: contentToPlainText(m.content) })
    }
    if (parts.length > 0) contents.push({ role: 'user', parts })
  }
  return contents
}

function geminiToOpenaiResponse(geminiRes, model, requestId) {
  const candidate = geminiRes.response?.candidates?.[0]
  const parts = candidate?.content?.parts || []
  const textParts = parts.filter(p => p.text).map(p => p.text)
  const text = textParts.join('')
  const functionCalls = parts.filter(p => p.functionCall)
  const usage = geminiRes.response?.usageMetadata || {}

  const message = { role: 'assistant', content: text || null }
  if (functionCalls.length > 0) {
    message.tool_calls = functionCalls.map((fc) => {
      const toolCallId = 'call_' + uuidv4().slice(0, 8)
      cacheGeminiFunctionCallPart(toolCallId, fc)
      return {
        id: toolCallId,
        type: 'function',
        function: {
          name: fc.functionCall.name,
          arguments: JSON.stringify(fc.functionCall.args || {}),
        },
      }
    })
    if (!text) message.content = null
  }

  return {
    id: requestId || 'chatcmpl-' + uuidv4().slice(0, 8),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      message,
      finish_reason: functionCalls.length > 0 ? 'tool_calls' : candidate?.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',
    }],
    usage: {
      prompt_tokens: usage.promptTokenCount || 0,
      completion_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
    },
  }
}

app.get(['/v1/models', '/models', '/v1/v1/models'], (req, res) => {
  const seen = new Map()
  const addModel = (id, ownedBy) => {
    const modelId = String(id || '').trim()
    if (!modelId || seen.has(modelId)) return
    seen.set(modelId, {
      id: modelId,
      object: 'model',
      created: 1700000000,
      owned_by: ownedBy || resolveModelProvider(modelId).id,
    })
  }

  for (const [providerId, aliases] of Object.entries(MODEL_UPSTREAM_ALIASES)) {
    for (const id of Object.keys(aliases || {})) addModel(id, providerId)
  }

  for (const group of buildCliModelOptionGroups()) {
    for (const model of group.models || []) {
      if (!model.disabled) addModel(model.id, group.providerId)
    }
  }

  try {
    const db = loadData()
    for (const connection of db.providerConnections.filter(item => item.enabled)) {
      addModel(connection.defaultModel, connection.providerId)
    }
  } catch {
    // Keep /v1/models available even if the local data file has a transient issue.
  }

  res.json({ object: 'list', data: [...seen.values()] })
})

app.post(['/v1/chat/completions', '/chat/completions', '/v1/v1/chat/completions'], async (req, res) => {
  const startedAt = Date.now()
  const route = req.path
  let requestedModel = req.body?.model || 'ag/gemini-3-flash'
  let upstreamModel = ''
  let provider = resolveModelProvider(requestedModel)

  try {
    const { model, messages, max_tokens, temperature } = req.body
    requestedModel = model || 'ag/gemini-3-flash'
    provider = resolveModelProvider(requestedModel)

    if (!messages || !Array.isArray(messages)) {
      recordUsageEvent({
        route,
        providerId: provider.id,
        providerName: provider.name,
        model: requestedModel,
        ok: false,
        statusCode: 400,
        latencyMs: Date.now() - startedAt,
        errorType: 'invalid_request_error',
        error: 'messages is required',
      })
      return res.status(400).json({ error: { message: 'messages is required', type: 'invalid_request_error' } })
    }

    upstreamModel = resolveUpstreamModel(provider.id, requestedModel, null)
    if (provider.id !== 'antigravity') {
      return await proxyOpenAICompatibleChat({
        req,
        res,
        route,
        startedAt,
        providerId: provider.id,
        providerName: provider.name,
        requestedModel,
        upstreamModel,
      })
    }

    const { connection, error } = selectProviderConnection('antigravity')
    if (error) {
      recordUsageEvent({
        route,
        providerId: 'antigravity',
        providerName: 'Antigravity',
        model: requestedModel,
        upstreamModel,
        ok: false,
        statusCode: 503,
        latencyMs: Date.now() - startedAt,
        errorType: 'service_unavailable',
        error,
      })
      return res.status(503).json({ error: { message: error, type: 'service_unavailable' } })
    }

    await ensureAntigravityToken(connection)
    const projectId = await ensureAntigravityProject(connection)

    const compactedMessages = compactMessagesForProvider(messages, 'openai')
    const contents = openaiToGeminiMessages(compactedMessages)
    const sessionId = uuidv4() + Date.now().toString()
    const wantStream = req.body.stream === true
    const geminiTools = openaiToolsToGemini(req.body.tools)

    const body = {
      project: projectId,
      model: upstreamModel,
      userAgent: 'antigravity',
      requestType: 'agent',
      requestId: 'agent-' + uuidv4(),
      request: {
        contents,
        generationConfig: {
          maxOutputTokens: max_tokens || 16384,
          ...(temperature !== undefined && { temperature }),
        },
        sessionId,
        ...(geminiTools && { tools: geminiTools }),
        ...(geminiTools && { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } }),
      },
    }

    const endpoint = wantStream ? ANTIGRAVITY_STREAM_ENDPOINT : ANTIGRAVITY_ENDPOINT
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${connection.accessToken}`,
        'User-Agent': 'antigravity/1.107.0 win32/x64',
        'x-request-source': 'local',
        'X-Machine-Session-Id': sessionId,
        'Accept': wantStream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      const errorMessage = sanitizeErrorMessage(errText)
      recordUsageEvent({
        route,
        providerId: 'antigravity',
        providerName: 'Antigravity',
        model: requestedModel,
        upstreamModel,
        ok: false,
        statusCode: response.status,
        latencyMs: Date.now() - startedAt,
        errorType: 'upstream_error',
        error: errorMessage,
      })
      return res.status(response.status).json({
        error: { message: errorMessage, type: 'upstream_error' },
      })
    }

    if (wantStream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const responseId = 'chatcmpl-' + uuidv4().slice(0, 8)
      const created = Math.floor(Date.now() / 1000)
      let chunkIndex = 0
      let fullText = ''
      let hasToolCalls = false

      const text = await response.text()
      const lines = text.split(/\r?\n/)

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === '[DONE]') continue

        try {
          const parsed = JSON.parse(jsonStr)
          const candidate = parsed.response?.candidates?.[0] || parsed.candidates?.[0]
          const parts = candidate?.content?.parts || []
          const partText = parts.filter(p => p.text).map(p => p.text).join('')
          const functionCalls = parts.filter(p => p.functionCall)

          if (partText) {
            fullText += partText
            const sseChunk = {
              id: responseId,
              object: 'chat.completion.chunk',
              created,
              model: requestedModel,
              choices: [{
                index: 0,
                delta: chunkIndex === 0 ? { role: 'assistant', content: partText } : { content: partText },
                finish_reason: null,
              }],
            }
            res.write(`data: ${JSON.stringify(sseChunk)}\n\n`)
            chunkIndex++
          }

          if (functionCalls.length > 0) {
            hasToolCalls = true
            for (let i = 0; i < functionCalls.length; i++) {
              const fcPart = functionCalls[i]
              const fc = fcPart.functionCall
              const toolCallId = 'call_' + uuidv4().slice(0, 8)
              cacheGeminiFunctionCallPart(toolCallId, fcPart)
              const toolChunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model: requestedModel,
                choices: [{
                  index: 0,
                  delta: {
                    ...(chunkIndex === 0 ? { role: 'assistant' } : {}),
                    tool_calls: [{
                      index: i,
                      id: toolCallId,
                      type: 'function',
                      function: { name: fc.name, arguments: JSON.stringify(fc.args || {}) },
                    }],
                  },
                  finish_reason: null,
                }],
              }
              res.write(`data: ${JSON.stringify(toolChunk)}\n\n`)
              chunkIndex++
            }
          }

          const finishReason = candidate?.finishReason
          if (finishReason) {
            const fr = hasToolCalls ? 'tool_calls' : finishReason === 'MAX_TOKENS' ? 'length' : 'stop'
            const finishChunk = {
              id: responseId,
              object: 'chat.completion.chunk',
              created,
              model: requestedModel,
              choices: [{ index: 0, delta: {}, finish_reason: fr }],
            }
            res.write(`data: ${JSON.stringify(finishChunk)}\n\n`)
          }
        } catch {
          // Ignore malformed upstream SSE chunks.
        }
      }

      res.write('data: [DONE]\n\n')
      res.end()
      recordUsageEvent({
        route,
        providerId: 'antigravity',
        providerName: 'Antigravity',
        model: requestedModel,
        upstreamModel,
        ok: true,
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
        tokens: { prompt_tokens: 0, completion_tokens: Math.ceil(fullText.length / 4), total_tokens: 0 },
      })
    } else {
      const geminiRes = await response.json()
      const openaiRes = geminiToOpenaiResponse(geminiRes, requestedModel, null)
      recordUsageEvent({
        route,
        providerId: 'antigravity',
        providerName: 'Antigravity',
        model: requestedModel,
        upstreamModel,
        ok: true,
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
        tokens: openaiRes.usage,
      })
      res.json(openaiRes)
    }
  } catch (err) {
    const statusCode = err.statusCode || 500
    recordUsageEvent({
      route,
      providerId: provider.id,
      providerName: provider.name,
      model: requestedModel,
      upstreamModel,
      ok: false,
      statusCode,
      latencyMs: Date.now() - startedAt,
      errorType: err.code || 'internal_error',
      error: err.message,
    })
    res.status(statusCode).json({
      error: { message: sanitizeErrorMessage(err.message), type: err.code || 'internal_error' },
    })
  }
})

// --- V1 ANTHROPIC-COMPATIBLE PROXY (/v1/messages) ---

function anthropicToGeminiMessages(messages, system) {
  const contents = []
  const toolNamesById = new Map()
  if (system) {
    contents.push({ role: 'user', parts: [{ text: system }] })
    contents.push({ role: 'model', parts: [{ text: 'Understood.' }] })
  }
  for (const m of messages) {
    if (m.role === 'assistant') {
      const parts = []
      if (typeof m.content === 'string') {
        if (m.content) parts.push({ text: m.content })
      } else if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === 'text' && block.text) parts.push({ text: block.text })
          if (block.type === 'tool_use') {
            if (block.id && block.name) toolNamesById.set(block.id, block.name)
            const cached = getCachedGeminiFunctionCall(block.id)
            if (cached?.part) {
              parts.push(cached.part)
            } else {
              parts.push({ text: describeHistoricalToolCall(block.name, JSON.stringify(block.input || {})) })
            }
          }
        }
      }
      if (parts.length > 0) contents.push({ role: 'model', parts })
    } else {
      const parts = []
      if (typeof m.content === 'string') {
        parts.push({ text: m.content })
      } else if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === 'text' && block.text) parts.push({ text: block.text })
          if (block.type === 'tool_result') {
            const cached = getCachedGeminiFunctionCall(block.tool_use_id)
            const name = cached?.name || toolNamesById.get(block.tool_use_id)
            if (cached && name) {
              parts.push({
                functionResponse: {
                  name,
                  response: normalizeGeminiFunctionResponse(block.content),
                },
              })
            } else {
              parts.push({ text: `Tool output from ${name || block.tool_use_id || 'tool'}:\n${contentToPlainText(block.content)}` })
            }
          }
        }
      }
      if (parts.length > 0) contents.push({ role: 'user', parts })
    }
  }
  return contents
}

function geminiToAnthropicResponse(geminiRes, model, inputTokens) {
  const candidate = geminiRes.response?.candidates?.[0]
  const parts = candidate?.content?.parts || []
  const usage = geminiRes.response?.usageMetadata || {}

  const content = []
  const functionCalls = parts.filter(p => p.functionCall)
  const textParts = parts.filter(p => p.text).map(p => p.text)
  const text = textParts.join('')

  if (text) content.push({ type: 'text', text })
  for (const fc of functionCalls) {
    const toolUseId = 'toolu_' + uuidv4().slice(0, 8)
    cacheGeminiFunctionCallPart(toolUseId, fc)
    content.push({ type: 'tool_use', id: toolUseId, name: fc.functionCall.name, input: fc.functionCall.args || {} })
  }

  const stopReason = functionCalls.length > 0 ? 'tool_use' : candidate?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn'

  return {
    id: 'msg_' + uuidv4().replace(/-/g, '').slice(0, 24),
    type: 'message',
    role: 'assistant',
    model: model,
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage.promptTokenCount || inputTokens || 0,
      output_tokens: usage.candidatesTokenCount || 0,
    },
  }
}

function writeAnthropicStreamMessage(res, message) {
  const content = Array.isArray(message.content) && message.content.length > 0
    ? message.content
    : [{ type: 'text', text: '' }]

  res.write(`event: message_start\ndata: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: message.id,
      type: 'message',
      role: 'assistant',
      model: message.model,
      content: [],
      stop_reason: null,
      usage: { input_tokens: message.usage?.input_tokens || 0, output_tokens: 0 },
    },
  })}\n\n`)

  for (let index = 0; index < content.length; index++) {
    const block = content[index]
    if (block.type === 'tool_use') {
      res.write(`event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      })}\n\n`)
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input || {}) },
      })}\n\n`)
    } else {
      res.write(`event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      })}\n\n`)
      if (block.text) {
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: block.text },
        })}\n\n`)
      }
    }
    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index })}\n\n`)
  }

  res.write(`event: message_delta\ndata: ${JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: message.stop_reason || 'end_turn', stop_sequence: null },
    usage: { output_tokens: message.usage?.output_tokens || 0 },
  })}\n\n`)
  res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
  res.end()
}

function anthropicContentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => {
    if (!block) return ''
    if (typeof block === 'string') return block
    if (block.type === 'text') return block.text || ''
    if (block.type === 'tool_result') {
      if (typeof block.content === 'string') return block.content
      if (Array.isArray(block.content)) return block.content.map(item => item?.text || '').filter(Boolean).join('\n')
      return ''
    }
    if (block.type === 'image') return '[image]'
    return ''
  }).filter(Boolean).join('\n')
}

function anthropicSystemToText(system) {
  if (typeof system === 'string') return system
  if (!Array.isArray(system)) return ''
  return system.map(block => block?.text || '').filter(Boolean).join('\n')
}

function anthropicMessagesToOpenaiMessages(messages, system) {
  const converted = []
  const systemText = anthropicSystemToText(system)
  if (systemText) converted.push({ role: 'system', content: systemText })

  for (const message of messages || []) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user'
    converted.push({
      role,
      content: anthropicContentToText(message?.content),
    })
  }

  return converted
}

function openaiCompatibleResponseToAnthropic(data, model) {
  const choice = data?.choices?.[0] || {}
  const message = choice.message || {}
  const content = []
  const text = anthropicContentToText(message.content ?? message.reasoning ?? message.reasoning_content ?? choice.text ?? '')

  if (text) content.push({ type: 'text', text })

  for (const toolCall of message.tool_calls || []) {
    if (toolCall.type !== 'function') continue
    let input
    try {
      input = JSON.parse(toolCall.function?.arguments || '{}')
    } catch {
      input = {}
    }
    content.push({
      type: 'tool_use',
      id: toolCall.id || `toolu_${uuidv4().slice(0, 8)}`,
      name: toolCall.function?.name || 'tool',
      input,
    })
  }

  const finishReason = choice.finish_reason
  const stopReason = finishReason === 'length'
    ? 'max_tokens'
    : finishReason === 'tool_calls'
      ? 'tool_use'
      : 'end_turn'

  return {
    id: 'msg_' + uuidv4().replace(/-/g, '').slice(0, 24),
    type: 'message',
    role: 'assistant',
    model,
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: data?.usage?.prompt_tokens || 0,
      output_tokens: data?.usage?.completion_tokens || 0,
    },
  }
}

async function proxyAnthropicCompatibleViaOpenAI({
  req,
  res,
  route,
  startedAt,
  providerId,
  providerName,
  requestedModel,
  upstreamModel,
}) {
  const selected = selectProviderConnection(providerId)
  if (selected.error) {
    recordUsageEvent({
      route,
      providerId,
      providerName,
      model: requestedModel,
      upstreamModel,
      ok: false,
      statusCode: 503,
      latencyMs: Date.now() - startedAt,
      errorType: 'service_unavailable',
      error: selected.error,
    })
    return res.status(503).json({
      type: 'error',
      error: { type: 'api_error', message: selected.error },
    })
  }

  const { db, connection, transient } = selected

  try {
    await ensureModelCredential(connection)
    const target = openAICompatibleTarget(providerId, connection)
    if (!target) {
      throw new Error(`O provider ${providerName} ainda nao possui proxy OpenAI-compatible no Kognit.`)
    }

    if (!transient) saveData(db)
    const authHeader = target.authHeader === false ? null : (target.authHeader || 'Authorization')
    const authValue = target.token && authHeader
      ? { [authHeader]: target.bearer === false ? target.token : `Bearer ${target.token}` }
      : {}

    const response = await fetchWithTimeout(target.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...authValue,
        ...target.headers,
      },
      body: JSON.stringify({
        model: upstreamModel,
        messages: anthropicMessagesToOpenaiMessages(req.body.messages, req.body.system),
        max_tokens: req.body.max_tokens || 16384,
        ...(req.body.temperature !== undefined && { temperature: req.body.temperature }),
        stream: false,
      }),
    }, target.timeoutMs || MODEL_TEST_TIMEOUT_MS)

    if (!response.ok) {
      const errorMessage = sanitizeErrorMessage(await response.text().catch(() => ''))
      recordUsageEvent({
        route,
        providerId,
        providerName: connection.providerName || providerName,
        model: requestedModel,
        upstreamModel,
        ok: false,
        statusCode: response.status,
        latencyMs: Date.now() - startedAt,
        errorType: 'upstream_error',
        error: errorMessage,
      })
      return res.status(response.status).json({
        type: 'error',
        error: { type: 'api_error', message: errorMessage },
      })
    }

    const data = await response.json()
    const anthropicRes = openaiCompatibleResponseToAnthropic(data, requestedModel)
    recordUsageEvent({
      route,
      providerId,
      providerName: connection.providerName || providerName,
      model: requestedModel,
      upstreamModel,
      ok: true,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
      tokens: anthropicRes.usage,
    })

    if (req.body.stream === true) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      return writeAnthropicStreamMessage(res, anthropicRes)
    }

    return res.json(anthropicRes)
  } catch (err) {
    const statusCode = err.statusCode || 500
    const errorMessage = sanitizeErrorMessage(err.message)
    recordUsageEvent({
      route,
      providerId,
      providerName,
      model: requestedModel,
      upstreamModel,
      ok: false,
      statusCode,
      latencyMs: Date.now() - startedAt,
      errorType: err.code || 'api_error',
      error: errorMessage,
    })
    return res.status(statusCode).json({
      type: 'error',
      error: { type: err.code || 'api_error', message: errorMessage },
    })
  }
}

app.post(['/v1/messages', '/messages', '/v1/v1/messages'], async (req, res) => {
  const startedAt = Date.now()
  const route = req.path
  let requestedModel = req.body?.model || 'ag/claude-sonnet-4-6'
  let upstreamModel = ''

  try {
    const { model, messages, system, max_tokens, temperature } = req.body
    requestedModel = model || 'ag/claude-sonnet-4-6'
    const provider = resolveModelProvider(requestedModel)

    if (!messages || !Array.isArray(messages)) {
      recordUsageEvent({
        route,
        providerId: provider.id,
        providerName: provider.name,
        model: requestedModel,
        ok: false,
        statusCode: 400,
        latencyMs: Date.now() - startedAt,
        errorType: 'invalid_request_error',
        error: 'messages is required',
      })
      return res.status(400).json({ type: 'error', error: { type: 'invalid_request_error', message: 'messages is required' } })
    }

    upstreamModel = resolveUpstreamModel(provider.id, requestedModel, null)
    if (provider.id !== 'antigravity') {
      return await proxyAnthropicCompatibleViaOpenAI({
        req,
        res,
        route,
        startedAt,
        providerId: provider.id,
        providerName: provider.name,
        requestedModel,
        upstreamModel,
      })
    }

    const { connection, error } = selectProviderConnection('antigravity')
    if (error) {
      recordUsageEvent({
        route,
        providerId: 'antigravity',
        providerName: 'Antigravity',
        model: requestedModel,
        upstreamModel,
        ok: false,
        statusCode: 503,
        latencyMs: Date.now() - startedAt,
        errorType: 'api_error',
        error,
      })
      return res.status(503).json({ type: 'error', error: { type: 'api_error', message: error } })
    }

    await ensureAntigravityToken(connection)
    const projectId = await ensureAntigravityProject(connection)

    const systemText = truncateForProvider(
      typeof system === 'string' ? system : Array.isArray(system) ? system.map(s => s.text || '').join('\n') : '',
      PROVIDER_SYSTEM_MAX_CHARS,
      'system prompt',
    )
    const compactedMessages = compactMessagesForProvider(messages, 'anthropic')
    const contents = anthropicToGeminiMessages(compactedMessages, systemText)
    const sessionId = uuidv4() + Date.now().toString()
    const wantStream = req.body.stream === true
    const anthropicTools = req.body.tools
    const geminiTools = anthropicTools && anthropicTools.length > 0
      ? [{ functionDeclarations: anthropicTools.map(t => ({ name: sanitizeGeminiFunctionName(t.name), description: t.description || `Tool: ${t.name}`, parameters: t.input_schema || { type: 'object', properties: {}, required: [] } })) }]
      : null
    const useUpstreamStream = wantStream && !geminiTools

    const body = {
      project: projectId,
      model: upstreamModel,
      userAgent: 'antigravity',
      requestType: 'agent',
      requestId: 'agent-' + uuidv4(),
      request: {
        contents,
        generationConfig: {
          maxOutputTokens: max_tokens || 16384,
          ...(temperature !== undefined && { temperature }),
        },
        sessionId,
        ...(geminiTools && { tools: geminiTools }),
        ...(geminiTools && { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } }),
      },
    }

    const endpoint = useUpstreamStream ? ANTIGRAVITY_STREAM_ENDPOINT : ANTIGRAVITY_ENDPOINT
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${connection.accessToken}`,
        'User-Agent': 'antigravity/1.107.0 win32/x64',
        'x-request-source': 'local',
        'X-Machine-Session-Id': sessionId,
        'Accept': useUpstreamStream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      const errorMessage = sanitizeErrorMessage(errText)
      recordUsageEvent({
        route,
        providerId: 'antigravity',
        providerName: 'Antigravity',
        model: requestedModel,
        upstreamModel,
        ok: false,
        statusCode: response.status,
        latencyMs: Date.now() - startedAt,
        errorType: 'api_error',
        error: errorMessage,
      })
      return res.status(response.status).json({
        type: 'error',
        error: { type: 'api_error', message: errorMessage },
      })
    }

    if (wantStream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      if (!useUpstreamStream) {
        const geminiRes = await response.json()
        const anthropicRes = geminiToAnthropicResponse(geminiRes, requestedModel, 0)
        writeAnthropicStreamMessage(res, anthropicRes)
        recordUsageEvent({
          route,
          providerId: 'antigravity',
          providerName: 'Antigravity',
          model: requestedModel,
          upstreamModel,
          ok: true,
          statusCode: 200,
          latencyMs: Date.now() - startedAt,
          tokens: anthropicRes.usage,
        })
        return
      }

      const msgId = 'msg_' + uuidv4().replace(/-/g, '').slice(0, 24)
      let fullText = ''

      // Send message_start
      res.write(`event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: { id: msgId, type: 'message', role: 'assistant', model: requestedModel, content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } }
      })}\n\n`)

      // Send content_block_start
      res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`)

      const text = await response.text()
      const lines = text.split(/\r?\n/)
      const streamedFunctionCalls = []
      const streamedFunctionCallKeys = new Set()

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === '[DONE]') continue

        try {
          const parsed = JSON.parse(jsonStr)
          const candidate = parsed.response?.candidates?.[0] || parsed.candidates?.[0]
          const parts = candidate?.content?.parts || []
          const partText = parts.map(p => p.text).filter(Boolean).join('')
          const functionCalls = parts.filter(p => p.functionCall)
          if (partText) {
            fullText += partText
            res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: partText } })}\n\n`)
          }
          for (const fc of functionCalls) {
            const key = `${fc.functionCall.name}:${JSON.stringify(fc.functionCall.args || {})}`
            if (streamedFunctionCallKeys.has(key)) continue
            streamedFunctionCallKeys.add(key)
            streamedFunctionCalls.push(fc)
          }
        } catch {
          // Ignore malformed upstream SSE chunks.
        }
      }

      // Send content_block_stop
      res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`)

      for (let i = 0; i < streamedFunctionCalls.length; i++) {
        const fc = streamedFunctionCalls[i]
        const toolUseId = 'toolu_' + uuidv4().slice(0, 8)
        const index = i + 1
        cacheGeminiFunctionCallPart(toolUseId, fc)
        res.write(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: toolUseId, name: fc.functionCall.name, input: {} },
        })}\n\n`)
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(fc.functionCall.args || {}) },
        })}\n\n`)
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index })}\n\n`)
      }

      // Send message_delta
      res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: streamedFunctionCalls.length > 0 ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: Math.ceil(fullText.length / 4) } })}\n\n`)

      // Send message_stop
      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
      res.end()

      recordUsageEvent({
        route,
        providerId: 'antigravity',
        providerName: 'Antigravity',
        model: requestedModel,
        upstreamModel,
        ok: true,
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
        tokens: { input_tokens: 0, output_tokens: Math.ceil(fullText.length / 4) },
      })
    } else {
      const geminiRes = await response.json()
      const anthropicRes = geminiToAnthropicResponse(geminiRes, requestedModel, 0)
      recordUsageEvent({
        route,
        providerId: 'antigravity',
        providerName: 'Antigravity',
        model: requestedModel,
        upstreamModel,
        ok: true,
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
        tokens: anthropicRes.usage,
      })
      res.json(anthropicRes)
    }
  } catch (err) {
    const statusCode = err.statusCode || 500
    recordUsageEvent({
      route,
      providerId: 'antigravity',
      providerName: 'Antigravity',
      model: requestedModel,
      upstreamModel,
      ok: false,
      statusCode,
      latencyMs: Date.now() - startedAt,
      errorType: err.code || 'api_error',
      error: err.message,
    })
    res.status(statusCode).json({
      type: 'error',
      error: { type: err.code || 'api_error', message: sanitizeErrorMessage(err.message) },
    })
  }
})

// --- QUOTA TRACKER ---

function parseResetTime(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof value === 'number') {
    return new Date(value > 1e12 ? value : value * 1000).toISOString()
  }
  return null
}

async function getAntigravityQuota(connection) {
  await ensureAntigravityToken(connection)
  const res = await fetch('https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${connection.accessToken}`,
      'User-Agent': 'antigravity/1.107.0 win32/x64',
      'Content-Type': 'application/json',
      'X-Client-Name': 'antigravity',
      'X-Client-Version': '1.107.0',
      'x-request-source': 'local',
    },
    body: JSON.stringify({ project: connection.projectId || '' }),
  })
  if (!res.ok) throw new Error(`Antigravity quota API: ${res.status}`)
  const data = await res.json()
  const quotaEntries = []
  if (data.models) {
    for (const [modelKey, info] of Object.entries(data.models)) {
      if (!info.quotaInfo) continue
      if (/^(chat_|tab_)/i.test(modelKey)) continue
      const remainingFraction = info.quotaInfo.remainingFraction || 0
      const total = 1000
      const remaining = Math.round(total * remainingFraction)
      quotaEntries.push({
        modelKey,
        used: total - remaining,
        total,
        resetAt: parseResetTime(info.quotaInfo.resetTime),
        remainingPercentage: remainingFraction * 100,
        displayName: info.displayName || modelKey,
      })
    }
  }

  const deduped = new Map()
  for (const quota of quotaEntries) {
    const identity = quota.displayName.trim().toLowerCase()
    const current = deduped.get(identity)
    if (!current) {
      deduped.set(identity, quota)
      continue
    }

    deduped.set(identity, {
      ...current,
      used: Math.max(current.used, quota.used),
      total: Math.max(current.total, quota.total),
      remainingPercentage: Math.min(current.remainingPercentage, quota.remainingPercentage),
      resetAt: current.resetAt || quota.resetAt,
    })
  }

  const quotas = Object.fromEntries(
    [...deduped.values()]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map(({ modelKey, ...quota }) => [modelKey, quota]),
  )
  return { plan: 'Antigravity', quotas }
}

async function getKiroQuota(connection) {
  const psd = connection.providerSpecificData || {}
  let token = connection.accessToken
  if (psd.clientId && psd.clientSecret && connection.refreshToken) {
    const rr = await fetch('https://oidc.us-east-1.amazonaws.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ clientId: psd.clientId, clientSecret: psd.clientSecret, refreshToken: connection.refreshToken, grantType: 'refresh_token' }),
    })
    if (rr.ok) {
      const rd = await rr.json()
      token = rd.accessToken || token
    }
  }

  const params = new URLSearchParams({ isEmailRequired: 'true', origin: 'AI_EDITOR', resourceType: 'AGENTIC_REQUEST' })
  const attempts = [
    () => fetch(`https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits?${params}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'user-agent': 'aws-sdk-js/1.0.0 KiroIDE' },
    }),
    () => fetch('https://codewhisperer.us-east-1.amazonaws.com', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/x-amz-json-1.0', 'x-amz-target': 'AmazonCodeWhispererService.GetUsageLimits', 'Accept': 'application/json' },
      body: JSON.stringify({ origin: 'AI_EDITOR', resourceType: 'AGENTIC_REQUEST' }),
    }),
    () => fetch(`https://q.us-east-1.amazonaws.com/getUsageLimits?${params}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    }),
  ]

  for (const attempt of attempts) {
    try {
      const res = await attempt()
      if (res.ok) {
        const data = await res.json()
        const quotas = {}
        const resetAt = parseResetTime(data.nextDateReset || data.resetDate)
        const usageList = data.usageBreakdownList || []
        for (const item of usageList) {
          const key = (item.resourceType || 'unknown').toLowerCase()
          quotas[key] = {
            used: item.currentUsageWithPrecision || 0,
            total: item.usageLimitWithPrecision || 0,
            remaining: (item.usageLimitWithPrecision || 0) - (item.currentUsageWithPrecision || 0),
            resetAt,
          }
        }
        return { plan: data.subscriptionInfo?.subscriptionTitle || 'Kiro', quotas }
      }
    } catch {
      continue
    }
  }
  throw new Error('Kiro quota API indisponivel')
}

app.get('/api/usage/:connectionId', async (req, res) => {
  try {
    const db = loadData()
    const connection = db.providerConnections.find(c => c.id === req.params.connectionId)
    if (!connection) return res.status(404).json({ error: 'Conexao nao encontrada' })

    let result
    if (connection.providerId === 'antigravity') {
      result = await getAntigravityQuota(connection)
    } else if (connection.providerId === 'kiro-ai') {
      result = await getKiroQuota(connection)
    } else {
      return res.json({ plan: connection.providerName, quotas: {}, message: 'Quota tracking nao suportado para este provider' })
    }
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/usage', async (req, res) => {
  try {
    const db = loadData()
    const supported = db.providerConnections.filter(c => ['antigravity', 'kiro-ai'].includes(c.providerId) && c.enabled)
    const results = []
    for (const conn of supported) {
      try {
        let quota
        if (conn.providerId === 'antigravity') quota = await getAntigravityQuota(conn)
        else if (conn.providerId === 'kiro-ai') quota = await getKiroQuota(conn)
        results.push({ connectionId: conn.id, connectionName: conn.name, providerId: conn.providerId, ...quota })
      } catch (err) {
        results.push({ connectionId: conn.id, connectionName: conn.name, providerId: conn.providerId, error: err.message })
      }
    }
    res.json(results)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- CLI TOOLS DETECTION ---

const CODE_AGENT_TOOLS = [
  { id: 'claude-code', commands: ['claude'], providerIds: ['claude-code'] },
  { id: 'openclaw', commands: ['openclaw'], providerIds: [] },
  { id: 'codex', commands: ['codex'], providerIds: ['openai-codex'] },
  { id: 'opencode', commands: ['opencode'], providerIds: ['opencode-free'] },
  { id: 'cowork', commands: null },
  { id: 'hermes', commands: ['hermes'], providerIds: [] },
  { id: 'droid', commands: ['droid'], providerIds: [] },
  { id: 'cursor', commands: ['cursor'], providerIds: ['cursor-ide'] },
  { id: 'cline', commands: ['cline'], providerIds: ['cline'] },
  { id: 'kilo', commands: ['kilocode', 'kilo'], providerIds: ['kilo-code'] },
  { id: 'roo', commands: ['roo'] },
  { id: 'continue', commands: ['cn'] },
]

function checkCliInstalled(cmd, versionFlag = '--version') {
  return new Promise(resolve => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const child = spawn(cmd, [versionFlag], {
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    function finish(installed) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const output = (stdout || stderr || '').trim()
      const version = output.match(/[\d]+\.[\d]+[\d.]*/)?.[0] || ''
      resolve({ installed, version })
    }

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', () => finish(false))
    child.on('exit', code => finish(code === 0 || !!stdout.trim()))

    const timeout = setTimeout(() => {
      child.kill()
      finish(!!stdout.trim())
    }, 5000)
  })
}

async function detectCodeAgent(tool) {
  if (!tool.commands) {
    return { installed: null, version: '' }
  }

  for (const command of tool.commands) {
    const status = await checkCliInstalled(command)
    if (status.installed) {
      return { ...status, command }
    }
  }

  return { installed: false, version: '' }
}

function cliToolState(detected, config) {
  if (config.configured) return 'connected'
  if (config.otherConfiguration) return 'other'
  if (detected.installed === true) return 'not_configured'
  if (detected.installed === false) return 'not_installed'
  return 'unknown'
}

async function getCodeAgentStatuses() {
  const [detected, configs] = await Promise.all([
    Promise.all(CODE_AGENT_TOOLS.map(detectCodeAgent)),
    Promise.all(CODE_AGENT_TOOLS.map(tool => inspectCliToolConfig(tool.id))),
  ])
  const result = {}

  CODE_AGENT_TOOLS.forEach((tool, index) => {
    const detection = detected[index]
    const config = configs[index]
    const installed = detection.installed === true || config.configFileExists
      ? true
      : detection.installed
    result[tool.id] = {
      installed,
      version: detection.version || '',
      command: detection.command || tool.commands?.[0] || '',
      state: cliToolState({ ...detection, installed }, config),
      config,
    }
  })

  return result
}

app.get('/api/cli-tools/all-statuses', async (req, res) => {
  res.json(await getCodeAgentStatuses())
})

app.get('/api/cli-tools/status', async (req, res) => {
  res.json(await getCodeAgentStatuses())
})

app.get('/api/cli-tools/model-options', (req, res) => {
  res.json({ groups: buildCliModelOptionGroups() })
})

app.get('/api/cli-tools/:toolId', async (req, res) => {
  const tool = CODE_AGENT_TOOLS.find(item => item.id === req.params.toolId)
  if (!tool) {
    return res.status(404).json({ error: 'Coding agent not found' })
  }

  const statuses = await getCodeAgentStatuses()
  res.json(statuses[tool.id])
})

app.put('/api/cli-tools/:toolId', async (req, res) => {
  const tool = CODE_AGENT_TOOLS.find(item => item.id === req.params.toolId)
  if (!tool) {
    return res.status(404).json({ error: 'Coding agent not found' })
  }

  const baseUrl = String(req.body.baseUrl || '').trim().slice(0, 500)
  const model = String(req.body.model || '').trim().slice(0, 200)
  const apiKey = String(req.body.apiKey || '').trim().slice(0, 1000)
  if (!baseUrl || !model) {
    return res.status(400).json({ error: 'Base URL e modelo sao obrigatorios' })
  }

  try {
    new URL(baseUrl)
  } catch {
    return res.status(400).json({ error: 'Base URL invalida' })
  }

  try {
    const config = await applyCliToolConfig(tool.id, { baseUrl, model, apiKey })
    const db = loadData()
    delete db.cliToolSettings[tool.id]
    saveData(db)
    res.json({
      success: true,
      state: config.configured ? 'connected' : 'not_configured',
      config,
    })
  } catch (error) {
    const status = error.code === 'MANUAL_CONFIGURATION_REQUIRED' ? 409 : 500
    res.status(status).json({ error: sanitizeErrorMessage(error.message) })
  }
})

app.delete('/api/cli-tools/:toolId/configuration', async (req, res) => {
  const tool = CODE_AGENT_TOOLS.find(item => item.id === req.params.toolId)
  if (!tool) {
    return res.status(404).json({ error: 'Coding agent not found' })
  }

  try {
    const config = await removeCliToolConfig(tool.id)
    const db = loadData()
    delete db.cliToolSettings[tool.id]
    saveData(db)
    res.json({ success: true, config })
  } catch (error) {
    res.status(500).json({ error: sanitizeErrorMessage(error.message) })
  }
})

app.use((req, res, next) => {
  const apiLikeRoute =
    req.path === '/v1'
    || req.path.startsWith('/v1/')
    || req.path.startsWith('/api/')
    || ['/models', '/chat/completions', '/messages'].includes(req.path)

  if (!apiLikeRoute) return next()

  const message = `Rota API nao encontrada: ${req.method} ${req.path}. Use /v1/models, /v1/chat/completions ou /v1/messages.`
  if (req.path.endsWith('/messages')) {
    return res.status(404).json({
      type: 'error',
      error: { type: 'not_found_error', message },
    })
  }

  return res.status(404).json({
    error: { type: 'not_found_error', message },
  })
})

// --- SERVE FRONTEND ON THE SAME PORT ---
const distPath = path.join(ROOT, 'dist')
const serveDist = process.env.NODE_ENV === 'production' || process.env.KOGNIT_SERVE_DIST === '1'

if (serveDist) {
  if (!fs.existsSync(distPath)) {
    throw new Error('dist nao encontrado. Rode npm run build antes de iniciar em producao.')
  }
  app.use(express.static(distPath))
  app.use((req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
} else {
  try {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      root: ROOT,
      appType: 'spa',
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
    })
    app.use(vite.middlewares)
  } catch (error) {
    if (!fs.existsSync(distPath)) throw error
    console.warn(`Vite dev middleware unavailable, serving dist: ${error.message}`)
    app.use(express.static(distPath))
    app.use((req, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
  }
}

httpServer.listen(PORT, () => {
  console.log(`KOGNIT running on http://localhost:${PORT}`)
  // Sobe o proxy GLM 5.2 em background. Falhas nao derrubam o Kognit.
  try {
    startGlmProxy('boot')
  } catch (err) {
    console.warn(`[glm-proxy] nao foi possivel iniciar no boot: ${err.message}`)
  }
})

// Shutdown gracioso: mata o proxy antes de sair.
async function shutdownGlmProxy(signal) {
  if (glmProxyShuttingDown) return
  console.log(`[glm-proxy] encerrando (${signal})...`)
  const exitTimer = setTimeout(() => process.exit(0), 10000)
  exitTimer.unref()
  await stopGlmProxy()
  httpServer.close(() => process.exit(0))
}
process.on('SIGTERM', () => shutdownGlmProxy('SIGTERM'))
process.on('SIGINT', () => shutdownGlmProxy('SIGINT'))
