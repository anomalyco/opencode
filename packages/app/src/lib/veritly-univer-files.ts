const OFFICE_PATH = /\.(xlsx|xlsm|xls|csv|docx|doc|odt|pptx|ppt|odp)$/i

function resolveFilesApiBase(): string {
  const fromEnv = import.meta.env.VITE_VERITLY_UNIVER_FILES_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, "")
  return import.meta.env.DEV ? "http://127.0.0.1:8789" : "http://127.0.0.1:8789"
}

function projectIdFromEnv(): string {
  return import.meta.env.VITE_VERITLY_PROJECT_ID?.trim() || "default"
}

function projectId(input?: string): string {
  const clean = input?.trim()
  if (clean) return clean
  return projectIdFromEnv()
}

export function isUniverOfficePath(workspaceRelativePath: string): boolean {
  return OFFICE_PATH.test(workspaceRelativePath)
}

export async function uploadOfficeFile(
  workspaceRelativePath: string,
  base64Content: string,
  mimeType?: string,
  options?: { projectId?: string },
) {
  const base = resolveFilesApiBase()
  const res = await fetch(new URL("/v1/files/upload-office", `${base}/`), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-veritly-project-id": projectId(options?.projectId),
    },
    body: JSON.stringify({
      path: workspaceRelativePath,
      content: base64Content,
      mimeType,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`office upload failed ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

export async function registerOfficeUnit(workspaceRelativePath: string, unitId: string, options?: { projectId?: string }) {
  const base = resolveFilesApiBase()
  const res = await fetch(new URL("/v1/files/register-unit", `${base}/`), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-veritly-project-id": projectId(options?.projectId),
    },
    body: JSON.stringify({ path: workspaceRelativePath, unitId }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`office register-unit failed ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<{ ok: boolean; path: string; unitId: string }>
}

export async function readOfficeFile(workspaceRelativePath: string, options?: { projectId?: string }) {
  const base = resolveFilesApiBase()
  const url = new URL("/v1/files/content", `${base}/`)
  url.searchParams.set("path", workspaceRelativePath)
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "x-veritly-project-id": projectId(options?.projectId),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`office read failed ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<{
    type: "binary"
    encoding: "base64"
    content: string
    mimeType?: string
    unitId?: string
    unitKind?: "sheet" | "doc" | "slide"
  }>
}

export async function resolveOfficeFile(workspaceRelativePath: string, options?: { projectId?: string }) {
  const base = resolveFilesApiBase()
  const url = new URL("/v1/files/resolve", `${base}/`)
  url.searchParams.set("path", workspaceRelativePath)
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "x-veritly-project-id": projectId(options?.projectId),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`office resolve failed ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<
    | { kind: "opencode"; path: string }
    | { kind: "univer"; path: string; unitId: string; unitKind: "sheet" | "doc" | "slide"; unitType: number }
  >
}

export async function listOfficeFiles(dirPath: string, options?: { projectId?: string }) {
  const base = resolveFilesApiBase()
  const url = new URL("/v1/files/list", `${base}/`)
  url.searchParams.set("path", dirPath)
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "x-veritly-project-id": projectId(options?.projectId),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`office list failed ${res.status}: ${text.slice(0, 300)}`)
  }
  const body = (await res.json()) as { data?: Array<{ path: string; name: string; type: "file" | "directory" }> }
  return body.data ?? []
}
