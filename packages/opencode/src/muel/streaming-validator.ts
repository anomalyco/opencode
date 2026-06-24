import type { GroundedOutput } from "./types"

enum TokenType {
  LBRACE,
  RBRACE,
  LBRACKET,
  RBRACKET,
  COLON,
  COMMA,
  STRING,
  NUMBER,
  TRUE,
  FALSE,
  NULL,
  EOF,
  INVALID,
}

class JsonStreamState {
  expectingValue = true
  braceDepth = 0
  bracketDepth = 0
  inString = false
  escaped = false
  killed = false
  killReason = ""
  started = false

  feed(char: string): void {
    if (this.killed) return

    if (this.inString) {
      if (this.escaped) {
        this.escaped = false
        return
      }
      if (char === "\\") {
        this.escaped = true
        return
      }
      if (char === '"') {
        this.inString = false
      }
      return
    }

    if (!this.started) {
      if (char === " " || char === "\n" || char === "\r" || char === "\t") return
      if (char === "{") {
        this.started = true
        this.braceDepth = 1
        this.expectingValue = true
        return
      }
      if (char === "[") {
        this.bracketDepth = 1
        return
      }
      this.kill("JSON must start with '{'")
      return
    }

    if (char === '"') {
      this.inString = true
      this.expectingValue = false
      return
    }

    if (char === "{") {
      this.braceDepth++
      this.expectingValue = true
      return
    }

    if (char === "}") {
      this.braceDepth--
      if (this.braceDepth < 0) {
        this.kill("Unbalanced '}'")
        return
      }
      this.expectingValue = false
      return
    }

    if (char === "[") {
      this.bracketDepth++
      this.expectingValue = true
      return
    }

    if (char === "]") {
      this.bracketDepth--
      if (this.bracketDepth < 0) {
        this.kill("Unbalanced ']'")
        return
      }
      this.expectingValue = false
      return
    }

    if (char === ":") {
      if (this.expectingValue) {
        this.kill("Unexpected ':'")
        return
      }
      this.expectingValue = true
      return
    }

    if (char === ",") {
      if (this.expectingValue) {
        this.kill("Unexpected ','")
        return
      }
      this.expectingValue = true
      return
    }

    if (char === " " || char === "\n" || char === "\r" || char === "\t") return
  }

  private kill(reason: string): void {
    this.killed = true
    this.killReason = reason
  }

  result(): { killed: boolean; killReason: string } {
    return { killed: this.killed, killReason: this.killReason }
  }
}

export class StreamingValidator {
  private state = new JsonStreamState()

  feed(char: string): boolean {
    this.state.feed(char)
    return !this.state.killed
  }

  feedString(text: string): boolean {
    for (const ch of text) {
      if (!this.feed(ch)) return false
    }
    return !this.state.killed
  }

  reset(): void {
    this.state = new JsonStreamState()
  }

  status(): { killed: boolean; killReason: string } {
    return this.state.result()
  }
}

export function validateGroundedOutput(raw: unknown): { ok: true; output: GroundedOutput } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Output must be a JSON object" }

  const o = raw as Record<string, unknown>
  if (typeof o.claim !== "string" || o.claim.length === 0)
    return { ok: false, error: "Missing or empty 'claim' field (must be non-empty string)" }

  if (typeof o.confidence !== "number" || o.confidence < 0 || o.confidence > 1)
    return { ok: false, error: "Invalid 'confidence' field (must be number 0-1)" }

  const ev = o.evidence as Record<string, unknown> | undefined
  if (!ev || typeof ev.source !== "string" || ev.source.length === 0)
    return { ok: false, error: "Missing 'evidence.source' field (must be non-empty string)" }

  if (typeof ev.offset !== "number" || ev.offset < 0)
    return { ok: false, error: "Invalid 'evidence.offset' field (must be non-negative number)" }

  if (typeof ev.length !== "number" || ev.length < 0)
    return { ok: false, error: "Invalid 'evidence.length' field (must be non-negative number)" }

  return {
    ok: true,
    output: {
      claim: o.claim as string,
      evidence: { source: ev.source as string, offset: ev.offset as number, length: ev.length as number },
      confidence: o.confidence as number,
    },
  }
}
