export function shouldUseV2NewSessionPage(input: { newLayoutDesigns: boolean; sessionID?: string }) {
  return input.newLayoutDesigns && !input.sessionID
}
