export type LocalPTY = {
  id: string
  title: string
  titleNumber: number
  order?: number
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
  status?: "running" | "error"
  retryCount?: number
  lastError?: {
    code?: string
    requestId?: string
    message?: string
  }
}
