import { PAIR_CODE_LENGTH, PAIR_CODE_TTL_MS } from "./protocol"

export type PairRecord = {
  pairId: string
  code: string
  createdAt: number
  expiresAt: number
  claimed: boolean
}

// 32 alphabet chars excluding 0/O/1/I to reduce misreads when typed by hand.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

export function generateCode(len = PAIR_CODE_LENGTH): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! % ALPHABET.length]
  return out.slice(0, 4) + "-" + out.slice(4)
}

export function generateId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

export class PairingStore {
  private byId = new Map<string, PairRecord>()
  private byCode = new Map<string, string>()

  create(): PairRecord {
    this.sweep()
    const now = Date.now()
    const record: PairRecord = {
      pairId: generateId(),
      code: generateCode(),
      createdAt: now,
      expiresAt: now + PAIR_CODE_TTL_MS,
      claimed: false,
    }
    this.byId.set(record.pairId, record)
    this.byCode.set(record.code, record.pairId)
    return record
  }

  getById(pairId: string): PairRecord | undefined {
    this.sweep()
    return this.byId.get(pairId)
  }

  claim(code: string): PairRecord | undefined {
    this.sweep()
    const pairId = this.byCode.get(code)
    if (!pairId) return undefined
    const record = this.byId.get(pairId)
    if (!record || record.claimed) return undefined
    record.claimed = true
    // Code is single-use — free it immediately so it can't be re-redeemed.
    this.byCode.delete(code)
    return record
  }

  delete(pairId: string) {
    const record = this.byId.get(pairId)
    if (!record) return
    this.byId.delete(pairId)
    this.byCode.delete(record.code)
  }

  private sweep() {
    const now = Date.now()
    for (const [id, record] of this.byId) {
      if (record.expiresAt <= now && !record.claimed) {
        this.byId.delete(id)
        this.byCode.delete(record.code)
      }
    }
  }
}
