import type { ModelMessage } from "ai"
import type * as Provider from "./provider"

export interface VisionProxyConfig {
  model: string
  prompt?: string
}

const DEFAULT_VISION_PROMPT =
  "Describe this image in detail for a text-only AI model. Include all visible text (exact wording, including error messages, labels, buttons), layout and structure, colours and visual styling, any data or numbers visible, and the apparent context. Be thorough — omit nothing visible."

interface ImageLike {
  type: string
  image?: unknown
  url?: string
  mediaType?: string
  filename?: string
}

function extractImageData(part: ImageLike): string | null {
  if (part.type === "image") {
    const imageStr = String(part.image)
    if (imageStr.startsWith("data:")) return imageStr
    return `data:image/png;base64,${imageStr}`
  }
  if (part.type === "file" && part.mediaType?.startsWith("image/")) {
    const url = String(part.url)
    if (url.startsWith("data:")) return url
    return url
  }
  return null
}

function getVisionProxyConfig(options: Record<string, unknown>): VisionProxyConfig | null {
  const raw = options?.vision_proxy
  if (!raw || typeof raw !== "object") return null
  const cfg = raw as VisionProxyConfig
  if (!cfg.model || typeof cfg.model !== "string") return null
  return { model: cfg.model, prompt: cfg.prompt || DEFAULT_VISION_PROMPT }
}

async function describeImage(
  imageDataUrl: string,
  proxyConfig: VisionProxyConfig,
  baseURL: string,
  apiKey: string,
): Promise<string | null> {
  const url = baseURL.endsWith("/v1")
    ? `${baseURL}/chat/completions`
    : baseURL.endsWith("/")
      ? `${baseURL}v1/chat/completions`
      : `${baseURL}/v1/chat/completions`
  const body = {
    model: proxyConfig.model,
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: proxyConfig.prompt! },
          { type: "image_url" as const, image_url: { url: imageDataUrl } },
        ],
      },
    ],
    max_tokens: 2000,
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText)
    return `[Vision proxy error: ${resp.status} ${text}]`
  }

  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === "string" && content.length > 0) return content
  return null
}

export async function proxyUnsupportedImages(
  msgs: ModelMessage[],
  model: Provider.Model,
  providerOptions: Record<string, unknown> | undefined,
  providerInfo: { api?: { url?: string }; options?: { apiKey?: string; baseURL?: string } } | undefined,
): Promise<ModelMessage[]> {
  if (model.capabilities.input.image) return msgs

  const proxyConfig = getVisionProxyConfig(providerOptions ?? {})
  if (!proxyConfig) return msgs

  const baseURL = providerInfo?.options?.baseURL || providerInfo?.api?.url || "https://openrouter.ai/api"
  const apiKey = providerInfo?.options?.apiKey || ""
  if (!apiKey) return msgs

  const result: ModelMessage[] = []
  for (const msg of msgs) {
    if (msg.role !== "user" || typeof msg.content === "string" || !Array.isArray(msg.content)) {
      result.push(msg)
      continue
    }

    const newContent: unknown[] = []
    let hadImages = false
    for (const part of msg.content as unknown[]) {
      const imageLike = part as ImageLike
      const imageData = extractImageData(imageLike)
      if (imageData) {
        hadImages = true
        const description = await describeImage(imageData, proxyConfig, baseURL, apiKey)
        if (description) {
          newContent.push({
            type: "text",
            text: `[Image description from vision proxy (${proxyConfig.model})]:\n${description}`,
          })
        } else {
          newContent.push({
            type: "text",
            text: "[Image was provided but vision proxy could not describe it.]",
          })
        }
      } else {
        newContent.push(part)
      }
    }

    if (hadImages) {
      result.push({ ...msg, content: newContent } as ModelMessage)
    } else {
      result.push(msg)
    }
  }

  return result
}
