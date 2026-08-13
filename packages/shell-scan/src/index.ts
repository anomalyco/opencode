export * as ShellScan from "./index.js"

export type Result =
  | { kind: "scanned"; commands: Array<{ resource: string; words: string[] }> }
  | { kind: "opaque"; reason: string }

export function scan(input: string): Result {
  const commands: Array<{ resource: string; words: string[] }> = []
  const words: string[] = []
  const unsafeWords: boolean[] = []
  const assignmentWords: boolean[] = []
  let word = ""
  let wordStarted = false
  let unsafeWord = false
  let assignmentWord = false
  let segment = 0
  let quote: "single" | "double" | undefined
  let dynamicWord = false
  let compound = false
  let invalidRedirect = false
  let invalidStructure = false
  let separated = false
  let comment: number | undefined
  let heredoc = false
  let redirectTarget = false
  let hasRedirect = false

  const finishWord = () => {
    if (!wordStarted) return
    if (!redirectTarget) {
      words.push(word)
      unsafeWords.push(unsafeWord)
      assignmentWords.push(assignmentWord)
    }
    redirectTarget = false
    word = ""
    wordStarted = false
    unsafeWord = false
    assignmentWord = false
  }
  const finishCommand = (end: number, boundary = false) => {
    finishWord()
    const resource = input.slice(segment, end).trim()
    const name = assignmentWords.findIndex((assignment) => !assignment)
    if (name >= 0 && (unsafeWords[name] || /[*?[]/.test(words[name]))) compound = true
    if (resource && name >= 0)
      commands.push({
        resource,
        words: words.slice(name),
      })
    else if (hasRedirect || boundary || separated) invalidStructure = true
    words.length = 0
    unsafeWords.length = 0
    assignmentWords.length = 0
    separated = true
    hasRedirect = false
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (quote === "single") {
      wordStarted = true
      unsafeWord = true
      if (char === "'") quote = undefined
      else word += char
      continue
    }
    if (quote === "double") {
      wordStarted = true
      unsafeWord = true
      if (char === '"') quote = undefined
      else if (char === "\\" && index + 1 < input.length) word += input[++index]
      else if (char === "$" && input[index + 1] === "(") return { kind: "opaque", reason: "command-substitution" }
      else if (char === "`") return { kind: "opaque", reason: "command-substitution" }
      else {
        if (char === "$") dynamicWord = true
        word += char
      }
      continue
    }
    if (char === "'") {
      quote = "single"
      wordStarted = true
      unsafeWord = true
      continue
    }
    if (char === '"') {
      quote = "double"
      wordStarted = true
      unsafeWord = true
      continue
    }
    if (char === "\\") {
      if (index + 1 >= input.length) return { kind: "opaque", reason: "unterminated-escape" }
      wordStarted = true
      unsafeWord = true
      if (input[index + 1] === "\n") index++
      else word += input[++index]
      continue
    }
    if ((char === "$" && input[index + 1] === "(") || char === "`")
      return { kind: "opaque", reason: "command-substitution" }
    if (char === "<" && input[index + 1] === "<") heredoc = true
    if (char === "#" && !wordStarted) {
      finishCommand(index)
      comment = index
      const newline = input.indexOf("\n", index)
      if (newline === -1) break
      index = newline
      segment = newline + 1
      continue
    }
    const redirect = /^(?:&>>?|<<<|<<-?|<>|<&|>&|>\||>>|>|<)/.exec(input.slice(index))?.[0]
    if (redirect) {
      hasRedirect = true
      if (redirectTarget) invalidRedirect = true
      if (wordStarted && /^\d+$/.test(word)) {
        word = ""
        wordStarted = false
      } else finishWord()
      redirectTarget = true
      index += redirect.length - 1
      continue
    }
    if (
      "(){}".includes(char) ||
      (char === "&" && input[index + 1] !== "&" && input[index - 1] !== "|") ||
      (char === "!" && !wordStarted)
    )
      compound = true
    if (/\s/.test(char) && char !== "\n") {
      finishWord()
      continue
    }
    const pair = input.slice(index, index + 2)
    const separator =
      pair === "&&" || pair === "||" || pair === "|&"
        ? pair
        : char === ";" || char === "|" || char === "\n"
          ? char
          : undefined
    if (separator) {
      finishCommand(index, true)
      if (redirectTarget) invalidRedirect = true
      index += separator.length - 1
      segment = index + 1
      continue
    }
    wordStarted = true
    if (char === "$") dynamicWord = true
    if (char === "=" && !unsafeWord && /^[A-Za-z_][A-Za-z0-9_]*\+?$/.test(word)) assignmentWord = true
    word += char
  }

  if (quote) return { kind: "opaque", reason: "unterminated-quote" }
  if (heredoc) return { kind: "opaque", reason: "heredoc" }
  if (comment === undefined || input.includes("\n", comment)) finishCommand(input.length)
  if (redirectTarget) invalidRedirect = true
  if (separated && comment === undefined && !input.slice(segment).trim()) invalidStructure = true
  if (invalidStructure) return { kind: "opaque", reason: "invalid-structure" }
  if (invalidRedirect) return { kind: "opaque", reason: "invalid-redirect" }
  if (
    compound ||
    commands.some((command) =>
      new Set([
        "if",
        "then",
        "elif",
        "else",
        "fi",
        "for",
        "while",
        "until",
        "case",
        "select",
        "function",
        "do",
        "done",
        "coproc",
      ]).has(command.words[0] ?? ""),
    )
  )
    return { kind: "opaque", reason: "compound-command" }
  if (
    commands.some((command) => command.words[0]?.includes("$")) ||
    (dynamicWord && commands[0]?.words[0]?.includes("$"))
  )
    return { kind: "opaque", reason: "dynamic-command-name" }
  if (
    commands.some((command) =>
      new Set([
        "time",
        "command",
        "builtin",
        "exec",
        "env",
        "sudo",
        "nice",
        "nohup",
        "xargs",
        "source",
        ".",
        "trap",
      ]).has(command.words[0] ?? ""),
    )
  )
    return { kind: "opaque", reason: "command-wrapper" }
  if (
    commands.some((command) => {
      const name = command.words[0]?.split("/").at(-1)
      if (name === "eval") return true
      if (!new Set(["bash", "sh", "dash", "zsh", "ksh"]).has(name ?? "")) return false
      return command.words.length > 1
    })
  )
    return { kind: "opaque", reason: "shell-evaluation" }
  return { kind: "scanned", commands }
}
