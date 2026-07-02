export function sessionV2CommandMode(input: { newLayoutDesigns: boolean; sessionID: string | undefined }) {
  return input.newLayoutDesigns && !!input.sessionID
}
