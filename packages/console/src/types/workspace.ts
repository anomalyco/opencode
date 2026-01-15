// Workspace 数据模型
export interface WorkspaceConfig {
  id: string // ULID
  name: string // "My Todo App"
  rootPath: string // "/Users/foo/projects/my-app"
  createdAt: string // ISO timestamp
  updatedAt: string

  // UI state (localStorage)
  activeSessions: string[] // [sessionId1, sessionId2]
  currentSessionId?: string

  // AF metadata (optional, 仅 deploy 后才有)
  afWorkspaceId?: string // AF 云端 workspace ID
  lastDeployedAt?: string
  lastDeployedArtifactId?: string
}

export interface WorkspaceState {
  devServer: DevServerState
  files: FileTreeNode[] // 文件树缓存
  openFiles: string[] // 当前打开的文件路径
  unsavedChanges: Map<string, string> // path -> content
}

export interface DevServerState {
  status: 'stopped' | 'starting' | 'running' | 'error'
  port?: number
  url?: string // "http://localhost:3000"
  pid?: number
  logs: LogEntry[]
  lastError?: string
}

export interface LogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}
