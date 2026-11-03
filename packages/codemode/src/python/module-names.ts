export const reMethods = ["search", "match", "fullmatch", "findall", "split", "sub"] as const
export const reMembers: string[] = [
  ...reMethods,
  "compile",
  "escape",
  "I",
  "IGNORECASE",
  "M",
  "MULTILINE",
  "S",
  "DOTALL",
]
