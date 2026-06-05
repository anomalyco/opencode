/** Inline new-session content width — keep in sync with session composer `placement === "inline"`. */
export const NEW_SESSION_CONTENT_WIDTH = "w-full max-w-[720px] px-0"

export function shouldUseV2NewSessionPage(input: { newLayoutDesigns: boolean; sessionID?: string }) {
  return input.newLayoutDesigns && !input.sessionID
}
