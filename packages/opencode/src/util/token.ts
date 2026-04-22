const CHARS_PER_TOKEN = 4

export function estimate(input: string) {
  return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
}

const tokenRefs = {
  estimate,
}

export namespace Token {
  export const estimate = tokenRefs.estimate
}
