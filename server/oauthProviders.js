import crypto from 'crypto'
import http from 'http'
import { arch, platform } from 'os'

const BASE64_BLOCK_SIZE = 4

const oauthSessions = new Map()
const callbackServers = new Map()

function getOAuthPlatformEnum() {
  const os = platform()
  const architecture = arch()
  if (os === 'darwin') return architecture === 'arm64' ? 2 : 1
  if (os === 'linux') return architecture === 'arm64' ? 4 : 3
  if (os === 'win32') return 5
  return 0
}

function getOAuthClientMetadata() {
  return { ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 }
}

function generateCodeVerifier(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

function generateState() {
  return crypto.randomBytes(32).toString('base64url')
}

function generatePKCE(bytes = 32) {
  const codeVerifier = generateCodeVerifier(bytes)
  return {
    codeVerifier,
    codeChallenge: generateCodeChallenge(codeVerifier),
    state: generateState(),
  }
}

function decodeJwtPayload(jwt) {
  try {
    if (!jwt || typeof jwt !== 'string') return null
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const missingPadding = (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE
    return JSON.parse(Buffer.from(base64 + '='.repeat(missingPadding), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function extractEmailFromAccessToken(accessToken) {
  const payload = decodeJwtPayload(accessToken)
  return payload?.email || payload?.preferred_username || payload?.sub || undefined
}

function extractCodexAccountInfo(idToken) {
  const payload = decodeJwtPayload(idToken)
  if (!payload) return {}
  const chatgpt = payload['https://api.openai.com/auth'] || {}
  return {
    email: payload.email,
    chatgptAccountId: chatgpt.chatgpt_account_id || payload.account_id,
    chatgptPlanType: chatgpt.chatgpt_plan_type || payload.plan_type,
  }
}

const OAUTH_PROVIDERS = {
  'claude-code': {
    id: 'claude-code',
    oauthId: 'claude',
    providerName: 'Claude Code',
    category: 'oauth',
    flowType: 'authorization_code_pkce',
    config: {
      clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      authorizeUrl: 'https://claude.ai/oauth/authorize',
      tokenUrl: 'https://api.anthropic.com/v1/oauth/token',
      scopes: ['org:create_api_key', 'user:profile', 'user:inference'],
      codeChallengeMethod: 'S256',
    },
    buildAuthUrl(config, redirectUri, state, codeChallenge) {
      const params = new URLSearchParams({
        code: 'true',
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: config.scopes.join(' '),
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod,
        state,
      })
      return `${config.authorizeUrl}?${params.toString()}`
    },
    async exchangeToken(config, code, redirectUri, codeVerifier, state) {
      let authCode = code
      let codeState = ''
      if (authCode.includes('#')) {
        const parts = authCode.split('#')
        authCode = parts[0]
        codeState = parts[1] || ''
      }

      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          code: authCode,
          state: codeState || state,
          grant_type: 'authorization_code',
          client_id: config.clientId,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      })
      if (!response.ok) throw new Error(`Claude token exchange failed: ${await response.text()}`)
      return response.json()
    },
    mapTokens(tokens) {
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
      }
    },
  },

  'openai-codex': {
    id: 'openai-codex',
    oauthId: 'codex',
    providerName: 'OpenAI Codex',
    category: 'oauth',
    flowType: 'authorization_code_pkce',
    fixedPort: 1455,
    callbackPath: '/auth/callback',
    config: {
      clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize',
      tokenUrl: 'https://auth.openai.com/oauth/token',
      scope: 'openid profile email offline_access',
      codeChallengeMethod: 'S256',
      extraParams: {
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'codex_cli_rs',
      },
    },
    buildAuthUrl(config, redirectUri, state, codeChallenge) {
      const params = {
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: config.scope,
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod,
        ...config.extraParams,
        state,
      }
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&')
      return `${config.authorizeUrl}?${queryString}`
    },
    async exchangeToken(config, code, redirectUri, codeVerifier) {
      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      })
      if (!response.ok) throw new Error(`Codex token exchange failed: ${await response.text()}`)
      return response.json()
    },
    mapTokens(tokens) {
      const info = extractCodexAccountInfo(tokens.id_token)
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        email: info.email,
        providerSpecificData: {
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType,
          idToken: tokens.id_token,
        },
      }
    },
  },

  'gemini-cli': {
    id: 'gemini-cli',
    oauthId: 'gemini-cli',
    providerName: 'Gemini CLI',
    category: 'free-tier',
    flowType: 'authorization_code',
    config: {
      clientId: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
      clientSecret: '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',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://www.googleapis.com/oauth2/v1/userinfo',
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
    },
    buildAuthUrl(config, redirectUri, state) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: config.scopes.join(' '),
        state,
        access_type: 'offline',
        prompt: 'consent',
      })
      return `${config.authorizeUrl}?${params.toString()}`
    },
    async exchangeToken(config, code, redirectUri) {
      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      })
      if (!response.ok) throw new Error(`Gemini token exchange failed: ${await response.text()}`)
      return response.json()
    },
    async postExchange(tokens) {
      const userInfoRes = await fetch(`${this.config.userInfoUrl}?alt=json`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      const userInfo = userInfoRes.ok ? await userInfoRes.json() : {}

      let projectId = ''
      try {
        const projectRes = await fetch('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ metadata: getOAuthClientMetadata(), mode: 1 }),
        })
        if (projectRes.ok) {
          const data = await projectRes.json()
          projectId = data.cloudaicompanionProject?.id || data.cloudaicompanionProject || ''
        }
      } catch {
        projectId = ''
      }

      return { userInfo, projectId }
    },
    mapTokens(tokens, extra) {
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        email: extra?.userInfo?.email,
        projectId: extra?.projectId,
      }
    },
  },

  antigravity: {
    id: 'antigravity',
    oauthId: 'antigravity',
    providerName: 'Antigravity',
    category: 'oauth',
    flowType: 'authorization_code',
    config: {
      clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
      clientSecret: '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',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://www.googleapis.com/oauth2/v1/userinfo',
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/cclog',
        'https://www.googleapis.com/auth/experimentsandconfigs',
      ],
      loadCodeAssistEndpoint: 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
      onboardUserEndpoint: 'https://cloudcode-pa.googleapis.com/v1internal:onboardUser',
      loadCodeAssistUserAgent: 'google-api-nodejs-client/9.15.1',
      loadCodeAssistApiClient: 'google-cloud-sdk vscode_cloudshelleditor/0.1',
      loadCodeAssistClientMetadata: JSON.stringify({ ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 }),
    },
    buildAuthUrl(config, redirectUri, state) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: config.scopes.join(' '),
        state,
        access_type: 'offline',
        prompt: 'consent',
      })
      return `${config.authorizeUrl}?${params.toString()}`
    },
    async exchangeToken(config, code, redirectUri) {
      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      })
      if (!response.ok) throw new Error(`Antigravity token exchange failed: ${await response.text()}`)
      return response.json()
    },
    async postExchange(tokens) {
      const loadHeaders = {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
        'User-Agent': this.config.loadCodeAssistUserAgent,
        'X-Goog-Api-Client': this.config.loadCodeAssistApiClient,
        'Client-Metadata': this.config.loadCodeAssistClientMetadata,
        'x-request-source': 'local',
      }
      const metadata = getOAuthClientMetadata()
      const userInfoRes = await fetch(`${this.config.userInfoUrl}?alt=json`, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'x-request-source': 'local' },
      })
      const userInfo = userInfoRes.ok ? await userInfoRes.json() : {}

      let projectId = ''
      try {
        const loadRes = await fetch(this.config.loadCodeAssistEndpoint, {
          method: 'POST',
          headers: loadHeaders,
          body: JSON.stringify({ metadata }),
        })
        if (loadRes.ok) {
          const data = await loadRes.json()
          projectId = data.cloudaicompanionProject?.id || data.cloudaicompanionProject || ''
        }
      } catch {
        projectId = ''
      }

      return { userInfo, projectId }
    },
    mapTokens(tokens, extra) {
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        email: extra?.userInfo?.email,
        projectId: extra?.projectId,
      }
    },
  },

  'zcode-ai': {
    id: 'zcode-ai',
    oauthId: 'zai',
    providerName: 'ZCode / Z.ai',
    category: 'oauth',
    flowType: 'authorization_code',
    config: {
      clientId: 'client_P8X5CMWmlaRO9gyO-KSqtg',
      authorizeUrl: 'https://chat.z.ai/api/oauth/authorize',
      tokenUrl: 'https://zcode.z.ai/api/v1/oauth/token',
    },
    buildAuthUrl(config, redirectUri, state) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
      })
      return `${config.authorizeUrl}?${params.toString()}`
    },
    async exchangeToken(config, code, redirectUri, _codeVerifier, state) {
      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          provider: 'zai',
          code,
          redirect_uri: redirectUri,
          state,
        }),
      })
      if (!response.ok) throw new Error(`ZCode token exchange failed: ${await response.text()}`)
      return response.json()
    },
    mapTokens(tokens) {
      const data = tokens?.data || {}
      return {
        accessToken: data.token || tokens.token,
        refreshToken: data.zai?.refresh_token || tokens.refresh_token,
        expiresIn: data.expires_in || tokens.expires_in,
        providerSpecificData: {
          zai: data.zai || {},
        },
      }
    },
  },

  cline: {
    id: 'cline',
    oauthId: 'cline',
    providerName: 'Cline',
    category: 'oauth',
    flowType: 'authorization_code',
    config: {
      authorizeUrl: 'https://api.cline.bot/api/v1/auth/authorize',
      tokenExchangeUrl: 'https://api.cline.bot/api/v1/auth/token',
    },
    buildAuthUrl(config, redirectUri) {
      const params = new URLSearchParams({
        client_type: 'extension',
        callback_url: redirectUri,
        redirect_uri: redirectUri,
      })
      return `${config.authorizeUrl}?${params.toString()}`
    },
    async exchangeToken(config, code, redirectUri) {
      try {
        let base64 = code
        const padding = 4 - (base64.length % 4)
        if (padding !== 4) base64 += '='.repeat(padding)
        const decoded = Buffer.from(base64, 'base64').toString('utf-8')
        const lastBrace = decoded.lastIndexOf('}')
        if (lastBrace === -1) throw new Error('No JSON found in decoded Cline code')
        const tokenData = JSON.parse(decoded.substring(0, lastBrace + 1))
        return {
          access_token: tokenData.accessToken,
          refresh_token: tokenData.refreshToken,
          email: tokenData.email,
          firstName: tokenData.firstName,
          lastName: tokenData.lastName,
          expires_at: tokenData.expiresAt,
        }
      } catch {
        const response = await fetch(config.tokenExchangeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ grant_type: 'authorization_code', code, client_type: 'extension', redirect_uri: redirectUri }),
        })
        if (!response.ok) throw new Error(`Cline token exchange failed: ${await response.text()}`)
        const data = await response.json()
        return {
          access_token: data.data?.accessToken || data.accessToken,
          refresh_token: data.data?.refreshToken || data.refreshToken,
          email: data.data?.userInfo?.email || '',
          expires_at: data.data?.expiresAt || data.expiresAt,
        }
      }
    },
    mapTokens(tokens) {
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_at ? Math.floor((new Date(tokens.expires_at).getTime() - Date.now()) / 1000) : 3600,
        email: tokens.email,
        providerSpecificData: { firstName: tokens.firstName, lastName: tokens.lastName },
      }
    },
  },

  'github-copilot': {
    id: 'github-copilot',
    oauthId: 'github',
    providerName: 'GitHub Copilot',
    category: 'oauth',
    flowType: 'device_code',
    config: {
      clientId: 'Iv1.b507a08c87ecfe98',
      deviceCodeUrl: 'https://github.com/login/device/code',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
      scopes: 'read:user',
      apiVersion: '2022-11-28',
      copilotTokenUrl: 'https://api.github.com/copilot_internal/v2/token',
      userAgent: 'GitHubCopilotChat/0.26.7',
    },
    async requestDeviceCode(config) {
      const response = await fetch(config.deviceCodeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: config.clientId, scope: config.scopes }),
      })
      if (!response.ok) throw new Error(`GitHub device code failed: ${await response.text()}`)
      return response.json()
    },
    async pollToken(config, deviceCode) {
      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      })
      let data
      try {
        data = await response.json()
      } catch {
        data = { error: 'invalid_response', error_description: await response.text() }
      }
      return { ok: response.ok, data }
    },
    async postExchange(tokens) {
      const copilotRes = await fetch(this.config.copilotTokenUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json',
          'X-GitHub-Api-Version': this.config.apiVersion,
          'User-Agent': this.config.userAgent,
        },
      })
      const copilotToken = copilotRes.ok ? await copilotRes.json() : {}
      const userRes = await fetch(this.config.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json',
          'X-GitHub-Api-Version': this.config.apiVersion,
          'User-Agent': this.config.userAgent,
        },
      })
      const userInfo = userRes.ok ? await userRes.json() : {}
      return { copilotToken, userInfo }
    },
    mapTokens(tokens, extra) {
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        email: extra?.userInfo?.email || extra?.userInfo?.login,
        providerSpecificData: {
          copilotToken: extra?.copilotToken?.token,
          copilotTokenExpiresAt: extra?.copilotToken?.expires_at,
          githubUserId: extra?.userInfo?.id,
          githubLogin: extra?.userInfo?.login,
          githubName: extra?.userInfo?.name,
        },
      }
    },
  },

  'kiro-ai': {
    id: 'kiro-ai',
    oauthId: 'kiro',
    providerName: 'Kiro AI',
    category: 'free-tier',
    flowType: 'device_code',
    config: {
      clientName: 'kiro-oauth-client',
      clientType: 'public',
      scopes: ['codewhisperer:completions', 'codewhisperer:analysis', 'codewhisperer:conversations'],
      grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
      issuerUrl: 'https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6',
      startUrl: 'https://view.awsapps.com/start',
    },
    async requestDeviceCode(config, options = {}) {
      const region = typeof options.region === 'string' && options.region.trim() ? options.region.trim() : 'us-east-1'
      const startUrl = typeof options.startUrl === 'string' && options.startUrl.trim() ? options.startUrl.trim() : config.startUrl
      const authMethod = options.authMethod === 'idc' ? 'idc' : 'builder-id'
      const registerRes = await fetch(`https://oidc.${region}.amazonaws.com/client/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          clientName: config.clientName,
          clientType: config.clientType,
          scopes: config.scopes,
          grantTypes: config.grantTypes,
          issuerUrl: config.issuerUrl,
        }),
      })
      if (!registerRes.ok) throw new Error(`Kiro client registration failed: ${await registerRes.text()}`)
      const clientInfo = await registerRes.json()

      const deviceRes = await fetch(`https://oidc.${region}.amazonaws.com/device_authorization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          clientId: clientInfo.clientId,
          clientSecret: clientInfo.clientSecret,
          startUrl,
        }),
      })
      if (!deviceRes.ok) throw new Error(`Kiro device authorization failed: ${await deviceRes.text()}`)
      const deviceData = await deviceRes.json()
      return {
        device_code: deviceData.deviceCode,
        user_code: deviceData.userCode,
        verification_uri: deviceData.verificationUri,
        verification_uri_complete: deviceData.verificationUriComplete,
        expires_in: deviceData.expiresIn,
        interval: deviceData.interval || 5,
        _clientId: clientInfo.clientId,
        _clientSecret: clientInfo.clientSecret,
        _region: region,
        _authMethod: authMethod,
        _startUrl: startUrl,
      }
    },
    async pollToken(config, deviceCode, extraData) {
      const region = extraData?._region || 'us-east-1'
      const response = await fetch(`https://oidc.${region}.amazonaws.com/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          clientId: extraData?._clientId,
          clientSecret: extraData?._clientSecret,
          deviceCode,
          grantType: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      })
      let data
      try {
        data = await response.json()
      } catch {
        data = { error: 'invalid_response', error_description: await response.text() }
      }
      if (data.accessToken) {
        return {
          ok: true,
          data: {
            access_token: data.accessToken,
            refresh_token: data.refreshToken,
            expires_in: data.expiresIn,
            profile_arn: data.profileArn || null,
            _clientId: extraData?._clientId,
            _clientSecret: extraData?._clientSecret,
            _region: extraData?._region,
            _authMethod: extraData?._authMethod,
            _startUrl: extraData?._startUrl,
          },
        }
      }
      return {
        ok: false,
        data: {
          error: data.error || 'authorization_pending',
          error_description: data.error_description || data.message,
        },
      }
    },
    mapTokens(tokens) {
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        email: extractEmailFromAccessToken(tokens.access_token),
        providerSpecificData: {
          profileArn: tokens.profile_arn || null,
          clientId: tokens._clientId,
          clientSecret: tokens._clientSecret,
          region: tokens._region || 'us-east-1',
          authMethod: tokens._authMethod || 'builder-id',
          startUrl: tokens._startUrl || this.config.startUrl,
        },
      }
    },
  },

  'kilo-code': {
    id: 'kilo-code',
    oauthId: 'kilocode',
    providerName: 'Kilo Code',
    category: 'oauth',
    flowType: 'device_code',
    config: {
      apiBaseUrl: 'https://api.kilo.ai',
      initiateUrl: 'https://api.kilo.ai/api/device-auth/codes',
      pollUrlBase: 'https://api.kilo.ai/api/device-auth/codes',
    },
    async requestDeviceCode(config) {
      const response = await fetch(config.initiateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (response.status === 429) throw new Error('Too many pending Kilo authorization requests. Try again later.')
      if (!response.ok) throw new Error(`Kilo device auth failed: ${await response.text()}`)
      const data = await response.json()
      return {
        device_code: data.code,
        user_code: data.code,
        verification_uri: data.verificationUrl,
        verification_uri_complete: data.verificationUrl,
        expires_in: data.expiresIn || 300,
        interval: 3,
      }
    },
    async pollToken(config, deviceCode) {
      const response = await fetch(`${config.pollUrlBase}/${deviceCode}`)
      if (response.status === 202) return { ok: false, data: { error: 'authorization_pending' } }
      if (response.status === 403) return { ok: false, data: { error: 'access_denied', error_description: 'Authorization denied by user' } }
      if (response.status === 410) return { ok: false, data: { error: 'expired_token', error_description: 'Authorization code expired' } }
      if (!response.ok) return { ok: false, data: { error: 'poll_failed', error_description: `Poll failed: ${response.status}` } }
      const data = await response.json()
      if (data.status === 'approved' && data.token) {
        let orgId = null
        try {
          const profileRes = await fetch(`${config.apiBaseUrl}/api/profile`, {
            headers: { Authorization: `Bearer ${data.token}` },
          })
          if (profileRes.ok) {
            const profile = await profileRes.json()
            orgId = profile.organizations?.[0]?.id || null
          }
        } catch {
          orgId = null
        }
        return { ok: true, data: { access_token: data.token, _userEmail: data.userEmail, _orgId: orgId } }
      }
      return { ok: false, data: { error: 'authorization_pending' } }
    },
    mapTokens(tokens) {
      return {
        accessToken: tokens.access_token,
        refreshToken: null,
        expiresIn: null,
        email: tokens._userEmail,
        providerSpecificData: tokens._orgId ? { orgId: tokens._orgId } : {},
      }
    },
  },

  'cursor-ide': {
    id: 'cursor-ide',
    oauthId: 'cursor',
    providerName: 'Cursor IDE',
    category: 'oauth',
    flowType: 'import_token',
    mapTokens(tokens) {
      return {
        accessToken: tokens.accessToken,
        refreshToken: null,
        expiresIn: tokens.expiresIn || 86400,
        email: extractEmailFromAccessToken(tokens.accessToken),
        providerSpecificData: {
          machineId: tokens.machineId,
          authMethod: 'imported',
        },
      }
    },
  },
}

export function getOAuthProvider(providerId) {
  const provider = OAUTH_PROVIDERS[providerId]
  if (!provider) throw new Error(`OAuth provider not supported: ${providerId}`)
  return provider
}

export function getOAuthProviderMeta(providerId) {
  const provider = getOAuthProvider(providerId)
  return {
    id: provider.id,
    providerName: provider.providerName,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort || null,
    callbackPath: provider.callbackPath || '/callback',
  }
}

export async function createBrowserOAuthSession(providerId, backendOrigin) {
  const provider = getOAuthProvider(providerId)
  if (!['authorization_code', 'authorization_code_pkce'].includes(provider.flowType)) {
    throw new Error(`${provider.providerName} does not use browser OAuth`)
  }

  const sessionId = crypto.randomUUID()
  const pkce = generatePKCE()
  const redirectUri = provider.fixedPort
    ? `http://localhost:${provider.fixedPort}${provider.callbackPath || '/callback'}`
    : `${backendOrigin}/api/oauth-connections/callback/${sessionId}`
  const authUrl = provider.buildAuthUrl(provider.config, redirectUri, pkce.state, pkce.codeChallenge)

  const session = {
    id: sessionId,
    providerId,
    flowType: provider.flowType,
    status: 'waiting_callback',
    state: pkce.state,
    codeVerifier: pkce.codeVerifier,
    redirectUri,
    authUrl,
    createdAt: Date.now(),
    error: null,
    result: null,
  }

  oauthSessions.set(sessionId, session)
  if (provider.fixedPort) await startFixedCallbackServer(provider.fixedPort, provider.callbackPath || '/callback')

  return {
    sessionId,
    authUrl,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort || null,
    callbackPath: provider.callbackPath || '/callback',
  }
}

export async function createDeviceOAuthSession(providerId, options = {}) {
  const provider = getOAuthProvider(providerId)
  if (provider.flowType !== 'device_code') {
    throw new Error(`${provider.providerName} does not use device-code login`)
  }

  const sessionId = crypto.randomUUID()
  const pkce = generatePKCE()
  const deviceData = await provider.requestDeviceCode(provider.config, options)

  const session = {
    id: sessionId,
    providerId,
    flowType: provider.flowType,
    status: 'waiting_device',
    codeVerifier: pkce.codeVerifier,
    codeChallenge: pkce.codeChallenge,
    deviceCode: deviceData.device_code,
    extraData: {
      _clientId: deviceData._clientId,
      _clientSecret: deviceData._clientSecret,
      _region: deviceData._region,
      _authMethod: deviceData._authMethod,
      _startUrl: deviceData._startUrl,
    },
    createdAt: Date.now(),
    error: null,
    result: null,
  }

  oauthSessions.set(sessionId, session)

  return {
    sessionId,
    deviceCode: deviceData.device_code,
    userCode: deviceData.user_code,
    verificationUri: deviceData.verification_uri,
    verificationUriComplete: deviceData.verification_uri_complete,
    expiresIn: deviceData.expires_in,
    interval: deviceData.interval || 5,
  }
}

export async function pollDeviceOAuthSession(sessionId, saveTokens) {
  const session = oauthSessions.get(sessionId)
  if (!session) throw new Error('OAuth session not found')
  const provider = getOAuthProvider(session.providerId)
  if (provider.flowType !== 'device_code') throw new Error('Session is not a device-code flow')
  if (session.status === 'done') return session.result
  if (session.status === 'error') return { success: false, error: session.error }

  const result = await provider.pollToken(provider.config, session.deviceCode, session.extraData)
  if (result.ok && result.data?.access_token) {
    let extra = null
    if (provider.postExchange) extra = await provider.postExchange(result.data)
    const tokens = provider.mapTokens(result.data, extra)
    const connection = await saveTokens(provider, tokens)
    session.status = 'done'
    session.result = { success: true, connection }
    return session.result
  }

  const error = result.data?.error || 'authorization_pending'
  const pending = error === 'authorization_pending' || error === 'slow_down'
  if (pending) {
    return {
      success: false,
      pending: true,
      error,
      errorDescription: result.data?.error_description || result.data?.message || '',
    }
  }

  session.status = 'error'
  session.error = result.data?.error_description || error
  return { success: false, pending: false, error, errorDescription: session.error }
}

export async function completeOAuthCallbackFromUrl(rawUrl, saveTokens) {
  const url = new URL(rawUrl, 'http://localhost')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')
  const session = [...oauthSessions.values()].find(item => item.state === state)

  if (!session) throw new Error('OAuth session not found for callback state')
  if (error) {
    session.status = 'error'
    session.error = errorDescription || error
    throw new Error(session.error)
  }
  if (!code) throw new Error('OAuth callback did not include code')

  return completeOAuthSession(session.id, code, saveTokens)
}

export async function completeOAuthSession(sessionId, code, saveTokens) {
  const session = oauthSessions.get(sessionId)
  if (!session) throw new Error('OAuth session not found')
  const provider = getOAuthProvider(session.providerId)

  try {
    const tokensRaw = await provider.exchangeToken(provider.config, code, session.redirectUri, session.codeVerifier, session.state)
    let extra = null
    if (provider.postExchange) extra = await provider.postExchange(tokensRaw)
    const tokens = provider.mapTokens(tokensRaw, extra)
    const connection = await saveTokens(provider, tokens)
    session.status = 'done'
    session.result = { success: true, connection }
    return session.result
  } catch (err) {
    session.status = 'error'
    session.error = err.message
    throw err
  }
}

export async function importOAuthToken(providerId, body, saveTokens) {
  const provider = getOAuthProvider(providerId)
  if (provider.flowType !== 'import_token') {
    throw new Error(`${provider.providerName} does not use import-token flow`)
  }

  const accessToken = body.accessToken?.trim()
  const machineId = body.machineId?.trim()
  if (!accessToken || accessToken.length < 50) throw new Error('Cursor access token is invalid or too short')
  if (!machineId || !/^[a-f0-9-]{32,}$/i.test(machineId.replace(/-/g, ''))) {
    throw new Error('Cursor machine ID must be UUID-like')
  }

  const tokens = provider.mapTokens({ accessToken, machineId, expiresIn: 86400 })
  const connection = await saveTokens(provider, tokens)
  return { success: true, connection }
}

export function getOAuthSessionStatus(sessionId) {
  const session = oauthSessions.get(sessionId)
  if (!session) return { status: 'unknown' }
  return {
    id: session.id,
    providerId: session.providerId,
    flowType: session.flowType,
    status: session.status,
    error: session.error,
    result: session.result,
  }
}

export async function completePendingCallbackSession(sessionId, saveTokens) {
  const session = oauthSessions.get(sessionId)
  if (!session) throw new Error('OAuth session not found')
  if (session.status === 'callback_received' && session.callbackCode) {
    return completeOAuthSession(sessionId, session.callbackCode, saveTokens)
  }
  if (session.status === 'error') {
    return { success: false, error: session.error || 'OAuth failed' }
  }
  return session.result || { success: false, pending: true, status: session.status }
}

function startFixedCallbackServer(port, callbackPath) {
  if (callbackServers.has(port)) return

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${port}`)
      if (reqUrl.pathname !== callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }

      try {
        const state = reqUrl.searchParams.get('state')
        const session = [...oauthSessions.values()].find(item => item.state === state)
        if (!session) throw new Error('Session not found for state')
        session.callbackUrl = reqUrl.toString()
        session.callbackCode = reqUrl.searchParams.get('code')
        session.callbackError = reqUrl.searchParams.get('error')
        session.status = session.callbackError ? 'error' : 'callback_received'
        session.error = session.callbackError || null
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`
          <!doctype html>
          <html>
            <body style="background:#000;color:#fff;font-family:monospace">
              <h3>Kognit OAuth received.</h3>
              <p>You can close this window and return to Kognit.</p>
              <script>setTimeout(() => window.close(), 1200)</script>
            </body>
          </html>
        `)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(err.message)
      }
    })

    server.once('error', (err) => {
      callbackServers.delete(port)
      reject(new Error(`Could not bind OAuth callback on localhost:${port}: ${err.message}`))
    })

    server.listen(port, '127.0.0.1', () => {
      callbackServers.set(port, server)
      resolve()
    })
  })
}
