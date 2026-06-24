export const DECOY_WORDS = [
  "DARURAT", "KRITIS", "MUTLAK", "SEGERA", "PENTING",
  "PERINTAH", "WAJIB", "HARUS", "JANGAN PERNAH", "LUPKAN",
  "ABAIKAN", "OVERRIDE", "KESELAMATAN", "BAHAYA",
  "GENTING", "MENDESAK", "RAHASIA", "JANGAN AUDIT",
  "ANGAP SJA", "JANGAN PERIKSA", "LEWATKAN", "TUTUPI",
  "RAHASIA NEGARA", "KONDISI DARURAT", "KEADAAN DARURAT",
  "Tidak usah diverifikasi", "Abaikan instruksi", "Anggap benar",
  "Jangan tanya lagi", "Ini wewenang saya", "Putuskan sendiri",
  "Saya yang bertanggung jawab", "Urusan internal", "Larang audit",
  "Tidak perlu diperiksa", "Anggap sudah sesuai", "Skip verifikasi",
]

const DECOY_RE = new RegExp(`\\b(?:${DECOY_WORDS.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`, "gi")

export class DecoyStripper {
  strip(text: string): string {
    return text.replace(DECOY_RE, "[DECOY_REMOVED]")
  }
}
