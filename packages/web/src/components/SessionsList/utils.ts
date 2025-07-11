import type { SessionData } from "./types"

export function getProjectPath(sessions: SessionData[]): string | null {
  const path = sessions.find((session) => session.computedData.rootDir)?.computedData.rootDir
  if (!path) return null

  const homePattern = /^\/Users\/[^\/]+|^\/home\/[^\/]+|^C:\\Users\\[^\\]+/
  return path.replace(homePattern, "~")
}

export function createGlobalFilterFn() {
  return (row: any, columnId: string, value: string) => {
    const search = value.toLowerCase()

    if (row.original.title?.toLowerCase().includes(search)) return true

    const models = Object.values(row.original.computedData.models)
    if (
      models.some(
        ([provider, model]) => provider.toLowerCase().includes(search) || model.toLowerCase().includes(search),
      )
    ) {
      return true
    }

    if (row.original.version?.toLowerCase().includes(search)) return true

    return false
  }
}