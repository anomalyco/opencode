import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

const localHosts = ["127.0.0.1", "localhost", "host.docker.internal"]

const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Vitest on the host calls the mapped OpenCode port on loopback while Selenium Chrome uses `PLAYWRIGHT_SERVER_HOST` (often `host.docker.internal`). */
export function serverHost() {
  const api = process.env.OPENCODE_E2E_API_HOST?.trim()
  if (api) return api
  const v = process.env.PLAYWRIGHT_SERVER_HOST?.trim()
  if (!v) return "127.0.0.1"
  return v
}

export function serverPort() {
  const v = process.env.PLAYWRIGHT_SERVER_PORT?.trim()
  if (!v) return "4096"
  return v
}

export function serverUrl() {
  return `http://${serverHost()}:${serverPort()}`
}

/** Host segment for UI labels (uses `PLAYWRIGHT_SERVER_HOST` when set; may differ from API `serverHost()` in Docker-Selenium E2E). */
export function serverUiHost() {
  const v = process.env.PLAYWRIGHT_SERVER_HOST?.trim()
  if (v) return v
  return serverHost()
}

export function serverName() {
  return `${serverUiHost()}:${serverPort()}`
}

export function serverNames() {
  const host = serverUiHost()
  const port = serverPort()
  const label = `${host}:${port}`
  if (!localHosts.includes(host)) return [label]
  return [...new Set(localHosts.map((h) => `${h}:${port}`))]
}

export function serverUrls() {
  return serverNames().map((n) => `http://${n}`)
}

export function serverNamePattern() {
  const names = serverNames()
  return new RegExp(`(?:${names.map(esc).join("|")})`)
}

export const modKey = process.platform === "darwin" ? "Meta" : "Control"

/** SDK scoped to one DB project via `x-opencode-project` (use `createOpencodeClient` for unscoped calls like `GET /project`). */
export function createSdk(project: { id: string }) {
  return createOpencodeClient({
    baseUrl: serverUrl(),
    projectId: project.id,
    throwOnError: true,
  })
}

// Get the current project info from server
// In stateless architecture, this returns the first available project
// or creates one if none exists
export async function getCurrentProject() {
  const listSdk = createOpencodeClient({ baseUrl: serverUrl(), throwOnError: true })

  // List projects and use the first one, or create if none
  const projectsResult = await listSdk.project.list()
  const projects = (projectsResult.data ?? []).filter((p) => !!p?.id)

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
  const sdk = createOpencodeClient({ baseUrl: serverUrl(), throwOnError: true })
  const result = await sdk.project.create({ name })
  if (!result.data?.project?.id) throw new Error("Failed to create project")

  return {
    id: result.data.project.id,
    directory: result.data.project.id,
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
