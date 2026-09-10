import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { ClientError, OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): ServerApi {
  const headers = input.server.password
    ? {
        Authorization: `Basic ${authTokenFromCredentials({
          username: input.server.username,
          password: input.server.password,
        })}`,
      }
    : undefined
  const client = OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers,
  })
  return {
    ...client,
    session: {
      ...client.session,
      // TODO(review): Remove this singular compatibility adapter when the app consumes the workspace Promise client.
      async attachment(value, options) {
        const form = new FormData()
        form.append("file", value.file, value.name ?? (value.file instanceof File ? value.file.name : "attachment"))
        const requestHeaders = new Headers(headers)
        new Headers(options?.headers).forEach((header, key) => requestHeaders.set(key, header))
        const response = await (input.fetch ?? globalThis.fetch)(
          new URL(`/api/session/${encodeURIComponent(value.sessionID)}/attachment`, input.server.url),
          { method: "POST", body: form, headers: requestHeaders, signal: options?.signal },
        ).catch((cause) => {
          throw new ClientError("Transport", { cause })
        })
        if (![200, 400, 401, 404, 413, 500].includes(response.status)) {
          await response.body?.cancel().catch(() => undefined)
          throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
        }
        const result: { readonly data: AttachmentInfo } | { readonly _tag: string; readonly message: string } =
          await response.json().catch((cause) => {
            throw new ClientError("MalformedResponse", { cause })
          })
        if (response.status !== 200) throw result
        if ("data" in result) return result.data
        throw new ClientError("MalformedResponse")
      },
    },
  }
}

export type AttachmentInfo = {
  readonly id: string
  readonly uri: string
  readonly name: string
  readonly mime: string
  readonly size: number
}

export type AttachmentUploadInput = {
  readonly sessionID: string
  readonly file: Blob
  readonly name?: string
}

export type ServerApi = Omit<OpenCodeClient, "session"> & {
  readonly session: OpenCodeClient["session"] & {
    attachment: (
      input: AttachmentUploadInput,
      options?: { readonly signal?: AbortSignal; readonly headers?: HeadersInit },
    ) => Promise<AttachmentInfo>
  }
}
