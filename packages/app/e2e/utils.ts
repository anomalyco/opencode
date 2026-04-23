import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { base64Encode, checksum } from "@opencode-ai/util/encode"

export const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
export const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"

export const serverUrl = `http://${serverHost}:${serverPort}`
export const serverName = `${serverHost}:${serverPort}`

const localHosts = ["127.0.0.1", "localhost"]

const serverLabels = (() => {
  const url = new URL(serverUrl)
  if (!localHosts.includes(url.hostname)) return [serverName]
  return localHosts.map((host) => `${host}:${url.port}`)
})()

export const serverNames = [...new Set(serverLabels)]

export const serverUrls = serverNames.map((name) => `http://${name}`)

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const serverNamePattern = new RegExp(`(?:${serverNames.map(escape).join("|")})`)

export const modKey = process.platform === "darwin" ? "Meta" : "Control"
export const terminalToggleKey = "Control+Backquote"

export function createSdk() {
  return createOpencodeClient({ baseUrl: serverUrl, throwOnError: true })
}

// Get the current project info from server
// In stateless architecture, this returns the first available project
// or creates one if none exists
export async function getCurrentProject() {
  const sdk = createSdk()
  
  // List projects and use the first one, or create if none
  const projectsResult = await sdk.project.list({ limit: 1 })
  const projects = projectsResult.data ?? []
  
  if (projects.length > 0) {
    const project = projects[0]
    return {
      id: project.id,
      directory: `/projects/${project.id}`,
    }
  }
  
  // No projects exist - create one
  return createProject("E2E Test Project")
}

// Create a new database project via API
export async function createProject(name: string) {
  const sdk = createSdk()
  const result = await sdk.project.create({ name })
  if (!result.data?.id) throw new Error("Failed to create project")
  
  return {
    id: result.data.id,
    directory: `/projects/${result.data.id}`,
    slug: `proj_${result.data.id.slice(0, 8)}`,
  }
}

// Build URL path for a project
export function projectPath(projectId: string) {
  return `/projects/${projectId}`
}

// Build URL path for a session within a project
export function sessionPath(projectId: string, sessionID?: string) {
  return `${projectPath(projectId)}/session${sessionID ? `/${sessionID}` : ""}`
}

// Legacy compatibility - now just returns the project path
export function dirSlug(directory: string) {
  // If it's already a project path, encode it
  if (directory.startsWith("/projects/")) {
    return base64Encode(directory)
  }
  return base64Encode(directory)
}

// Legacy compatibility
export function dirPath(directory: string) {
  return `/${dirSlug(directory)}`
}

export function workspacePersistKey(directory: string, key: string) {
  const head = (directory.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(directory) ?? "0"
  return `opencode.workspace.${head}.${sum}.dat:workspace:${key}`
}

// Legacy compatibility: resolveDirectory now just returns the project path
// since there's no local filesystem to resolve
export async function resolveDirectory(directory: string) {
  return directory
}
