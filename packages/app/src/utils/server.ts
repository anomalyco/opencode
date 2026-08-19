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

export function createApiForServer(input: { server: ServerConnection.HttpBase; fetch?: typeof globalThis.fetch }) {
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
      // The pinned App client predates the current nested prompt payload.
      async prompt(
        value: Parameters<OpenCodeClient["session"]["prompt"]>[0] & {
          selection?: {
            agent: string
            model: { providerID: string; id: string; variant?: string }
          }
        },
        options?: Parameters<OpenCodeClient["session"]["prompt"]>[1],
      ) {
        const requestHeaders = new Headers(headers)
        for (const [key, header] of new Headers(options?.headers)) requestHeaders.set(key, header)
        requestHeaders.set("content-type", "application/json")
        const response = await (input.fetch ?? globalThis.fetch)(
          new URL(`/api/session/${encodeURIComponent(value.sessionID)}/prompt`, input.server.url),
          {
            method: "POST",
            signal: options?.signal,
            headers: requestHeaders,
            body: JSON.stringify({
              id: value.id,
              prompt: {
                text: value.text,
                files: value.files?.map((file) => ({
                  uri: file.uri,
                  name: file.name,
                  description: file.description,
                  source: file.mention,
                })),
                agents: value.agents?.map((agent) => ({ name: agent.name, source: agent.mention })),
              },
              delivery: value.delivery,
              selection: value.selection,
              resume: value.resume,
            }),
          },
        ).catch((cause) => {
          throw new ClientError("Transport", { cause })
        })
        if ([409, 404, 400, 401].includes(response.status)) throw await responseJson(response)
        if (response.status !== 200) {
          await cancelBody(response)
          throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
        }
        return (await responseJson(response)).data
      },
    },
  }
}

async function responseJson(response: Response) {
  const contentType = response.headers.get("content-type")
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" && !contentType?.includes("+json")) {
    await cancelBody(response)
    throw new ClientError("UnsupportedContentType")
  }
  const text = await response.text().catch((cause) => {
    throw new ClientError("Transport", { cause })
  })
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

async function cancelBody(response: Response) {
  await response.body?.cancel().catch(() => undefined)
}

export type ServerApi = OpenCodeClient
