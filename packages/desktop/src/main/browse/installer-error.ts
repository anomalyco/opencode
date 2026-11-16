/** The installer's last warning (`! …`), else its last line: what to tell the user. */
export function installerError(output: string) {
  const lines = output
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const line = lines.findLast((line) => line.startsWith("!")) ?? lines.at(-1)

  return line?.replace(/^!\s*/, "").replace(/^browse:\s*/, "")
}
