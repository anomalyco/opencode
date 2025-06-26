import { OAuth2Client } from "google-auth-library"
import { Auth } from "./index.js"
import * as http from "http"
import * as url from "url"
import crypto from "crypto"
import * as os from "os"

/**
 * Types for Google Cloud Code Assist API
 * Based on Gemini CLI implementation
 */
interface ClientMetadata {
  ideType?: ClientMetadataIdeType
  ideVersion?: string
  pluginVersion?: string
  platform?: ClientMetadataPlatform
  updateChannel?: string
  duetProject?: string
  pluginType?: ClientMetadataPluginType
  ideName?: string
}

type ClientMetadataIdeType =
  | 'IDE_UNSPECIFIED'
  | 'VSCODE'
  | 'INTELLIJ'
  | 'VSCODE_CLOUD_WORKSTATION'
  | 'INTELLIJ_CLOUD_WORKSTATION'
  | 'CLOUD_SHELL'

type ClientMetadataPlatform =
  | 'PLATFORM_UNSPECIFIED'
  | 'DARWIN_AMD64'
  | 'DARWIN_ARM64'
  | 'LINUX_AMD64'
  | 'LINUX_ARM64'
  | 'WINDOWS_AMD64'

type ClientMetadataPluginType =
  | 'PLUGIN_UNSPECIFIED'
  | 'CLOUD_CODE'
  | 'GEMINI'
  | 'AIPLUGIN_INTELLIJ'
  | 'AIPLUGIN_STUDIO'

interface LoadCodeAssistRequest {
  cloudaicompanionProject?: string
  metadata: ClientMetadata
}

interface LoadCodeAssistResponse {
  currentTier?: GeminiUserTier | null
  allowedTiers?: GeminiUserTier[] | null
  ineligibleTiers?: IneligibleTier[] | null
  cloudaicompanionProject?: string | null
}

interface GeminiUserTier {
  id: string
  name: string
  description: string
  userDefinedCloudaicompanionProject?: boolean | null
  isDefault?: boolean
  privacyNotice?: PrivacyNotice
  hasAcceptedTos?: boolean
  hasOnboardedPreviously?: boolean
}

interface PrivacyNotice {
  title?: string
  message?: string
}

interface IneligibleTier {
  reasonCode: IneligibleTierReasonCode
  reasonMessage: string
  tierId: string
  tierName: string
}

enum IneligibleTierReasonCode {
  DASHER_USER = 'DASHER_USER',
  INELIGIBLE_ACCOUNT = 'INELIGIBLE_ACCOUNT',
  NON_USER_ACCOUNT = 'NON_USER_ACCOUNT',
  RESTRICTED_AGE = 'RESTRICTED_AGE',
  RESTRICTED_NETWORK = 'RESTRICTED_NETWORK',
  UNKNOWN = 'UNKNOWN',
  UNKNOWN_LOCATION = 'UNKNOWN_LOCATION',
  UNSUPPORTED_LOCATION = 'UNSUPPORTED_LOCATION',
}

interface OnboardUserRequest {
  tierId: string | undefined
  cloudaicompanionProject: string | undefined
  metadata: ClientMetadata | undefined
}

interface LongrunningOperationResponse {
  name: string
  done?: boolean
  response?: OnboardUserResponse
  error?: {
    code: number
    message: string
  }
}

interface OnboardUserResponse {
  cloudaicompanionProject?: {
    id: string
    name: string
  }
}

