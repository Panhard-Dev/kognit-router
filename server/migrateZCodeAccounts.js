import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const targetFile = process.env.KOGNIT_DATA_FILE || path.join(__dirname, 'data.json')
const sourceFile = process.argv[2]
  || process.env.NINE_ROUTER_DB
  || '/home/panhard/Vídeos/9router/data/9router/db/data.sqlite'

if (!fs.existsSync(sourceFile)) {
  throw new Error(`Banco do 9Router nao encontrado: ${sourceFile}`)
}

const emptyData = {
  keys: [],
  providers: [],
  providerConnections: [],
  providerSettings: {},
  cliToolSettings: {},
  usageEvents: [],
  tunnelUrl: null,
}

const target = fs.existsSync(targetFile)
  ? { ...emptyData, ...JSON.parse(fs.readFileSync(targetFile, 'utf8').replace(/^\uFEFF/, '')) }
  : structuredClone(emptyData)

target.providerConnections = Array.isArray(target.providerConnections) ? target.providerConnections : []
target.providerSettings = target.providerSettings && typeof target.providerSettings === 'object'
  ? target.providerSettings
  : {}

const database = new DatabaseSync(sourceFile, { readOnly: true })
const rows = database.prepare(`
  SELECT id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt
  FROM providerConnections
  WHERE lower(provider) IN ('zcode', 'zcode-ai', 'z.ai', 'zai')
  ORDER BY priority ASC, createdAt ASC
`).all()
database.close()

let imported = 0
let updated = 0

for (const [index, row] of rows.entries()) {
  let sourceData = {}
  try { sourceData = JSON.parse(row.data || '{}') } catch { /* ignore malformed metadata */ }

  const sourceProviderData = sourceData.providerSpecificData || {}
  const accessToken = String(
    sourceData.accessToken
      || sourceData.token
      || sourceData.apiKey
      || sourceProviderData.zaiAccessToken
      || ''
  ).trim().replace(/^Bearer\s+/i, '')
  const refreshToken = String(
    sourceData.refreshToken
      || sourceProviderData.zaiRefreshToken
      || ''
  ).trim().replace(/^Bearer\s+/i, '')

  if (!accessToken) continue

  const email = String(row.email || sourceData.email || '').trim()
  const now = new Date().toISOString()
  const providerSpecificData = {
    ...sourceProviderData,
    zaiAccessToken: undefined,
    zaiRefreshToken: undefined,
    authMethod: sourceProviderData.authMethod || 'migrated',
    sourceProvider: '9router',
    sourceConnectionId: row.id,
  }

  const connection = {
    id: `9router:${row.id}`,
    providerId: 'zcode-ai',
    providerName: 'ZCode / Z.ai',
    category: 'oauth',
    authType: 'oauth',
    connectionMode: 'oauth',
    name: email || (row.name === 'Sessão atual do ZCode' ? 'Sessão local do ZCode' : row.name) || `Conta ZCode ${index + 1}`,
    email,
    baseUrl: '',
    defaultModel: 'zc/GLM-5-Turbo',
    apiKey: '',
    accessToken,
    refreshToken,
    sessionToken: '',
    expiresAt: sourceData.expiresAt || null,
    projectId: '',
    scope: '',
    providerSpecificData,
    notes: 'Migrada automaticamente do 9Router.',
    enabled: row.isActive !== 0,
    priority: index,
    status: row.isActive !== 0 ? 'active' : 'disabled',
    testStatus: sourceData.testStatus === 'error' ? 'error' : 'untested',
    lastTested: sourceData.lastTested || null,
    created: row.createdAt || now,
    updated: row.updatedAt || now,
  }

  const existingIndex = target.providerConnections.findIndex(item =>
    item.providerId === 'zcode-ai'
      && (
        item.providerSpecificData?.sourceConnectionId === row.id
        || item.accessToken === accessToken
        || (email && item.email === email)
      )
  )

  if (existingIndex >= 0) {
    connection.id = target.providerConnections[existingIndex].id || connection.id
    target.providerConnections[existingIndex] = {
      ...target.providerConnections[existingIndex],
      ...connection,
    }
    updated += 1
  } else {
    target.providerConnections.push(connection)
    imported += 1
  }
}

const zcodeConnections = target.providerConnections
  .filter(item => item.providerId === 'zcode-ai')
  .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))

zcodeConnections.forEach((connection, index) => {
  connection.priority = index
})

target.providerSettings['zcode-ai'] = {
  ...(target.providerSettings['zcode-ai'] || {}),
  roundRobin: zcodeConnections.filter(item => item.enabled).length > 1,
  cursor: 0,
  updated: new Date().toISOString(),
}

fs.mkdirSync(path.dirname(targetFile), { recursive: true })
const temporaryFile = `${targetFile}.${process.pid}.tmp`
fs.writeFileSync(temporaryFile, JSON.stringify(target, null, 2), { mode: 0o600 })
fs.renameSync(temporaryFile, targetFile)
fs.chmodSync(targetFile, 0o600)

console.log(`Migracao ZCode concluida: ${imported} importada(s), ${updated} atualizada(s), ${zcodeConnections.length} total.`)
