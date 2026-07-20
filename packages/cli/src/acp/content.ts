import type { ContentBlock, ContentChunk, ResourceLink, Role } from "@agentclientprotocol/sdk"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export type PromptPart =
  | { readonly type: "text"; readonly text: string; readonly synthetic?: boolean; readonly ignored?: boolean }
  | { readonly type: "file"; readonly url: string; readonly filename?: string; readonly mime: string }

export type ReplayPart = PromptPart | { readonly type: "reasoning"; readonly text: string }

export function promptContentToParts(content: readonly ContentBlock[]): PromptPart[] {
  return content.flatMap(contentBlockToParts)
}

export function contentBlockToParts(block: ContentBlock): PromptPart[] {
  switch (block.type) {
    case "text":
      return [{ type: "text", text: block.text, ...audienceFlags(block.annotations?.audience ?? undefined) }]
    case "image":
      if (block.data) {
        return [
          {
            type: "file",
            url: `data:${block.mimeType};base64,${block.data}`,
            filename: filenameFromUri(block.uri ?? undefined) ?? "image",
            mime: block.mimeType,
          },
        ]
      }
      if (block.uri?.startsWith("data:") || block.uri?.startsWith("http://") || block.uri?.startsWith("https://")) {
        return [
          {
            type: "file",
            url: block.uri,
            filename: filenameFromUri(block.uri) ?? "image",
            mime: block.mimeType,
          },
        ]
      }
      return []
    case "resource_link":
      return [resourceLinkToPart(block)]
    case "resource":
      if ("text" in block.resource) {
        try {
          const parsed = new URL(block.resource.uri)
          if (parsed.protocol === "file:") {
            const line = parsed.hash.match(/^#L(\d+)/)?.[1]
            const decoded = (() => {
              try {
                return fileURLToPath(parsed)
              } catch {
                return decodeURIComponent(parsed.pathname)
              }
            })()
            const filepath = path.sep === "\\" ? decoded.replace(/\\/g, "/") : decoded
            return [{ type: "text", text: `[${filepath}${line ? `:${line}` : ""}]\n${block.resource.text}` }]
          }
        } catch {}
        return [{ type: "text", text: `[${block.resource.uri}]\n${block.resource.text}` }]
      }
      if (!block.resource.mimeType) return []
      return [
        {
          type: "file",
          url: block.resource.uri.startsWith("data:")
            ? block.resource.uri
            : `data:${block.resource.mimeType};base64,${block.resource.blob}`,
          filename: filenameFromUri(block.resource.uri) ?? "file",
          mime: block.resource.mimeType,
        },
      ]
    default:
      return []
  }
}

export function partsToContentChunks(parts: readonly ReplayPart[]): ContentChunk[] {
  return parts.flatMap((part): ContentChunk[] => {
    if (part.type === "text") {
      if (!part.text) return []
      return [
        {
          content: {
            type: "text",
            text: part.text,
            ...(part.synthetic
              ? { annotations: { audience: ["assistant" as const] } }
              : part.ignored
                ? { annotations: { audience: ["user" as const] } }
                : {}),
          },
        },
      ]
    }
    if (part.type === "reasoning") {
      return part.text ? [{ content: { type: "text", text: part.text } }] : []
    }
    if (part.url.startsWith("file://")) {
      return [
        {
          content: {
            type: "resource_link",
            uri: part.url,
            name: part.filename ?? "file",
            mimeType: part.mime,
          },
        },
      ]
    }
    if (!part.url.startsWith("data:")) return []
    const data = decodeDataUrl(part.url)
    if (!data) return []
    if (data.mime.startsWith("image/")) {
      return [
        {
          content: {
            type: "image",
            mimeType: data.mime,
            data: data.base64,
            uri: pathToFileURL(part.filename ?? "image").href,
          },
        },
      ]
    }
    return [
      {
        content: {
          type: "resource",
          resource:
            data.mime.startsWith("text/") || data.mime === "application/json"
              ? {
                  uri: pathToFileURL(part.filename ?? "file").href,
                  mimeType: data.mime,
                  text: Buffer.from(data.base64, "base64").toString("utf8"),
                }
              : {
                  uri: pathToFileURL(part.filename ?? "file").href,
                  mimeType: data.mime,
                  blob: data.base64,
                },
        },
      },
    ]
  })
}

function resourceLinkToPart(link: ResourceLink): PromptPart {
  try {
    if (link.uri.startsWith("file://")) {
      return { type: "file", url: link.uri, filename: link.name || filenameFromUri(link.uri) || "file", mime: link.mimeType ?? "text/plain" }
    }
    if (link.uri.startsWith("zed://")) {
      const pathname = new URL(link.uri).searchParams.get("path")
      if (pathname)
        return {
          type: "file",
          url: pathToFileURL(pathname).href,
          filename: link.name || path.basename(pathname) || "file",
          mime: link.mimeType ?? "text/plain",
        }
    }
  } catch {}
  return { type: "text", text: link.uri }
}

function decodeDataUrl(url: string) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(url)
  if (!match?.[1] || match[2] === undefined) return
  return { mime: match[1], base64: match[2] }
}

function audienceFlags(audience: readonly Role[] | null | undefined) {
  if (audience?.length === 1 && audience[0] === "assistant") return { synthetic: true as const }
  if (audience?.length === 1 && audience[0] === "user") return { ignored: true as const }
  return {}
}

function filenameFromUri(uri: string | undefined) {
  if (!uri || uri.startsWith("data:")) return
  try {
    return path.basename(new URL(uri).pathname) || undefined
  } catch {
    return path.basename(uri) || undefined
  }
}

export * as ACPContent from "./content"
