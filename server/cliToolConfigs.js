import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const LOCAL_API_KEY = 'kognit-local-key'

function userHome() {
  return process.env.KOGNIT_USER_HOME || os.homedir()
}

function configuredPath(envName, fallback) {
  if (!process.env.KOGNIT_USER_HOME) {
    const configured = String(process.env[envName] || '').trim()
    if (configured) return path.resolve(configured)
  }
  return fallback
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value || '').trim().replace(/\/+$/, '')
  return baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`
}

function withoutV1(value) {
  return normalizeBaseUrl(value).replace(/\/v1$/, '')
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readText(filePath, fallback = '') {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
}

async function readJson(filePath, fallback = null) {
  const content = await readText(filePath, '')
  if (!content) return fallback
  try {
    return JSON.parse(content)
  } catch {
    return fallback
  }
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function removeFile(filePath) {
  try {
    await fs.unlink(filePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function writeMarker(filePath, baseUrl, model) {
  await writeJson(filePath, {
    managedBy: 'Kognit',
    baseUrl: normalizeBaseUrl(baseUrl),
    model,
    updatedAt: new Date().toISOString(),
  })
}

function effectiveApiKey(inputKey, currentKey) {
  return String(inputKey || '').trim() || currentKey || LOCAL_API_KEY
}

function upsertEnv(text, key, value) {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  if (pattern.test(text)) return text.replace(pattern, line)
  if (!text) return `${line}\n`
  return `${text.replace(/\s*$/, '')}\n${line}\n`
}

function removeEnv(text, key) {
  return text.replace(new RegExp(`^${key}=.*(?:\\r?\\n|$)`, 'm'), '')
}

function publicConfig(config) {
  return {
    baseUrl: config.baseUrl || '',
    model: config.model || '',
    configured: config.configured === true,
    hasApiKey: config.hasApiKey === true,
    configPath: config.configPath || null,
    extraPaths: config.extraPaths || [],
    directlyConfigurable: config.directlyConfigurable !== false,
    configFileExists: config.configFileExists === true,
    otherConfiguration: config.otherConfiguration === true,
    note: config.note || '',
    configError: config.configError || '',
  }
}

function claudePath() {
  const directory = configuredPath('CLAUDE_CONFIG_DIR', path.join(userHome(), '.claude'))
  return path.join(directory, 'settings.json')
}

function claudeMarkerPath() {
  const directory = configuredPath('CLAUDE_CONFIG_DIR', path.join(userHome(), '.claude'))
  return path.join(directory, '.kognit-managed.json')
}

const claudeAdapter = {
  async inspect() {
    const configPath = claudePath()
    const settings = await readJson(configPath, {})
    const env = settings?.env || {}
    const hasValues = !!(env.ANTHROPIC_BASE_URL && env.ANTHROPIC_MODEL)
    const managed = await exists(claudeMarkerPath())
    return publicConfig({
      configured: managed && hasValues,
      otherConfiguration: !managed && hasValues,
      baseUrl: env.ANTHROPIC_BASE_URL,
      model: env.ANTHROPIC_MODEL,
      hasApiKey: managed && !!env.ANTHROPIC_AUTH_TOKEN,
      configPath,
    })
  },
  async apply({ baseUrl, model, apiKey }) {
    const configPath = claudePath()
    const settings = await readJson(configPath, {})
    const managed = await exists(claudeMarkerPath())
    settings.hasCompletedOnboarding = true
    settings.env = {
      ...(settings.env || {}),
      ANTHROPIC_BASE_URL: normalizeBaseUrl(baseUrl),
      ANTHROPIC_AUTH_TOKEN: effectiveApiKey(apiKey, managed ? settings.env?.ANTHROPIC_AUTH_TOKEN : ''),
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    }
    await writeJson(configPath, settings)
    await writeMarker(claudeMarkerPath(), baseUrl, model)
    return this.inspect()
  },
  async remove() {
    if (!await exists(claudeMarkerPath())) return
    const configPath = claudePath()
    const settings = await readJson(configPath, null)
    if (!settings) return
    const keys = [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    ]
    for (const key of keys) delete settings.env?.[key]
    if (settings.env && Object.keys(settings.env).length === 0) delete settings.env
    await writeJson(configPath, settings)
    await removeFile(claudeMarkerPath())
  },
}

function openClawPath() {
  return path.join(userHome(), '.openclaw', 'openclaw.json')
}

const openClawAdapter = {
  async inspect() {
    const configPath = openClawPath()
    const settings = await readJson(configPath, {})
    const provider = settings?.models?.providers?.kognit
    const primary = settings?.agents?.defaults?.model?.primary || ''
    return publicConfig({
      configured: !!provider,
      baseUrl: provider?.baseUrl,
      model: primary.startsWith('kognit/') ? primary.slice(7) : provider?.models?.[0]?.id,
      hasApiKey: !!provider?.apiKey,
      configPath,
    })
  },
  async apply({ baseUrl, model, apiKey }) {
    const configPath = openClawPath()
    const settings = await readJson(configPath, {})
    settings.agents ||= {}
    settings.agents.defaults ||= {}
    settings.agents.defaults.model ||= {}
    settings.agents.defaults.models ||= {}
    settings.models ||= {}
    settings.models.providers ||= {}
    for (const key of Object.keys(settings.agents.defaults.models)) {
      if (key.startsWith('kognit/')) delete settings.agents.defaults.models[key]
    }
    const current = settings.models.providers.kognit || {}
    settings.agents.defaults.model.primary = `kognit/${model}`
    settings.agents.defaults.models[`kognit/${model}`] = {}
    settings.models.providers.kognit = {
      ...current,
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey: effectiveApiKey(apiKey, current.apiKey),
      api: 'openai-completions',
      models: [{ id: model, name: model.split('/').pop() || model }],
    }
    await writeJson(configPath, settings)
    return this.inspect()
  },
  async remove() {
    const configPath = openClawPath()
    const settings = await readJson(configPath, null)
    if (!settings) return
    delete settings.models?.providers?.kognit
    for (const key of Object.keys(settings.agents?.defaults?.models || {})) {
      if (key.startsWith('kognit/')) delete settings.agents.defaults.models[key]
    }
    if (settings.agents?.defaults?.model?.primary?.startsWith('kognit/')) {
      delete settings.agents.defaults.model.primary
    }
    await writeJson(configPath, settings)
  },
}

function codexPaths() {
  const directory = configuredPath('CODEX_HOME', path.join(userHome(), '.codex'))
  return {
    configPath: path.join(directory, 'config.toml'),
    authPath: path.join(directory, 'auth.json'),
  }
}

const codexAdapter = {
  async inspect() {
    const { configPath, authPath } = codexPaths()
    const configText = await readText(configPath, '')
    const config = configText ? parseToml(configText) : {}
    const auth = await readJson(authPath, {})
    const provider = config?.model_providers?.kognit
    return publicConfig({
      configured: config.model_provider === 'kognit' && !!provider,
      baseUrl: provider?.base_url,
      model: config.model_provider === 'kognit' ? config.model : '',
      hasApiKey: !!auth.OPENAI_API_KEY,
      configPath,
      extraPaths: [authPath],
    })
  },
  async apply({ baseUrl, model, apiKey }) {
    const { configPath, authPath } = codexPaths()
    const configText = await readText(configPath, '')
    const config = configText ? parseToml(configText) : {}
    config.model = model
    config.model_provider = 'kognit'
    config.model_providers ||= {}
    config.model_providers.kognit = {
      name: 'Kognit',
      base_url: normalizeBaseUrl(baseUrl),
      wire_api: 'chat',
    }
    await writeText(configPath, stringifyToml(config))
    const auth = await readJson(authPath, {})
    auth.OPENAI_API_KEY = effectiveApiKey(apiKey, auth.OPENAI_API_KEY)
    auth.auth_mode = 'apikey'
    await writeJson(authPath, auth)
    return this.inspect()
  },
  async remove() {
    const { configPath, authPath } = codexPaths()
    const configText = await readText(configPath, '')
    if (configText) {
      const config = parseToml(configText)
      if (config.model_provider === 'kognit') {
        delete config.model
        delete config.model_provider
      }
      delete config.model_providers?.kognit
      await writeText(configPath, stringifyToml(config))
    }
    const auth = await readJson(authPath, null)
    if (auth) {
      delete auth.OPENAI_API_KEY
      delete auth.auth_mode
      await writeJson(authPath, auth)
    }
  },
}

function openCodePath() {
  if (!process.env.KOGNIT_USER_HOME) {
    const configPath = String(process.env.OPENCODE_CONFIG || '').trim()
    if (configPath) return path.resolve(configPath)

    const configDirectory = String(process.env.OPENCODE_CONFIG_DIR || '').trim()
    if (configDirectory) return path.join(path.resolve(configDirectory), 'opencode.json')
  }
  return path.join(userHome(), '.config', 'opencode', 'opencode.json')
}

const openCodeAdapter = {
  async inspect() {
    const configPath = openCodePath()
    const config = await readJson(configPath, {})
    const provider = config?.provider?.kognit
    return publicConfig({
      configured: !!provider,
      baseUrl: provider?.options?.baseURL,
      model: config.model?.startsWith('kognit/') ? config.model.slice(7) : Object.keys(provider?.models || {})[0],
      hasApiKey: !!provider?.options?.apiKey,
      configPath,
    })
  },
  async apply({ baseUrl, model, apiKey }) {
    const configPath = openCodePath()
    const config = await readJson(configPath, {})
    config.provider ||= {}
    const current = config.provider.kognit || {}
    config.provider.kognit = {
      ...current,
      npm: '@ai-sdk/openai-compatible',
      name: 'Kognit',
      options: {
        ...(current.options || {}),
        baseURL: normalizeBaseUrl(baseUrl),
        apiKey: effectiveApiKey(apiKey, current.options?.apiKey),
      },
      models: {
        ...(current.models || {}),
        [model]: { name: model },
      },
    }
    config.model = `kognit/${model}`
    config.agent ||= {}
    config.agent.explorer = {
      ...(config.agent.explorer || {}),
      description: 'Fast explorer subagent for codebase exploration',
      mode: 'subagent',
      model: `kognit/${model}`,
    }
    await writeJson(configPath, config)
    return this.inspect()
  },
  async remove() {
    const configPath = openCodePath()
    const config = await readJson(configPath, null)
    if (!config) return
    delete config.provider?.kognit
    if (config.model?.startsWith('kognit/')) delete config.model
    if (config.agent?.explorer?.model?.startsWith('kognit/')) delete config.agent.explorer
    await writeJson(configPath, config)
  },
}

function platformDataRoot(appName) {
  const home = userHome()
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appName)
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', appName)
  }
  return path.join(home, '.config', appName)
}

function coworkRoots() {
  const home = userHome()
  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support')
    return [path.join(base, 'Claude-3p'), path.join(base, 'Claude')]
  }
  if (process.platform === 'win32') {
    return [
      path.join(home, 'AppData', 'Local', 'Claude-3p'),
      path.join(home, 'AppData', 'Roaming', 'Claude-3p'),
      path.join(home, 'AppData', 'Local', 'Claude'),
      path.join(home, 'AppData', 'Roaming', 'Claude'),
    ]
  }
  return [path.join(home, '.config', 'Claude-3p'), path.join(home, '.config', 'Claude')]
}

async function resolveCoworkRoot() {
  for (const root of coworkRoots()) {
    if (await exists(path.join(root, 'configLibrary'))) return root
  }
  return coworkRoots()[0]
}

async function coworkConfigPaths(create = false) {
  const root = create ? coworkRoots()[0] : await resolveCoworkRoot()
  const configDirectory = path.join(root, 'configLibrary')
  const metaPath = path.join(configDirectory, '_meta.json')
  let meta = await readJson(metaPath, null)
  if (!meta?.appliedId && create) {
    const appliedId = randomUUID()
    meta = { appliedId, entries: [{ id: appliedId, name: 'Default' }] }
    await writeJson(metaPath, meta)
  }
  return {
    configPath: meta?.appliedId ? path.join(configDirectory, `${meta.appliedId}.json`) : null,
    metaPath,
    markerPath: path.join(configDirectory, '.kognit-managed.json'),
  }
}

const coworkAdapter = {
  async inspect() {
    const { configPath, metaPath, markerPath } = await coworkConfigPaths(false)
    const config = configPath ? await readJson(configPath, {}) : {}
    const firstModel = config?.inferenceModels?.[0]
    const hasValues = config.inferenceProvider === 'gateway' && !!config.inferenceGatewayBaseUrl
    const managed = await exists(markerPath)
    return publicConfig({
      configured: managed && hasValues,
      otherConfiguration: !managed && hasValues,
      baseUrl: config.inferenceGatewayBaseUrl,
      model: typeof firstModel === 'string' ? firstModel : firstModel?.name,
      hasApiKey: managed && !!config.inferenceGatewayApiKey,
      configPath,
      extraPaths: [metaPath],
    })
  },
  async apply({ baseUrl, model, apiKey }) {
    const { configPath, markerPath } = await coworkConfigPaths(true)
    const config = await readJson(configPath, {})
    const managed = await exists(markerPath)
    config.inferenceProvider = 'gateway'
    config.inferenceGatewayBaseUrl = normalizeBaseUrl(baseUrl)
    config.inferenceGatewayApiKey = effectiveApiKey(apiKey, managed ? config.inferenceGatewayApiKey : '')
    config.inferenceModels = [{ name: model }]
    await writeJson(configPath, config)
    await writeMarker(markerPath, baseUrl, model)
    const desktopPath = path.join(platformDataRoot('Claude'), 'claude_desktop_config.json')
    const desktop = await readJson(desktopPath, {})
    desktop.deploymentMode = '3p'
    await writeJson(desktopPath, desktop)
    return this.inspect()
  },
  async remove() {
    const { configPath, markerPath } = await coworkConfigPaths(false)
    if (!configPath || !await exists(markerPath)) return
    const config = await readJson(configPath, null)
    if (!config) return
    delete config.inferenceProvider
    delete config.inferenceGatewayBaseUrl
    delete config.inferenceGatewayApiKey
    delete config.inferenceModels
    await writeJson(configPath, config)
    await removeFile(markerPath)
  },
}

function hermesPaths() {
  let directory
  if (process.env.KOGNIT_USER_HOME) {
    directory = path.join(userHome(), '.hermes')
  } else if (String(process.env.HERMES_HOME || '').trim()) {
    directory = path.resolve(process.env.HERMES_HOME)
  } else if (process.platform === 'win32') {
    const localAppData = String(process.env.LOCALAPPDATA || '').trim()
      || path.join(userHome(), 'AppData', 'Local')
    directory = path.join(localAppData, 'hermes')
  } else {
    directory = path.join(userHome(), '.hermes')
  }
  return {
    configPath: path.join(directory, 'config.yaml'),
    envPath: path.join(directory, '.env'),
    markerPath: path.join(directory, '.kognit-managed.json'),
  }
}

const hermesAdapter = {
  async inspect() {
    const { configPath, envPath, markerPath } = hermesPaths()
    const configText = await readText(configPath, '')
    const config = configText ? parseYaml(configText) || {} : {}
    const envText = await readText(envPath, '')
    const hasValues = config?.model?.provider === 'custom' && !!config.model.base_url
    const managed = await exists(markerPath)
    return publicConfig({
      configured: managed && hasValues,
      otherConfiguration: !managed && hasValues,
      baseUrl: config?.model?.base_url,
      model: config?.model?.default,
      hasApiKey: managed && /^OPENAI_API_KEY=.+$/m.test(envText),
      configPath,
      extraPaths: [envPath],
    })
  },
  async apply({ baseUrl, model, apiKey }) {
    const { configPath, envPath, markerPath } = hermesPaths()
    const configText = await readText(configPath, '')
    const config = configText ? parseYaml(configText) || {} : {}
    const managed = await exists(markerPath)
    config.model = {
      ...(config.model || {}),
      default: model,
      provider: 'custom',
      base_url: normalizeBaseUrl(baseUrl),
    }
    await writeText(configPath, stringifyYaml(config))
    const envText = await readText(envPath, '')
    const currentKey = managed ? envText.match(/^OPENAI_API_KEY=(.*)$/m)?.[1] : ''
    await writeText(envPath, upsertEnv(envText, 'OPENAI_API_KEY', effectiveApiKey(apiKey, currentKey)))
    await writeMarker(markerPath, baseUrl, model)
    return this.inspect()
  },
  async remove() {
    const { configPath, envPath, markerPath } = hermesPaths()
    if (!await exists(markerPath)) return
    const configText = await readText(configPath, '')
    if (configText) {
      const config = parseYaml(configText) || {}
      if (config?.model?.provider === 'custom') delete config.model
      await writeText(configPath, stringifyYaml(config))
    }
    const envText = await readText(envPath, '')
    if (envText) await writeText(envPath, removeEnv(envText, 'OPENAI_API_KEY'))
    await removeFile(markerPath)
  },
}

function droidPath() {
  return path.join(userHome(), '.factory', 'settings.json')
}

const droidAdapter = {
  async inspect() {
    const configPath = droidPath()
    const settings = await readJson(configPath, {})
    const entry = settings?.customModels?.find(item => item.id?.startsWith('custom:Kognit'))
    return publicConfig({
      configured: !!entry,
      baseUrl: entry?.baseUrl,
      model: entry?.model,
      hasApiKey: !!entry?.apiKey,
      configPath,
    })
  },
  async apply({ baseUrl, model, apiKey }) {
    const configPath = droidPath()
    const settings = await readJson(configPath, {})
    settings.customModels = (settings.customModels || []).filter(item => !item.id?.startsWith('custom:Kognit'))
    settings.customModels.push({
      model,
      id: 'custom:Kognit-0',
      index: 0,
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey: effectiveApiKey(apiKey, ''),
      displayName: `Kognit - ${model}`,
      maxOutputTokens: 131072,
      noImageSupport: false,
      provider: 'openai',
    })
    await writeJson(configPath, settings)
    return this.inspect()
  },
  async remove() {
    const configPath = droidPath()
    const settings = await readJson(configPath, null)
    if (!settings) return
    settings.customModels = (settings.customModels || []).filter(item => !item.id?.startsWith('custom:Kognit'))
    if (settings.customModels.length === 0) delete settings.customModels
    await writeJson(configPath, settings)
  },
}

function clinePaths() {
  const directory = path.join(userHome(), '.cline', 'data')
  return {
    configPath: path.join(directory, 'globalState.json'),
    secretsPath: path.join(directory, 'secrets.json'),
    markerPath: path.join(directory, '.kognit-managed.json'),
  }
}

const clineAdapter = {
  async inspect() {
    const { configPath, secretsPath, markerPath } = clinePaths()
    const settings = await readJson(configPath, {})
    const secrets = await readJson(secretsPath, {})
    const hasValues =
      (settings.actModeApiProvider === 'openai' || settings.planModeApiProvider === 'openai') &&
      !!settings.openAiBaseUrl
    const managed = await exists(markerPath)
    return publicConfig({
      configured: managed && hasValues,
      otherConfiguration: !managed && hasValues,
      baseUrl: settings.openAiBaseUrl ? normalizeBaseUrl(settings.openAiBaseUrl) : '',
      model: settings.openAiModelId,
      hasApiKey: managed && !!secrets.openAiApiKey,
      configPath,
      extraPaths: [secretsPath],
    })
  },
  async apply({ baseUrl, model, apiKey }) {
    const { configPath, secretsPath, markerPath } = clinePaths()
    const settings = await readJson(configPath, {})
    const managed = await exists(markerPath)
    settings.actModeApiProvider = 'openai'
    settings.planModeApiProvider = 'openai'
    settings.openAiBaseUrl = withoutV1(baseUrl)
    settings.openAiModelId = model
    settings.planModeOpenAiModelId = model
    await writeJson(configPath, settings)
    const secrets = await readJson(secretsPath, {})
    secrets.openAiApiKey = effectiveApiKey(apiKey, managed ? secrets.openAiApiKey : '')
    await writeJson(secretsPath, secrets)
    await writeMarker(markerPath, baseUrl, model)
    return this.inspect()
  },
  async remove() {
    const { configPath, secretsPath, markerPath } = clinePaths()
    if (!await exists(markerPath)) return
    const settings = await readJson(configPath, null)
    if (settings) {
      delete settings.openAiBaseUrl
      delete settings.openAiModelId
      delete settings.planModeOpenAiModelId
      if (settings.actModeApiProvider === 'openai') settings.actModeApiProvider = 'cline'
      if (settings.planModeApiProvider === 'openai') settings.planModeApiProvider = 'cline'
      await writeJson(configPath, settings)
    }
    const secrets = await readJson(secretsPath, null)
    if (secrets) {
      delete secrets.openAiApiKey
      await writeJson(secretsPath, secrets)
    }
    await removeFile(markerPath)
  },
}

function codeSettingsPath() {
  return path.join(platformDataRoot('Code'), 'User', 'settings.json')
}

function kiloPaths() {
  return {
    configPath: path.join(userHome(), '.local', 'share', 'kilo', 'auth.json'),
    vscodePath: codeSettingsPath(),
    markerPath: path.join(userHome(), '.local', 'share', 'kilo', '.kognit-managed.json'),
  }
}

const kiloAdapter = {
  async inspect() {
    const { configPath, vscodePath, markerPath } = kiloPaths()
    const auth = await readJson(configPath, {})
    const entry = auth['openai-compatible'] || auth.kognit
    const managed = await exists(markerPath)
    return publicConfig({
      configured: managed && !!entry,
      otherConfiguration: !managed && !!entry,
      baseUrl: entry?.baseUrl || entry?.baseURL,
      model: entry?.model,
      hasApiKey: managed && !!entry?.apiKey,
      configPath,
      extraPaths: [vscodePath],
    })
  },
  async apply({ baseUrl, model, apiKey }) {
    const { configPath, vscodePath, markerPath } = kiloPaths()
    const auth = await readJson(configPath, {})
    const current = auth['openai-compatible'] || {}
    const managed = await exists(markerPath)
    auth['openai-compatible'] = {
      type: 'api-key',
      apiKey: effectiveApiKey(apiKey, managed ? current.apiKey : ''),
      baseUrl: normalizeBaseUrl(baseUrl),
      model,
    }
    await writeJson(configPath, auth)
    const vscode = await readJson(vscodePath, {})
    vscode['kilocode.customProvider'] = {
      name: 'Kognit',
      baseURL: normalizeBaseUrl(baseUrl),
      apiKey: auth['openai-compatible'].apiKey,
    }
    vscode['kilocode.defaultModel'] = model
    await writeJson(vscodePath, vscode)
    await writeMarker(markerPath, baseUrl, model)
    return this.inspect()
  },
  async remove() {
    const { configPath, vscodePath, markerPath } = kiloPaths()
    if (!await exists(markerPath)) return
    const auth = await readJson(configPath, null)
    if (auth) {
      delete auth['openai-compatible']
      delete auth.kognit
      await writeJson(configPath, auth)
    }
    const vscode = await readJson(vscodePath, null)
    if (vscode) {
      delete vscode['kilocode.customProvider']
      delete vscode['kilocode.defaultModel']
      await writeJson(vscodePath, vscode)
    }
    await removeFile(markerPath)
  },
}

function continuePath() {
  return path.join(userHome(), '.continue', 'config.yaml')
}

const continueAdapter = {
  async inspect() {
    const configPath = continuePath()
    const content = await readText(configPath, '')
    const config = content ? parseYaml(content) || {} : {}
    const entry = config?.models?.find(item => item?.name?.startsWith('Kognit:'))
    return publicConfig({
      configured: !!entry,
      baseUrl: entry?.apiBase,
      model: entry?.model,
      hasApiKey: !!entry?.apiKey,
      configPath,
    })
  },
  async apply({ baseUrl, model, apiKey }) {
    const configPath = continuePath()
    const content = await readText(configPath, '')
    const config = content ? parseYaml(content) || {} : {}
    config.name ||= 'Local configuration'
    config.version ||= '1.0.0'
    config.schema ||= 'v1'
    config.models = (config.models || []).filter(item => !item?.name?.startsWith('Kognit:'))
    config.models.push({
      name: `Kognit: ${model}`,
      provider: 'openai',
      model,
      apiBase: normalizeBaseUrl(baseUrl),
      apiKey: effectiveApiKey(apiKey, ''),
      capabilities: ['tool_use'],
      roles: ['chat', 'edit', 'apply'],
    })
    await writeText(configPath, stringifyYaml(config))
    return this.inspect()
  },
  async remove() {
    const configPath = continuePath()
    const content = await readText(configPath, '')
    if (!content) return
    const config = parseYaml(content) || {}
    config.models = (config.models || []).filter(item => !item?.name?.startsWith('Kognit:'))
    await writeText(configPath, stringifyYaml(config))
  },
}

function manualAdapter(note) {
  return {
    async inspect() {
      return publicConfig({
        directlyConfigurable: false,
        note,
      })
    },
    async apply() {
      const error = new Error(note)
      error.code = 'MANUAL_CONFIGURATION_REQUIRED'
      throw error
    },
    async remove() {},
  }
}

const adapters = {
  'claude-code': claudeAdapter,
  openclaw: openClawAdapter,
  codex: codexAdapter,
  opencode: openCodeAdapter,
  cowork: coworkAdapter,
  hermes: hermesAdapter,
  droid: droidAdapter,
  cursor: manualAdapter('Cursor nao oferece um arquivo local suportado para Base URL customizada. Configure em Cursor Settings > Models usando um tunnel publico.'),
  cline: clineAdapter,
  kilo: kiloAdapter,
  roo: manualAdapter('Roo Code guarda credenciais no armazenamento privado da extensao. A configuracao OpenAI Compatible deve ser aplicada no painel do Roo.'),
  continue: continueAdapter,
}

function adapterFor(toolId) {
  const adapter = adapters[toolId]
  if (!adapter) throw new Error('Coding agent not found')
  return adapter
}

export async function inspectCliToolConfig(toolId) {
  try {
    const config = await adapterFor(toolId).inspect()
    config.configFileExists = config.configPath ? await exists(config.configPath) : false
    return config
  } catch (error) {
    return publicConfig({
      configError: error.message,
    })
  }
}

export async function applyCliToolConfig(toolId, input) {
  return adapterFor(toolId).apply(input)
}

export async function removeCliToolConfig(toolId) {
  await adapterFor(toolId).remove()
  return inspectCliToolConfig(toolId)
}
