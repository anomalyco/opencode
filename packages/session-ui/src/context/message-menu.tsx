import { createContext, useContext, type JSX } from "solid-js"

/** The message a `MessageMenu` item acts on. Every field is a getter over the live message. */
export type MessageMenuTarget = {
  readonly id: string
  readonly role: "user" | "assistant"
  /** The text the menu's Copy copies. */
  readonly text: string
}

/**
 * Host items for each message's More actions menu. A row renders `items` only inside its open menu, so a closed menu
 * costs nothing; a reply, which has no menu of its own, adds one only while `active()` is true. Without this provider
 * menus show only their own items.
 */
export type MessageMenu = {
  /** Whether any items are contributed. Reactive. */
  readonly active: () => boolean
  /** Renders the items inside an open menu. `shown` is whether the menu is open. */
  readonly items: (message: MessageMenuTarget, shown: () => boolean) => JSX.Element
}

const context = createContext<MessageMenu>()

export const MessageMenuProvider = context.Provider

export const useMessageMenu = () => useContext(context)
