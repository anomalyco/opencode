import { encode, renderUnicodeCompact } from "uqr"

type QrOptions = {
  border?: number
  // Literal black and white, so a light terminal does not invert the modules.
  // Pairing leaves this off and keeps the theme foreground and background.
  contrast?: boolean
}

export function renderQr(data: string, options?: QrOptions) {
  const border = options?.border
  const text = renderUnicodeCompact(data, border === undefined ? undefined : { border })
  if (!options?.contrast) return text
  return text
    .split("\n")
    .map((line) => `\x1b[38;2;255;255;255;48;2;0;0;0m${line}\x1b[0m`)
    .join("\n")
}

// Device-code attempts set device. Loopback redirects leave it unset, and a
// non-TTY CLI prints the plain URL instead of the QR.
export function renderAuthQr(
  url: string,
  options: { device?: boolean; tty?: boolean; columns?: number; rows?: number; contrast?: boolean },
) {
  if (!options.device || options.tty === false) return
  const encoded = encode(url, { border: 4 })
  if (options.columns !== undefined && encoded.size > options.columns) return
  if (options.rows !== undefined && Math.ceil(encoded.size / 2) > options.rows) return
  return renderQr(url, { border: 4, contrast: options.contrast })
}
