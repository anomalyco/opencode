/**
 * Hand-written file helpers for the Kortix OpenCode SDK.
 *
 * The auto-generated `File.upload()` method doesn't handle multipart/form-data
 * properly — the OpenAPI codegen can't represent file uploads. This module
 * provides a working `uploadFiles()` that constructs proper FormData requests.
 *
 * The generated `File.delete()`, `File.mkdir()`, and `File.rename()` methods
 * work correctly and don't need wrappers.
 */

export type UploadResult = { path: string; size: number }

export type UploadFilesOptions = {
  /** Base URL of the OpenCode server (e.g. "http://localhost:4096") */
  baseUrl: string
  /**
   * Files to upload. Each entry maps a target relative path to the file data.
   * Example: `{ "src/image.png": file, "README.md": "# Hello" }`
   */
  files: Record<string, File | Blob | string>
  /** Optional target directory — files will be placed there using their original field names */
  targetDir?: string
  /** Optional fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof globalThis.fetch
  /** Optional extra headers */
  headers?: Record<string, string>
}

/**
 * Upload one or more files to the OpenCode server via multipart/form-data.
 *
 * @example
 * ```ts
 * // Upload a single file by path
 * const results = await uploadFiles({
 *   baseUrl: "http://localhost:4096",
 *   files: { "src/hello.txt": new File(["hello"], "hello.txt") },
 * })
 *
 * // Upload multiple files into a target directory
 * const results = await uploadFiles({
 *   baseUrl: "http://localhost:4096",
 *   files: {
 *     "file": new File(["a"], "a.txt"),
 *     "file2": new File(["b"], "b.txt"),
 *   },
 *   targetDir: "uploads",
 * })
 * ```
 */
export async function uploadFiles(options: UploadFilesOptions): Promise<UploadResult[]> {
  const fetchFn = options.fetch ?? globalThis.fetch
  const form = new FormData()

  if (options.targetDir) {
    form.append("path", options.targetDir)
  }

  for (const [key, value] of Object.entries(options.files)) {
    if (typeof value === "string") {
      form.append(key, new Blob([value], { type: "text/plain" }), key)
    } else {
      form.append(key, value, value instanceof globalThis.File ? value.name : key)
    }
  }

  const res = await fetchFn(`${options.baseUrl}/file/upload`, {
    method: "POST",
    body: form,
    headers: options.headers,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Upload failed (${res.status}): ${text || res.statusText}`)
  }

  return res.json()
}

export type DeleteFileOptions = {
  baseUrl: string
  path: string
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}

/**
 * Delete a file or directory on the OpenCode server.
 *
 * @example
 * ```ts
 * await deleteFile({ baseUrl: "http://localhost:4096", path: "src/old.ts" })
 * ```
 */
export async function deleteFile(options: DeleteFileOptions): Promise<boolean> {
  const fetchFn = options.fetch ?? globalThis.fetch

  const res = await fetchFn(`${options.baseUrl}/file`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify({ path: options.path }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Delete failed (${res.status}): ${text || res.statusText}`)
  }

  return res.json()
}

export type MkdirOptions = {
  baseUrl: string
  path: string
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}

/**
 * Create a directory on the OpenCode server (recursive, idempotent).
 *
 * @example
 * ```ts
 * await mkdirFile({ baseUrl: "http://localhost:4096", path: "src/new-dir" })
 * ```
 */
export async function mkdirFile(options: MkdirOptions): Promise<boolean> {
  const fetchFn = options.fetch ?? globalThis.fetch

  const res = await fetchFn(`${options.baseUrl}/file/mkdir`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify({ path: options.path }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Mkdir failed (${res.status}): ${text || res.statusText}`)
  }

  return res.json()
}

export type RenameFileOptions = {
  baseUrl: string
  from: string
  to: string
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}

/**
 * Rename or move a file/directory on the OpenCode server.
 *
 * @example
 * ```ts
 * await renameFile({ baseUrl: "http://localhost:4096", from: "old.ts", to: "new.ts" })
 * ```
 */
export async function renameFile(options: RenameFileOptions): Promise<boolean> {
  const fetchFn = options.fetch ?? globalThis.fetch

  const res = await fetchFn(`${options.baseUrl}/file/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify({ from: options.from, to: options.to }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Rename failed (${res.status}): ${text || res.statusText}`)
  }

  return res.json()
}
