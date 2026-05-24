export function shouldUseV2Settings(channel = import.meta.env.VITE_OPENCODE_CHANNEL) {
  return channel !== "prod"
}
