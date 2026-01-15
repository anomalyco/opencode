// Deploy to Agent Foundry types

export interface AFDeployConfig {
  workspaceId: string
  name: string // "My Todo App v1.2"
  description?: string
  tags?: string[]
  env: 'dev' | 'staging' | 'prod'
}

export interface AFDeployResult {
  artifactId: string // AF artifact ID
  bundleUrl: string // OSS URL: "https://af-oss.aliyuncs.com/bundles/{id}.tar.gz"
  shareUrl: string // AF share URL: "https://app.agent-foundry.com/a/{id}"
  version: string // "1.0.0"
}

export interface BuildResult {
  distPath: string
  success: boolean
  buildLog?: string
  error?: string
}

export interface BundleResult {
  bundlePath: string
  success: boolean
  error?: string
}

export interface OSSUploadCredential {
  accessKeyId: string
  accessKeySecret: string
  securityToken: string
  bucket: string
  region: string
  ossKey: string // "bundles/{workspaceId}.tar.gz"
  publicUrl: string
}

export interface AFArtifact {
  id: string
  workspaceId: string
  type: 'webapp'
  name: string
  description?: string
  tags?: string[]
  storageRef: string // OSS key
  version: string
  manifest: WebAppManifest
  createdAt: string
  updatedAt: string
}

export interface WebAppManifest {
  bundleUrl: string
  entryPoint: string // 'index.html'
  capacitorConfig?: {
    plugins: string[]
  }
}

export interface DeployProgress {
  step: 'building' | 'bundling' | 'uploading' | 'registering' | 'publishing' | 'completed' | 'error'
  message: string
  progress: number // 0-100
  error?: string
}

// Deploy state for React hook
export interface DeployState {
  isDeploying: boolean
  progress: DeployProgress | null
  lastDeployResult: AFDeployResult | null
  error: string | null
}