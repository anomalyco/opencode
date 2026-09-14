export function storedLocaleValue(raw: string | null | undefined) {
  return raw?.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
}
