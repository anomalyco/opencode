// AF Backend API Client for deployment
import { AFArtifact, OSSUploadCredential, WebAppManifest } from '../types/deploy'

const AF_BACKEND_BASE_URL = 'https://api.agent-foundry.com' // TODO: Make configurable

export class AFBackendClient {
  private baseUrl: string
  private apiKey?: string

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl || AF_BACKEND_BASE_URL
    this.apiKey = apiKey
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`AF API Error: ${response.status} - ${errorText}`)
    }

    return response.json()
  }

  // Get OSS upload credentials for artifact
  async getUploadCredential(workspaceId: string, fileName: string): Promise<OSSUploadCredential> {
    return this.request<OSSUploadCredential>('/api/v1/artifact/upload-credential', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        fileName,
      }),
    })
  }

  // Register artifact after upload
  async createArtifact(artifact: {
    workspaceId: string
    type: 'webapp'
    name: string
    description?: string
    tags?: string[]
    storageRef: string
    manifest: WebAppManifest
  }): Promise<AFArtifact> {
    return this.request<AFArtifact>('/api/v1/artifact', {
      method: 'POST',
      body: JSON.stringify(artifact),
    })
  }

  // Publish artifact to public feed
  async publishToFeed(artifactId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/api/v1/feed/publish', {
      method: 'POST',
      body: JSON.stringify({
        artifactId,
      }),
    })
  }

  // Get artifact by ID
  async getArtifact(artifactId: string): Promise<AFArtifact> {
    return this.request<AFArtifact>(`/api/v1/artifact/${artifactId}`)
  }

  // List artifacts for workspace
  async listArtifacts(workspaceId: string): Promise<AFArtifact[]> {
    return this.request<AFArtifact[]>(`/api/v1/workspace/${workspaceId}/artifacts`)
  }
}

// Default client instance
export const afBackendClient = new AFBackendClient()

// Update API key for authentication
export function setAFApiKey(apiKey: string) {
  afBackendClient['apiKey'] = apiKey
}

// Check if API key is set
export function isAFAuthenticated(): boolean {
  return !!afBackendClient['apiKey']
}