export function parseCliVersion(output: string) {
  const marker = output.lastIndexOf(" v")
  const version = marker === -1 ? output : output.slice(marker + 2)

  if (!version) throw new Error("V2 CLI did not provide a version")

  return version
}

export function serviceVersion(input: {
  readonly channel: "local" | "dev" | "beta" | "prod"
  readonly isolated?: boolean
  readonly mode: "initial" | "reconnect"
  readonly version: string
}) {
  if (input.mode === "reconnect") return undefined

  if (input.channel === "beta" && !input.isolated) return undefined

  return input.version
}

// Retrying on timeout can also replace a server stuck in a migration longer than 120 s, which is accepted.
export function shouldRetryEnsure(version: string | undefined, message: string) {
  if (version !== undefined) return false

  return (
    message === "Background service failed to start" ||
    message === "Timed out waiting for the background service to start"
  )
}

export function stageName(version: string, channel: string, arch = process.arch) {
  return `${version}-${arch}-${channel}`.replace(/[^a-zA-Z0-9._-]/g, "-")
}

export function stageRetention(runningVersion: string, arch = process.arch) {
  // The registration omits the CLI channel, including for a server still using a legacy stage.
  const legacy = `${runningVersion}-${arch}`.replace(/[^a-zA-Z0-9._-]/g, "-")

  return { keep: [legacy], keepPrefix: `${legacy}-` }
}
