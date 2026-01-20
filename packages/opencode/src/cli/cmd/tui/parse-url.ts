export interface ParsedAttachUrl {
  baseUrl: string
  unix?: string
}

export function parseAttachUrl(url: string): ParsedAttachUrl {
  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("unix://")) {
    throw new Error("URL must start with http://, https://, or unix://")
  }

  if (url.startsWith("unix://")) {
    const socketPath = url.substring(7) // Remove "unix://" prefix
    if (!socketPath || socketPath.trim().length === 0) {
      throw new Error("Unix socket path cannot be empty")
    }

    if (!socketPath.startsWith("/")) {
      throw new Error("Unix socket path must be absolute (start with /)")
    }

    return {
      baseUrl: "http://localhost:4096", // Placeholder for SDK URL building
      unix: socketPath,
    }
  }

  return { baseUrl: url }
}
