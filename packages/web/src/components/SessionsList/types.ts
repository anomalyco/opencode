export interface SessionData {
  id: string
  title?: string
  time: {
    created: number
    updated: number
  }
  version?: string
  exportedAt?: number
  computedData: {
    rootDir?: string
    created: number
    completed?: number
    models: Record<string, string[]>
    cost: number
    tokens: {
      input: number
      output: number
      reasoning: number
    }
  }
}

export interface SessionsListProps {
  sessions: SessionData[]
  title: string
  emptyMessage: string
  helpText?: string
  error?: string | null
  apiUrl?: string
  basePath?: string
}