import type { JWTPayload } from "jose"

export function parseRepositoryClaim(payload: JWTPayload) {
  const claim = payload.repository
  if (typeof claim !== "string") throw new Error("Repository claim is missing")

  const parts = claim.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Repository claim is invalid")

  const id = payload.repository_id
  return {
    owner: parts[0],
    repo: parts[1],
    id: typeof id === "string" && /^\d+$/.test(id) ? Number(id) : undefined,
  }
}
