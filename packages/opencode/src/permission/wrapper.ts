interface WrapperConfig {
  readonly flagsWithArgs: string
  readonly positionalArgs: number
  readonly skipAssignments?: boolean
}

const WRAPPERS: Record<string, WrapperConfig> = {
  env: { flagsWithArgs: "u", positionalArgs: 0, skipAssignments: true },
  ionice: { flagsWithArgs: "cnp", positionalArgs: 0 },
  nice: { flagsWithArgs: "n", positionalArgs: 0 },
  nohup: { flagsWithArgs: "", positionalArgs: 0 },
  stdbuf: { flagsWithArgs: "ioe", positionalArgs: 0 },
  sudo: { flagsWithArgs: "ugCDhprtU", positionalArgs: 0 },
  time: { flagsWithArgs: "", positionalArgs: 0 },
  timeout: { flagsWithArgs: "ks", positionalArgs: 1 },
  watch: { flagsWithArgs: "n", positionalArgs: 0 },
  xargs: { flagsWithArgs: "ILnPsEd", positionalArgs: 0 },
}

function skip(
  tokens: ReadonlyArray<string>,
  index: number,
  config: WrapperConfig,
): number {
  const token = tokens[index]
  if (token === "--") return -(index + 1)

  if (config.skipAssignments && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token))
    return index + 1

  if (token.startsWith("--")) {
    if (token.includes("=")) return index + 1
    if (config.flagsWithArgs.length > 0) return index + 2
    return index + 1
  }

  if (token.startsWith("-") && token.length > 1) {
    const flag = token[1]
    if (config.flagsWithArgs.includes(flag)) {
      if (token.length > 2) return index + 1
      return index + 2
    }
    return index + 1
  }

  return 0
}

function extractFind(tokens: ReadonlyArray<string>): string[][] {
  const results: string[][] = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "-exec" && tokens[i] !== "-execdir") continue
    const inner: string[] = []
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j]
      if (t === ";" || t === "\\;" || t === "+") {
        i = j
        break
      }
      if (t !== "{}") inner.push(t)
    }
    if (inner.length > 0) results.push(inner)
  }
  return results
}

export namespace BashWrapper {
  export function extract(tokens: ReadonlyArray<string>): string[][] {
    if (tokens.length === 0) return []
    const cmd = tokens[0]

    if (cmd === "find") return extractFind(tokens)

    const config = WRAPPERS[cmd]
    if (!config) return []

    let i = 1
    let positionalRemaining = config.positionalArgs
    while (i < tokens.length) {
      const result = skip(tokens, i, config)
      if (result < 0) {
        const inner = tokens.slice(-result)
        if (inner.length === 0) return []
        const nested = extract(inner)
        return nested.length > 0 ? nested : [Array.from(inner)]
      }
      if (result > 0) {
        i = result
        continue
      }
      if (positionalRemaining > 0) {
        positionalRemaining--
        i++
        continue
      }
      const inner = tokens.slice(i)
      const nested = extract(inner)
      return nested.length > 0 ? nested : [Array.from(inner)]
    }
    return []
  }
}
