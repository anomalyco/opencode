import Clipboard from "@mariozechner/clipboard"

function writeOsc52(text: string) {
  if (!process.stdout.isTTY) return
  const sequence = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`
  process.stdout.write(process.env.TMUX || process.env.STY ? `\x1bPtmux;\x1b${sequence}\x1b\\` : sequence)
}

export async function read() {
  try {
    if (Clipboard.hasImage()) {
      const data = await Clipboard.getImageBase64()
      return { data, mime: "image/png" }
    }
  } catch {
    // Fall through to text.
  }
  const text = await Clipboard.getText().catch(() => undefined)
  if (text) return { data: text, mime: "text/plain" }
}

export async function write(text: string) {
  writeOsc52(text)
  await Clipboard.setText(text).catch(() => undefined)
}
