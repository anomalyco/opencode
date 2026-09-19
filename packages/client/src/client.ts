import type { Attachment } from "@opencode-ai/schema/attachment"
import { ClientError } from "./generated/client-error"
import { make, type ClientOptions, type RequestOptions } from "./generated/client"

export type { ClientOptions, RequestOptions }

export type AttachmentUploadInput = {
  readonly sessionID: string
  readonly file: Blob | ReadableStream<Uint8Array>
  readonly name?: string
  readonly mime?: string
}

type AttachmentUploadResponse = { readonly data: Attachment.Info } | { readonly _tag: string; readonly message: string }

function create(options: ClientOptions) {
  const client = make(options)
  return {
    ...client,
    sessions: {
      ...client.sessions,
      attachment: (input: AttachmentUploadInput, requestOptions?: RequestOptions) =>
        upload(options, input, requestOptions),
    },
  }
}

export { create as make }

async function upload(options: ClientOptions, input: AttachmentUploadInput, requestOptions?: RequestOptions) {
  const url = new URL(`/api/session/${encodeURIComponent(input.sessionID)}/attachment`, options.baseUrl)
  const headers = new Headers(options.headers)
  new Headers(requestOptions?.headers).forEach((value, key) => headers.set(key, value))
  headers.delete("content-type")
  const name = input.name ?? (input.file instanceof File ? input.file.name : "attachment")
  const body = multipart(input.file, name, input.mime)
  if (body.type) headers.set("content-type", body.type)
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    signal: requestOptions?.signal,
    headers,
    body: body.value,
    duplex: body.type ? "half" : undefined,
  }
  const response = await (options.fetch ?? globalThis.fetch)(url, init).catch((cause) => {
    throw new ClientError("Transport", { cause })
  })
  return decode(response)
}

async function decode(response: Response) {
  if ([400, 401, 404, 413, 500].includes(response.status)) throw await json<AttachmentUploadResponse>(response)
  if (response.status === 200) {
    const value = await json<AttachmentUploadResponse>(response)
    if ("data" in value) return value.data
    throw new ClientError("MalformedResponse")
  }
  await response.body?.cancel().catch(() => undefined)
  throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
}

function multipart(file: Blob | ReadableStream<Uint8Array>, name: string, mime?: string) {
  if (file instanceof Blob) {
    const form = new FormData()
    form.append("file", file.slice(0, file.size, mime ?? file.type), name)
    return { value: form, type: undefined }
  }
  const boundary = `opencode-${crypto.randomUUID()}`
  const encoder = new TextEncoder()
  const reader = file.getReader()
  const state = { head: false, done: false }
  const safe = name.replace(/["\\\r\n]/g, "_")
  const head = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safe}"\r\nContent-Type: ${mime ?? "application/octet-stream"}\r\n\r\n`,
  )
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
  return {
    type: `multipart/form-data; boundary=${boundary}`,
    value: new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!state.head) {
          state.head = true
          controller.enqueue(head)
          return
        }
        const chunk = await reader.read()
        if (!chunk.done) {
          controller.enqueue(chunk.value)
          return
        }
        if (state.done) return
        state.done = true
        controller.enqueue(tail)
        controller.close()
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    }),
  }
}

async function json<A>(response: Response): Promise<A> {
  const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (type !== "application/json" && !type?.endsWith("+json")) {
    await response.body?.cancel().catch(() => undefined)
    throw new ClientError("UnsupportedContentType")
  }
  const text = await response.text().catch((cause) => {
    throw new ClientError("Transport", { cause })
  })
  if (!text) throw new ClientError("MalformedResponse")
  return Promise.resolve(text)
    .then((value) => {
      // SAFETY: The endpoint-specific caller supplies the wire response type, matching the generated client parser.
      return JSON.parse(value) as A
    })
    .catch((cause) => {
      throw new ClientError("MalformedResponse", { cause })
    })
}
