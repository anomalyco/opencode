import { Schema } from "effect"
import { createMemo } from "solid-js"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { useServers } from "@/runtime/server/registry"
import { recentSessionEndpoints } from "@/shell/titlebar/recent-sessions-model"

export type MessageFavoriteRole = "user" | "assistant"

/** A message the user saved, with a snapshot of its text for the favorites list. */
export type MessageFavorite = {
  readonly server: string
  readonly sessionID: string
  readonly messageID: string
  /** The prompt row that owns the message, used to scroll an assistant favorite into view. */
  readonly anchorID?: string
  readonly role: MessageFavoriteRole
  readonly text: string
  readonly created: number
  readonly favorited: number
}

export type MessageFavoriteTarget = Pick<MessageFavorite, "server" | "sessionID" | "messageID">

const MessageFavorites = Persistence.struct({
  messages: Persistence.array(
    Persistence.struct({
      server: Schema.String,
      sessionID: Schema.String,
      messageID: Schema.String,
      anchorID: Schema.optional(Schema.String),
      role: Schema.Literals(["user", "assistant"]),
      text: Schema.String,
      created: Schema.Number,
      favorited: Schema.Number,
    }),
  ),
})

// A message is shown as a short snippet in the list, so a long answer does not bloat local storage.
const MAX_TEXT = 4_000

const separator = "\u0000"

function favoriteKey(target: MessageFavoriteTarget) {
  return `${target.server}${separator}${target.sessionID}${separator}${target.messageID}`
}

export function hasMessageFavorite(messages: readonly MessageFavorite[], target: MessageFavoriteTarget) {
  const key = favoriteKey(target)

  return messages.some((message) => favoriteKey(message) === key)
}

/** Adds a favorite once; favoriting an already saved message keeps its original place. */
export function addMessageFavorite(messages: readonly MessageFavorite[], favorite: MessageFavorite) {
  if (hasMessageFavorite(messages, favorite)) return [...messages]

  return [...messages, { ...favorite, text: favorite.text.slice(0, MAX_TEXT) }]
}

export function removeMessageFavorite(messages: readonly MessageFavorite[], target: MessageFavoriteTarget) {
  const key = favoriteKey(target)

  return messages.filter((message) => favoriteKey(message) !== key)
}

/** Drops every favorite of a deleted session, including its assistant messages. */
export function forgetSessionFavorites(
  messages: readonly MessageFavorite[],
  server: string,
  sessionID: string,
) {
  return messages.filter((message) => message.server !== server || message.sessionID !== sessionID)
}

export type MessageFavorites = ReturnType<typeof createMessageFavorites>

/** Saved messages, local to this desktop like pinned sessions. */
export function createMessageFavorites() {
  const servers = useServers()
  const endpoints = createMemo(() => recentSessionEndpoints(servers.list, servers.ownUrl()))
  // The same server can be reached by more than one route; favorites follow the endpoint, as pins do.
  const normalize = (server: string) => endpoints().get(server) ?? server

  const [state, set, , ready] = persisted({ ...Persist.global("session.favorites"), sync: true }, MessageFavorites, {
    messages: [],
  })

  // A favorite saved before the server list loaded can hold the raw connection key. Compare every stored entry
  // through the current endpoint map so it still matches the server's normalized key.
  const saved = (message: MessageFavorite): MessageFavorite => ({ ...message, server: normalize(message.server) })

  return {
    ready,
    has(server: string, sessionID: string, messageID: string) {
      const key = favoriteKey({ server: normalize(server), sessionID, messageID })

      return state.messages.some((message) => favoriteKey(saved(message)) === key)
    },
    list(server: string, sessionID: string) {
      const normalized = normalize(server)

      return state.messages
        .filter((message) => normalize(message.server) === normalized && message.sessionID === sessionID)
        .toSorted((a, b) => b.favorited - a.favorited)
    },
    forget(server: string, sessionID: string) {
      const normalized = normalize(server)

      set("messages", (messages) =>
        forgetSessionFavorites(messages.map(saved), normalized, sessionID),
      )
    },
    toggle(input: Omit<MessageFavorite, "server" | "favorited"> & { server: string; favorited?: number }) {
      const favorite = saved({ ...input, favorited: input.favorited ?? Date.now() })

      set("messages", (messages) => {
        const key = favoriteKey(favorite)
        const exists = messages.some((message) => favoriteKey(saved(message)) === key)

        return exists
          ? messages.filter((message) => favoriteKey(saved(message)) !== key)
          : addMessageFavorite(messages, favorite)
      })
    },
  }
}
