export function parseCliVersion(output: string) {
  const marker = output.lastIndexOf(" v")
  const version = marker === -1 ? output : output.slice(marker + 2)
  if (!version) throw new Error("V2 CLI did not provide a version")
  return version
}
