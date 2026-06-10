export * as Token from "./token"

const isCJK = (c: string) => {
  const cp = c.codePointAt(0)!
  return (cp >= 0x3040 && cp <= 0x309F) || (cp >= 0x30A0 && cp <= 0x30FF) ||
    (cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0xF900 && cp <= 0xFAFF)
}

export const estimate = (input: string) => {
  let cjk = 0
  let other = 0
  for (let i = 0; i < input.length; i++) {
    if (isCJK(input[i])) { cjk++ } else { other++ }
  }
  return Math.max(0, cjk + Math.round(other / 4))
}
