export function shouldUseV2NewSessionPage(input: { channel?: "dev" | "beta" | "prod"; sessionID?: string }) {
  return input.channel !== "prod" && !input.sessionID
}
