export function isRootSession(session: { parentID?: string | null }) {
  return !session.parentID
}