export namespace AuthGoogleCloudCode {
  const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
  const CLIENT_SECRET = "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"
  const SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ]
  
  const CODE_ASSIST_ENDPOINT = process.env["CODE_ASSIST_ENDPOINT"] || "https://cloudcode-pa.googleapis.com"
  const CODE_ASSIST_API_VERSION = "v1internal"

  let oauthClient: OAuth2Client | null = null
  let cachedProjectId: string | null = null

  export async function getOAuthClient(): Promise<OAuth2Client> {
    if (!oauthClient) {
      oauthClient = new OAuth2Client({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      })
    }

    // Check if we have cached credentials
    const savedAuth = await Auth.get("google-vertex")
    if (savedAuth && savedAuth.type === "oauth") {
      oauthClient.setCredentials({
        access_token: savedAuth.access,
        refresh_token: savedAuth.refresh,
        expiry_date: savedAuth.expires,
      })
      
      // Verify the credentials are still valid
      try {
        const { token } = await oauthClient.getAccessToken()
        if (token) {
          return oauthClient
        }
      } catch {
        // Token invalid, will proceed with new auth
      }
    }

    return oauthClient
  }

  export async function authorize() {
    const client = await getOAuthClient()
    const port = await findAvailablePort()
    const redirectUri = `http://localhost:${port}/oauth2callback`
    const state = crypto.randomBytes(32).toString('hex')
    
    const authUrl = client.generateAuthUrl({
      redirect_uri: redirectUri,
      access_type: 'offline',
      scope: SCOPES,
      state,
      prompt: 'consent', // Force consent to ensure refresh token
    })

    return {
      url: authUrl,
      state,
      port,
      redirectUri,
      client
    }
  }

  async function findAvailablePort(): Promise<number> {
    return new Promise((resolve) => {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("Port check")
        },
      })
      const port = server.port
      server.stop()
      resolve(port!)
    })
  }

  export async function waitForCallback(
    state: string, 
    port: number, 
    redirectUri: string,
    client: OAuth2Client
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          if (!req.url?.includes('/oauth2callback')) {
            res.writeHead(404)
            res.end()
            return
          }

          const qs = new url.URL(req.url!, `http://localhost:${port}`).searchParams
          
          if (qs.get('error')) {
            res.writeHead(302, { Location: 'https://opencode.ai/docs' })
            res.end()
            reject(new Error(`OAuth error: ${qs.get('error')}`))
            return
          }
          
          if (qs.get('state') !== state) {
            res.writeHead(400)
            res.end('State mismatch')
            reject(new Error('State mismatch - possible CSRF attack'))
            return
          }
          
          const code = qs.get('code')
          if (!code) {
            res.writeHead(400)
            res.end('No code found')
            reject(new Error('No authorization code received'))
            return
          }

          const { tokens } = await client.getToken({
            code,
            redirect_uri: redirectUri,
          })
          
          client.setCredentials(tokens)

          await Auth.set("google-vertex", {
            type: "oauth",
            refresh: tokens.refresh_token!,
            access: tokens.access_token!,
            expires: tokens.expiry_date!,
          })

          res.writeHead(302, { Location: 'https://opencode.ai/docs' })
          res.end()
          

          setTimeout(() => {
            server.close(() => {
              resolve()
            })
          }, 100)
        } catch (error) {
          server.close(() => {
            reject(error)
          })
        }
      })
      
      server.listen(port)

      const timeout = setTimeout(() => {
        server.close(() => {
          reject(new Error("OAuth callback timeout"))
        })
      }, 5 * 60 * 1000)
      
      server.on('close', () => {
        clearTimeout(timeout)
      })
    })
  }

  export async function access(): Promise<string | undefined> {
    const client = await getOAuthClient()
    
    try {
      const { token } = await client.getAccessToken()
      return token || undefined
    } catch {
      return undefined
    }
  }

  // Cloud Code Assist API methods
  async function callEndpoint<T>(
    client: OAuth2Client,
    method: string,
    body: object
  ): Promise<T> {
    const res = await client.request({
      url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      data: body,
    })
    return res.data as T
  }

  async function loadCodeAssist(
    client: OAuth2Client,
    projectId?: string
  ): Promise<LoadCodeAssistResponse> {
    const metadata = getClientMetadata(projectId)
    const request: LoadCodeAssistRequest = {
      cloudaicompanionProject: projectId,
      metadata,
    }
    return callEndpoint<LoadCodeAssistResponse>(client, 'loadCodeAssist', request)
  }

  async function onboardUser(
    client: OAuth2Client,
    tierId: string,
    projectId?: string
  ): Promise<LongrunningOperationResponse> {
    const metadata = getClientMetadata(projectId)
    const request: OnboardUserRequest = {
      tierId,
      cloudaicompanionProject: projectId,
      metadata,
    }
    return callEndpoint<LongrunningOperationResponse>(client, 'onboardUser', request)
  }

  function getClientMetadata(projectId?: string): ClientMetadata {
    const platform = getPlatform()
    return {
      ideType: 'IDE_UNSPECIFIED',
      platform,
      pluginType: 'GEMINI',
      duetProject: projectId,
    }
  }

  function getPlatform(): ClientMetadataPlatform {
    const platform = os.platform()
    const arch = os.arch()
    
    if (platform === 'darwin') {
      return arch === 'arm64' ? 'DARWIN_ARM64' : 'DARWIN_AMD64'
    } else if (platform === 'linux') {
      return arch === 'arm64' ? 'LINUX_ARM64' : 'LINUX_AMD64'
    } else if (platform === 'win32') {
      return 'WINDOWS_AMD64'
    }
    return 'PLATFORM_UNSPECIFIED'
  }

  export async function setupUser(): Promise<string> {
    if (cachedProjectId) {
      return cachedProjectId
    }

    const envProjectId = process.env["GOOGLE_CLOUD_PROJECT"]
    if (envProjectId) {
      cachedProjectId = envProjectId
      return envProjectId
    }

    const client = await getOAuthClient()
    
    try {
      const loadRes = await loadCodeAssist(client, envProjectId)
      
      if (!loadRes.allowedTiers || loadRes.allowedTiers.length === 0) {
        throw new Error('No available tiers for Code Assist. Your account may not have access.')
      }
      
      const defaultTier = loadRes.allowedTiers.find(tier => tier.isDefault)
      const selectedTier = defaultTier || loadRes.allowedTiers[0]
      
      const projectId = loadRes.cloudaicompanionProject || envProjectId || ''
      let operation = await onboardUser(client, selectedTier.id, projectId)
      
      const maxAttempts = 12
      let attempts = 0
      
      while (!operation.done && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000))
        operation = await onboardUser(client, selectedTier.id, projectId)
        attempts++
      }
      
      if (!operation.done) {
        throw new Error('Onboarding timeout - operation did not complete')
      }
      
      if (operation.error) {
        throw new Error(`Onboarding failed: ${operation.error.message}`)
      }
      
      const resolvedProjectId = operation.response?.cloudaicompanionProject?.id
      if (!resolvedProjectId) {
        throw new Error('No project ID returned from onboarding')
      }
      
      cachedProjectId = resolvedProjectId
      return resolvedProjectId
      
    } catch (error) {
      if (error instanceof Error && error.message.includes('Workspace')) {
        throw new Error(
          'Google Workspace Account detected. Please set GOOGLE_CLOUD_PROJECT environment variable.'
        )
      }
      
      console.error('Failed to setup Code Assist:', error)
      
      const fallbackProjectId = 'elegant-machine-vq6tl'
      cachedProjectId = fallbackProjectId
      return fallbackProjectId
    }
  }

  export async function getProjectId(): Promise<string> {
    return setupUser()
  }
}