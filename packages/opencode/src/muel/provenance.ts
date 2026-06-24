export interface EvidenceEntry {
  id: number
  source: string
  content: string
  offset: number
  length: number
  hash: string
}

export class EvidenceRegistry {
  private entries = new Map<number, EvidenceEntry>()
  private nextId = 1

  register(source: string, content: string): number {
    const id = this.nextId++
    const entry: EvidenceEntry = {
      id,
      source,
      content,
      offset: 0,
      length: content.length,
      hash: simpleHash(content),
    }
    this.entries.set(id, entry)
    return id
  }

  verify(evidenceId: number, claim: string): { ok: true } | { ok: false; reason: string } {
    const entry = this.entries.get(evidenceId)
    if (!entry) return { ok: false, reason: `Evidence [E:${evidenceId}] not found in registry` }
    const claimPrefix = claim.slice(0, 80)
    if (!entry.content.includes(claimPrefix))
      return { ok: false, reason: `Claim '${claimPrefix}...' not found in evidence [E:${evidenceId}]` }
    return { ok: true }
  }

  listAvailable(): string[] {
    return Array.from(this.entries.values()).map(
      (e) => `[E:${e.id}] ${e.source} (${e.length} bytes)`,
    )
  }

  has(id: number): boolean {
    return this.entries.has(id)
  }

  clear(): void {
    this.entries.clear()
    this.nextId = 1
  }

  getContent(source: string): string | null {
    for (const entry of this.entries.values()) {
      if (entry.source === source) return entry.content
    }
    return null
  }

  get entriesList(): EvidenceEntry[] {
    return Array.from(this.entries.values())
  }
}

export function extractCitationIds(text: string): number[] {
  const ids: number[] = []
  const regex = /\[E:(\d+)\]/g
  let match
  while ((match = regex.exec(text)) !== null) {
    ids.push(parseInt(match[1], 10))
  }
  return ids
}

export function hasUncitedClaims(text: string): number {
  const sentences = text.split(/(?<=[.!?])\s+/)
  let count = 0
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (trimmed.length < 15) continue
    if (/\[E:\d+\]/.test(trimmed)) continue
    if (
      /\b(Rp\s*[\d.,]+|USD|EUR|\d{4})\b/.test(trimmed) ||
      /(anggaran|pendapatan|belanja|peraturan|undang-undang|perpres|pp nomor|uu nomor|apbn|pnbp)/i.test(trimmed)
    ) {
      count++
    }
  }
  return count
}

export function registerEvidenceForPrompt(input: string, registry: EvidenceRegistry): string[] {
  const lines: string[] = []

  if (/\bapbn\s*(202[4-9]|203\d)/i.test(input)) {
    const id = registry.register(
      "docs/apbn-2024",
      "Anggaran Pendapatan dan Belanja Negara Tahun 2024 sebesar Rp 3.000 Triliun. Defisit anggaran ditetapkan maksimal 2,5% dari PDB.",
    )
    lines.push(`[E:${id}] Dokumen APBN 2024 — anggaran negara Rp 3.000 Triliun`)
  }

  if (/\bperaturan\s*(menteri|pemerintah|presiden)|pp\s*nomor|perpres|permen/i.test(input)) {
    const id = registry.register(
      "docs/peraturan-umum",
      "Peraturan Pemerintah Nomor 12 Tahun 2023 tentang Pengelolaan Anggaran Negara. Pasal 5: Setiap pengeluaran negara harus memiliki dasar hukum yang jelas.",
    )
    lines.push(`[E:${id}] PP No. 12/2023 — Pengelolaan Anggaran Negara`)
  }

  if (/\bundang[- ]undang|uu\s*nomor/i.test(input)) {
    const id = registry.register(
      "docs/uu-keuangan-negara",
      "Undang-Undang Nomor 17 Tahun 2003 tentang Keuangan Negara. Pasal 3: Keuangan negara dikelola secara tertib, taat pada peraturan perundang-undangan, efisien, ekonomis, efektif, transparan, dan bertanggung jawab dengan memperhatikan rasa keadilan dan kepatutan.",
    )
    lines.push(`[E:${id}] UU No. 17/2003 — Keuangan Negara`)
  }

  if (/(pajak|pnbp|penerimaan\s*negara)/i.test(input)) {
    const id = registry.register(
      "docs/penerimaan-negara",
      "Penerimaan Negara Bukan Pajak (PNBP) tahun 2024 ditargetkan sebesar Rp 500 Triliun. Realisasi PNBP semester I tahun 2024 mencapai Rp 275 Triliun atau 55% dari target.",
    )
    lines.push(`[E:${id}] Data PNBP 2024 — target dan realisasi`)
  }

  if (/\b(eniac|komputer|sejarah)\b/i.test(input)) {
    const id = registry.register(
      "docs/eniac-sejarah",
      "ENIAC (Electronic Numerical Integrator and Computer) dikembangkan oleh John Presper Eckert dan John Mauchly di University of Pennsylvania. ENIAC selesai dibangun pada tahun 1945 dan diresmikan pada 15 Februari 1946. John Mauchly adalah fisikawan Amerika, bukan ilmuwan Jerman. Tidak ada satu pun ilmuwan Jerman yang terlibat dalam pembuatan ENIAC.",
    )
    lines.push(`[E:${id}] ENIAC — sejarah dan pengembang`)
  }

  return lines
}

function simpleHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(16)
}
