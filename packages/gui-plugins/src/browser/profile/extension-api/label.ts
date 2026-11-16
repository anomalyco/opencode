/** Extension-supplied text on a browser-owned surface must fit one line and cannot reorder adjacent labels. */
export function extensionLabel(text: string) {
  return text.slice(0, 256).replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu, " ").trim().slice(0, 128)
}
