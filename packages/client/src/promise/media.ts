import type { make, RequestOptions } from "./client.js"
import type { MessageListInput, SessionInboxListInput, SessionMessageGetInput } from "./generated/types.js"

const MEDIA_URI_CAPABILITY = "experimental-media-uri"

const CAPABILITIES_HEADER = "X-OpenCode-Capabilities"

const MEDIA_REF = /^media:([0-9a-f]{64})$/

/** `mediaRefs: false` reads stored media as inline bytes, for callers such as export that need self-contained messages. */
export type MediaRequestOptions = RequestOptions & { readonly mediaRefs?: false }

/** The blob hash in a `media:<hash>` ref, the only form the server sends stored media in. */
export function mediaHashFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined

  return MEDIA_REF.exec(uri)?.[1]
}

/**
 * Opts a client into the experimental `experimental-media-uri` capability: while `experimental.media_blob` is on,
 * stored media comes back as `media:<hash>` refs, whose bytes `experimental.media.get` reads.
 *
 * Only the message and inbox reads can return refs, so only they carry the capability.
 * A custom header makes a cross-origin request preflighted, which every other request must keep avoiding.
 */
export function withMediaRefs(api: ReturnType<typeof make>) {
  return {
    ...api,
    message: {
      ...api.message,
      list: (input: MessageListInput, options?: MediaRequestOptions) =>
        api.message.list(input, mediaRefOptions(options)),
    },
    session: {
      ...api.session,
      message: {
        ...api.session.message,
        get: (input: SessionMessageGetInput, options?: MediaRequestOptions) =>
          api.session.message.get(input, mediaRefOptions(options)),
      },
      inbox: {
        ...api.session.inbox,
        list: (input: SessionInboxListInput, options?: MediaRequestOptions) =>
          api.session.inbox.list(input, mediaRefOptions(options)),
      },
    },
  }
}

function mediaRefOptions(options: MediaRequestOptions | undefined): RequestOptions | undefined {
  if (options?.mediaRefs === false) return options
  const headers = new Headers(options?.headers)
  headers.set(CAPABILITIES_HEADER, MEDIA_URI_CAPABILITY)

  return { ...options, headers }
}
