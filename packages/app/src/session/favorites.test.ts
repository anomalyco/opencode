import { expect, test } from "bun:test"
import {
  addMessageFavorite,
  forgetSessionFavorites,
  hasMessageFavorite,
  removeMessageFavorite,
  type MessageFavorite,
} from "./favorites"

const saved: MessageFavorite = {
  server: "server",
  sessionID: "session",
  messageID: "message",
  role: "assistant",
  text: "An important answer",
  created: 1,
  favorited: 2,
}

test("adds a message once and keeps the original position", () => {
  const one = addMessageFavorite([], saved)
  const twice = addMessageFavorite(one, { ...saved, favorited: 3, text: "Changed" })

  expect(twice).toEqual(one)
  expect(hasMessageFavorite(twice, saved)).toBeTrue()
})

test("removes only the matching message", () => {
  const other = { ...saved, messageID: "other" }
  const messages = addMessageFavorite(addMessageFavorite([], saved), other)

  expect(removeMessageFavorite(messages, saved)).toEqual([other])
  expect(hasMessageFavorite(removeMessageFavorite(messages, saved), saved)).toBeFalse()
})

test("forgets every favorite of a deleted session, including assistant answers", () => {
  const otherSession = { ...saved, sessionID: "other" }
  const otherServer = { ...saved, server: "elsewhere" }
  const messages = addMessageFavorite(addMessageFavorite([], saved), otherSession)
  messages.push(otherServer)

  expect(forgetSessionFavorites(messages, "server", "session")).toEqual([otherSession, otherServer])
})
