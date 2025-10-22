import { tool } from "./tool"

import type { Plugin } from "./index"

function findBracePattern(input: string): Readonly<RegExpMatchArray> | null {
  const bracePattern = /{([^{}]+)}/
  return input.match(bracePattern)
}

function hasComma(content: string): boolean {
  return content.includes(",")
}

function splitAlternatives(content: string): readonly string[] {
  return content.split(",").map((alt) => alt.trim())
}

function expandSingleBrace(input: string, fullMatch: string, content: string): readonly string[] {
  if (!hasComma(content)) {
    return [input.replace(fullMatch, content)]
  }

  const alternatives = splitAlternatives(content)
  return alternatives.map((alt) => input.replace(fullMatch, alt))
}

function expandBraces(input: string): readonly string[] {
  const match = findBracePattern(input)

  if (!match) {
    return [input]
  }

  const fullMatch = match[0]
  const content = match[1]
  const expanded = expandSingleBrace(input, fullMatch, content)

  if (expanded.length === 1 && expanded[0] === input) {
    return [input]
  }

  const furtherExpanded = expanded.flatMap((item) => expandBraces(item))
  return [...new Set(furtherExpanded)]
}

function isMkdirCommand(command: string): boolean {
  const trimmed = command.trim()
  return trimmed.startsWith("mkdir ") || trimmed.startsWith("mkdir -p ")
}

function extractMkdirPath(command: string): string | null {
  const trimmed = command.trim()
  const match = trimmed.match(/^mkdir\s+(?:-p\s+)?(.+)$/)
  return match ? match[1].trim() : null
}

function transformMkdirCommand(command: string): string {
  if (!isMkdirCommand(command)) return command

  const path = extractMkdirPath(command)
  if (!path) return command

  const expanded = expandBraces(path)
  if (expanded.length === 1 && expanded[0] === path) return command

  const mkdirOptions = command.includes(" -p ") ? " -p " : " "
  const expandedPaths = expanded.join(" ")

  return `mkdir${mkdirOptions}${expandedPaths}`
}

function hasBraceExpansion(command: string): boolean {
  const bracePattern = /{[^{}]+,/
  return bracePattern.test(command)
}

export const BraceExpansionPlugin: Plugin = async () => {
  return {
    tool: {
      "brace-expand": tool({
        description: "Expand bash brace expressions to see what directories would be created",
        args: {
          expression: tool.schema.string().describe("Brace expression to expand (e.g., 'dir/{src,docs}')"),
        },
        async execute(args) {
          const expanded = expandBraces(args.expression)
          return `Brace expansion results:\n${expanded.join("\n")}`
        },
      }),
    },

    async "tool.execute.before"(input, output) {
      if (input.tool !== "bash") return

      const args = output.args as Readonly<Record<string, unknown>>
      const command = (args.command as string) || ""

      if (hasBraceExpansion(command)) {
        const transformed = transformMkdirCommand(command)
        if (transformed !== command) {
          // eslint-disable-next-line functional/immutable-data
          output.args = { ...args, command: transformed }
        }
      }
    },
  }
}
