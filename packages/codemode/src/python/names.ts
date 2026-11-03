export const pythonNames = [
  "tools",
  "search",
  "print",
  "range",
  "len",
  "str",
  "bool",
  "list",
  "sorted",
  "asyncio",
] as const

export const pythonKeywords = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(
    " ",
  ),
)
