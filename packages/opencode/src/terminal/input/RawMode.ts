export class RawMode {
  private wasRaw = false

  enable(): void {
    if (!process.stdin.isTTY) {
      throw new Error("[RawMode.enable] stdin is not a TTY — cannot enable raw mode")
    }

    this.wasRaw = (process.stdin as NodeJS.ReadStream).isRaw ?? false
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding("utf8")
  }

  restore(): void {
    if (!process.stdin.isTTY) return
    try {
      process.stdin.setRawMode(this.wasRaw)
    } catch (err) {
      console.error("[RawMode.restore] Failed to restore raw mode:", String(err))
    }
  }
}
