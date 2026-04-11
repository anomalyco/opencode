export namespace Token {
  let charsPerToken = 4

  export function estimate(input: string) {
    return Math.max(0, Math.round((input || "").length / charsPerToken))
  }

  export function updateRatio({ chars, tokens }: { chars: number; tokens: number }) {
    if (tokens <= 0 || chars <= 0) return
    charsPerToken = charsPerToken * 0.7 + (chars / tokens) * 0.3
  }

  export function resetRatio() {
    charsPerToken = 4
  }
}
