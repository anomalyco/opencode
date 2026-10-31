import { createHash } from "node:crypto"

export function stableMarketplaceValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableMarketplaceValue).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableMarketplaceValue(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export function marketplaceSha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex")
}

export function marketplaceDigest(value: unknown) {
  return `sha256:${marketplaceSha256(stableMarketplaceValue(value))}`
}

export function marketplaceShortId(value: unknown) {
  return marketplaceSha256(stableMarketplaceValue(value)).slice(0, 32)
}
