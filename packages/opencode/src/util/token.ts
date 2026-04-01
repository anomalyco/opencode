export namespace Token {
  const CHARS_PER_TOKEN = 3.5

  export function estimate(input: string) {
    return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
  }
}
