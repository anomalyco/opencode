export function looksLikeSessionID(value: string) {
  return value.length > 20 && value.startsWith("ses_")
}
