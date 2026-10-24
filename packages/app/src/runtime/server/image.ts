import { getDirectory, getFilename } from "@opencode/util/path"
import type { OpenCodeClient } from "@opencode/client/promise"

const types = new Map([
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
])

export async function readLocalImage(
  api: Pick<OpenCodeClient, "file">,
  directory: string,
  path: string,
  signal: AbortSignal,
): Promise<Blob | undefined> {
  const drive = /^[a-z]:\//i.test(path)

  if (/^[\\/]{2}/.test(path) || (!drive && /^[a-z][a-z\d+.-]*:/i.test(path))) return
  const type = types.get(path.match(/\.([^./]+)$/)?.[1]?.toLowerCase() ?? "")

  if (!type) return
  // A single leading separator is drive-root-relative on Windows, which reads from the process drive instead
  // of the project; a URL-style reference names a file under the workspace directory. Double separators are
  // UNC paths, and full drive paths stay absolute.
  const windows = /^[a-z]:[/\\]/i.test(directory) || directory.startsWith("\\\\")
  const workspaceRelative = !drive && windows && /^[\\/]/.test(path) && !/^[/\\]{2}/.test(path)
  const absolute = drive || (path.startsWith("/") && !workspaceRelative)

  // Scope absolute images to their parent, including files outside the project.
  // The trailing separator from getDirectory keeps "/" and "C:/" valid, like the file model.
  const bytes = await api.file.read(
    {
      path: absolute ? getFilename(path) : workspaceRelative ? path.replace(/^[/\\]+/, "") : path,
      location: { directory: absolute ? getDirectory(path) : directory },
    },
    { signal },
  )

  return new Blob([new Uint8Array(bytes)], { type })
}
