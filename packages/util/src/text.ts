/** `text.slice(0, length)`, one shorter when the cut would split an emoji (a UTF-16 surrogate pair). */
export function firstChars(text: string, length: number) {
  const code = text.charCodeAt(length - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? length - 1 : length)
}

/** The last `length` characters of `text`, one fewer when the cut would split an emoji (a UTF-16 surrogate pair). */
export function lastChars(text: string, length: number) {
  const start = Math.max(0, text.length - length)
  const code = text.charCodeAt(start)
  return text.slice(code >= 0xdc00 && code <= 0xdfff ? start + 1 : start)
}
