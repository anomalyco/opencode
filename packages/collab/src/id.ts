import { randomUUID } from "crypto"

export function collabId(prefix: "cs" | "sg" | "vt" | "inv" | "rp"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`
}
