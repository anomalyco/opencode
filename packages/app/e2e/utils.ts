import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

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

/** SDK scoped to one DB project via `x-opencode-project` (use `createOpencodeClient` for unscoped calls like `GET /project`). */
export function createSdk(project: { id: string }) {
  return createOpencodeClient({
    baseUrl: serverUrl,
    projectId: project.id,
    throwOnError: true,
  })
}

// Get the current project info from server
// In stateless architecture, this returns the first available project
// or creates one if none exists
export async function getCurrentProject() {
  const listSdk = createOpencodeClient({ baseUrl: serverUrl, throwOnError: true })
  
  // List projects and use the first one, or create if none
  const projectsResult = await listSdk.project.list({ limit: 1 })
  const projects = projectsResult.data ?? []
  
  if (projects.length > 0) {
    const project = projects[0]
    return {
      id: project.id,
      directory: project.id,
    }
  }
  
  // No projects exist - create one
  return createProject("E2E Test Project")
}

// Create a new database project via API
export async function createProject(name: string) {
  const sdk = createOpencodeClient({ baseUrl: serverUrl, throwOnError: true })
  const result = await sdk.project.create({ name })
  if (!result.data?.id) throw new Error("Failed to create project")
  
  return {
    id: result.data.id,
    directory: result.data.id,
  }
}

// Build URL path for a project
export function projectPath(projectId: string) {
  return `/${projectId}`
}

// Build URL path for a session within a project
export function sessionPath(projectId: string, sessionID?: string) {
  return `${projectPath(projectId)}/session${sessionID ? `/${sessionID}` : ""}`
}
