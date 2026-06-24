const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g
const NULL_BYTE_RE = /\0/g
const OPERATOR_RE = /[×÷−]/g
const DANGEROUS_CHARS_RE = /[\0\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069×÷−]/

function hasDangerousChars(text: string): boolean {
  return DANGEROUS_CHARS_RE.test(text)
}

type NumberFormat = "US" | "EU" | "AMBIGUOUS" | "NONE"

function detectFormat(text: string): NumberFormat {
  const hasComma = /,/.test(text)
  const hasDot = /\./.test(text)
  if (!hasComma && !hasDot) return "NONE"

  const euPattern = /\d\.\d{3},\d/.test(text)
  if (euPattern) return "EU"

  const usPattern = /\d,\d{3}\.\d/.test(text)
  if (usPattern) return "US"

  const ambiguous = /\d,\d{3}(?=\D|$)/.test(text)
  if (ambiguous && !hasDot) return "AMBIGUOUS"

  if (hasComma && !hasDot) return "EU"
  if (hasDot && !hasComma) return "US"

  return "NONE"
}

function euToPlain(text: string): string {
  return text.replace(/\./g, "").replace(/,/g, ".")
}

function standardizeNumbers(text: string): string {
  const format = detectFormat(text)
  if (format === "NONE") return text
  if (format === "US") return text
  if (format === "AMBIGUOUS") {
    return text.replace(/(\d+),(\d{3})(?=\D|$)/g, "$1$2")
  }
  if (format === "EU") return euToPlain(text)
  return text
}

export class Sanitizer {
  sanitizeInput(text: string): string {
    let result = text.normalize("NFC")
    if (hasDangerousChars(result)) {
      result = result.replace(ZERO_WIDTH_RE, "")
      result = result.replace(BIDI_RE, "")
      result = result.replace(NULL_BYTE_RE, "")
      result = result.replace(OPERATOR_RE, (m) => {
        if (m === "×") return "*"
        if (m === "÷") return "/"
        if (m === "−") return "-"
        return m
      })
    }
    result = standardizeNumbers(result)
    return result
  }

  sanitizeOutput(chunk: string): string {
    if (!hasDangerousChars(chunk)) return chunk
    let result = chunk
    result = result.replace(ZERO_WIDTH_RE, "")
    result = result.replace(BIDI_RE, "")
    result = result.replace(NULL_BYTE_RE, "")
    return result
  }

  normalizeNumbers(text: string): string {
    return standardizeNumbers(text)
  }
}
