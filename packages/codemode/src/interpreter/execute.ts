import { parse } from "acorn"
import { Cause, Effect, Scope } from "effect"
import {
  DiagnosticCategory,
  ModuleKind,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
  createSourceFile,
  flattenDiagnosticMessageText,
  forEachChild,
  transpileModule,
  type Node,
} from "typescript"
import type { DataValue, Diagnostic, ExecuteOptions, ResolvedExecutionLimits, Result } from "../codemode.js"
import { copyIn, copyOut, MAX_BIGINT_BITS, ToolRuntime, type Services } from "../tool-runtime.js"
import type { Tools } from "../tools.js"
import { normalizeError } from "./errors.js"
import { InterpreterRuntimeError, isRecord, type ProgramNode } from "./model.js"
import { PromiseRuntime } from "./promises.js"
import { Interpreter } from "./runtime.js"

export const executeWithLimits = <const Provided extends Record<string, unknown>>(
  options: ExecuteOptions<Provided>,
  limits: ResolvedExecutionLimits,
  searchIndex: ToolRuntime.DiscoveryPlan["searchIndex"],
): Effect.Effect<Result, never, Services<Provided>> => {
  if (options.code.trim().length === 0) {
    return Effect.succeed({
      ok: false,
      error: { kind: "ParseError", message: "Code cannot be empty." },
      toolCalls: [],
    })
  }

  // Allocate execution state inside suspension so reused Effects never share it.
  return Effect.suspend(() => {
    const tools = ToolRuntime.make(
      (options.tools ?? {}) as Tools<Services<Provided>>,
      limits.maxToolCalls,
      searchIndex,
      {
        onToolCallStart: options.onToolCallStart,
        onToolCallEnd: options.onToolCallEnd,
      },
    )
    const logs: Array<string> = []
    const logged = () => (logs.length > 0 ? { logs: [...logs] } : {})
    // Set only after copy-out so timeouts cannot report invalid values as completed.
    let returned: { value: DataValue; promises: PromiseRuntime<Services<Provided>> } | undefined

    const base = Effect.acquireUseRelease(
      Scope.make("parallel"),
      (scope) =>
        Effect.gen(function* () {
          const program = parseProgram(options.code)
          const promises = new PromiseRuntime<Services<Provided>>(scope)
          const interpreter = new Interpreter<Services<Provided>>(
            tools.invoke,
            tools.search,
            tools.keys,
            promises,
            logs,
          )
          const value = yield* interpreter.run(program)
          const result = copyOut(copyIn(value, "Execution result"), "nullify") as DataValue
          returned = { value: result, promises }
          const warnings = yield* promises.interrupt()
          return {
            ok: true,
            value: result,
            ...(warnings.length > 0 ? { warnings } : {}),
            ...logged(),
            toolCalls: tools.calls,
          } satisfies Result
        }),
      (scope, exit) => Scope.close(scope, exit),
    )
    const timeoutMs = limits.timeoutMs
    const operation =
      timeoutMs === undefined
        ? base
        : base.pipe(
            Effect.timeoutOrElse({
              duration: timeoutMs,
              orElse: () =>
                Effect.sync(() => {
                  if (returned === undefined) {
                    return {
                      ok: false,
                      error: { kind: "TimeoutExceeded", message: `Execution timed out after ${timeoutMs}ms.` },
                      ...logged(),
                      toolCalls: tools.calls,
                    } satisfies Result
                  }
                  // Keep the timeout warning first so truncation preserves it.
                  return {
                    ok: true,
                    value: returned.value,
                    warnings: [
                      {
                        kind: "TimeoutExceeded",
                        message: `The program returned, but background work was still running at the ${timeoutMs}ms timeout and was interrupted. Await all started promises.`,
                      },
                      ...returned.promises.diagnostics(),
                    ],
                    ...logged(),
                    toolCalls: tools.calls,
                  } satisfies Result
                }),
            }),
          )

    return operation.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.succeed({
              ok: false,
              error: normalizeError(Cause.squash(cause)),
              ...logged(),
              toolCalls: tools.calls,
            } satisfies Result),
      ),
      Effect.map((result) =>
        limits.maxOutputBytes === undefined ? result : boundOutput(result, limits.maxOutputBytes),
      ),
    )
  })
}

const parseProgram = (code: string): ProgramNode => {
  assertBigIntLiteralSourcesBounded(code)
  const transpiled = transpileModule(`async function __codemode__() {\n${code}\n}`, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
    },
  })
  const diagnostic = transpiled.diagnostics?.find((item) => item.category === DiagnosticCategory.Error)

  if (diagnostic) {
    throw new InterpreterRuntimeError(
      `Failed to parse TypeScript: ${flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
      undefined,
      "ParseError",
    )
  }

  const bodyStart = transpiled.outputText.indexOf("{") + 1
  const bodyEnd = transpiled.outputText.lastIndexOf("}")
  const executableCode = transpiled.outputText.slice(bodyStart, bodyEnd)
  const parsed = parse(executableCode, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    locations: true,
  }) as unknown

  if (!isRecord(parsed) || parsed.type !== "Program" || !Array.isArray(parsed.body)) {
    throw new InterpreterRuntimeError("Failed to parse script as a Program node.")
  }

  return parsed as ProgramNode
}

const decimalBigIntLimit = ((1n << BigInt(MAX_BIGINT_BITS)) - 1n).toString()

// TypeScript and Acorn materialize BigInt tokens before the interpreter can apply its value limit.
// Find necessarily oversized digit runs without constructing a BigInt, replace them with small
// sentinels, and parse only that shortened source to distinguish literals from identical text in
// strings, comments, templates, and regexps. Neither real parser sees an oversized BigInt token.
const assertBigIntLiteralSourcesBounded = (code: string): void => {
  const candidates = oversizedBigIntSources(code)
  if (candidates.length === 0) return

  let sourceEnd = 0
  let maskedEnd = 0
  const starts = new Set<number>()
  const chunks = candidates.map((candidate) => {
    const chunk = `${code.slice(sourceEnd, candidate.start)}0n`
    starts.add(maskedEnd + chunk.length - 2)
    sourceEnd = candidate.end
    maskedEnd += chunk.length
    return chunk
  })
  const masked = `${chunks.join("")}${code.slice(sourceEnd)}`
  const prefix = "async function __codemode__() {\n"
  const source = createSourceFile("codemode.ts", `${prefix}${masked}\n}`, ScriptTarget.ESNext, false, ScriptKind.TS)
  let oversized = false
  const visit = (node: Node): void => {
    if (node.kind === SyntaxKind.BigIntLiteral && starts.has(node.getStart(source) - prefix.length)) {
      oversized = true
      return
    }
    if (!oversized) forEachChild(node, visit)
  }
  visit(source)
  if (!oversized) return
  throw new InterpreterRuntimeError(
    `BigInt literal source exceeds CodeMode's ${MAX_BIGINT_BITS}-bit limit before parsing.`,
    undefined,
    "InvalidDataValue",
  )
}

const oversizedBigIntSources = (code: string) => {
  const candidates: Array<{ start: number; end: number }> = []
  for (let start = 0; start < code.length; start++) {
    if (code[start] < "0" || code[start] > "9" || isIdentifierPart(code[start - 1])) continue
    const prefix = code[start] === "0" ? code[start + 1]?.toLowerCase() : undefined
    const radix = prefix === "b" ? 2 : prefix === "o" ? 8 : prefix === "x" ? 16 : 10
    const radixBits = radix === 2 ? 1 : radix === 8 ? 3 : radix === 16 ? 4 : 0
    const digitsStart = radix === 10 ? start : start + 2
    let end = digitsStart
    let valid = true
    let separator = false
    let significantStart = -1
    let significantDigits = 0
    let firstSignificant = 0
    while (end < code.length) {
      const digit = digitValue(code[end])
      if (digit >= 0 && digit < radix) {
        if (digit !== 0 || significantStart !== -1) {
          if (significantStart === -1) {
            significantStart = end
            firstSignificant = digit
          }
          significantDigits++
        }
        separator = false
        end++
        continue
      }
      if (code[end] !== "_") break
      if (end === digitsStart || separator) valid = false
      separator = true
      end++
    }
    if (separator || code[end] !== "n") valid = false
    if (radix === 10 && end > start + 1 && code[start] === "0") valid = false
    if (code[end] === "n") end++
    if (
      valid &&
      !isIdentifierPart(code[end]) &&
      sourceBigIntExceedsLimit(code, significantStart, end - 1, significantDigits, firstSignificant, radixBits)
    ) {
      candidates.push({ start, end })
    }
    start = Math.max(start, end - 1)
  }
  return candidates
}

const isIdentifierPart = (character: string | undefined): boolean =>
  character !== undefined && (/[A-Za-z0-9_$]/.test(character) || character.charCodeAt(0) > 127)

const digitValue = (character: string | undefined): number => {
  if (character === undefined) return -1
  const value = character.charCodeAt(0)
  if (value >= 48 && value <= 57) return value - 48
  if (value >= 65 && value <= 70) return value - 55
  if (value >= 97 && value <= 102) return value - 87
  return -1
}

const sourceBigIntExceedsLimit = (
  code: string,
  significantStart: number,
  suffix: number,
  significantDigits: number,
  firstSignificant: number,
  radixBits: number,
): boolean => {
  if (radixBits !== 0) {
    if (significantDigits === 0) return false
    return (significantDigits - 1) * radixBits + firstSignificant.toString(2).length > MAX_BIGINT_BITS
  }
  if (significantDigits !== decimalBigIntLimit.length) return significantDigits > decimalBigIntLimit.length
  let compared = 0
  for (let position = significantStart; position < suffix; position++) {
    if (code[position] === "_") continue
    const difference = code.charCodeAt(position) - decimalBigIntLimit.charCodeAt(compared)
    if (difference !== 0) return difference > 0
    compared++
  }
  return false
}

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength

// Drop a replacement character produced by truncating inside a UTF-8 sequence.
const utf8Truncate = (value: string, maxBytes: number): string => {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength <= maxBytes) return value
  const text = new TextDecoder("utf-8").decode(bytes.slice(0, Math.max(0, maxBytes)))
  return text.endsWith("\uFFFD") ? text.slice(0, -1) : text
}

// Warnings have a separate budget so result data cannot starve diagnostics.
const boundOutput = (result: Result, maxOutputBytes: number): Result => {
  let truncated = false

  let value: DataValue = null
  let valueBytes = 0
  if (result.ok) {
    const serialized = JSON.stringify(result.value) ?? "null"
    const bytes = utf8ByteLength(serialized)
    if (bytes > maxOutputBytes) {
      truncated = true
      value = `${utf8Truncate(serialized, maxOutputBytes)} [result truncated: ${bytes} bytes exceeds the ${maxOutputBytes}-byte output limit; return a smaller value]`
      valueBytes = maxOutputBytes
    } else {
      value = result.value
      valueBytes = bytes
    }
  }

  const warnings = result.ok ? (result.warnings ?? []) : []
  const keptWarnings: Array<Diagnostic> = []
  let warningBytes = 0
  for (const warning of warnings) {
    const bytes = utf8ByteLength(JSON.stringify(warning)) + 1
    if (warningBytes + bytes > maxOutputBytes) break
    warningBytes += bytes
    keptWarnings.push(warning)
  }
  if (keptWarnings.length < warnings.length) {
    truncated = true
    keptWarnings.push({
      kind: "Truncated",
      message: `${warnings.length - keptWarnings.length} additional warnings omitted by the output limit.`,
    })
  }

  const logs = result.logs ?? []
  const kept: Array<string> = []
  const logBudget = Math.max(0, maxOutputBytes - valueBytes)
  let logBytes = 0
  for (const line of logs) {
    const lineBytes = utf8ByteLength(line) + 1
    if (logBytes + lineBytes > logBudget) break
    logBytes += lineBytes
    kept.push(line)
  }
  if (kept.length < logs.length) {
    truncated = true
    kept.push(`[logs truncated: showing ${kept.length} of ${logs.length} lines]`)
  }

  if (!truncated) return result
  const warningsPart = keptWarnings.length > 0 ? { warnings: keptWarnings } : {}
  const logsPart = kept.length > 0 ? { logs: kept } : {}
  return result.ok
    ? {
        ok: true,
        value,
        ...warningsPart,
        ...logsPart,
        truncated: true,
        toolCalls: result.toolCalls,
      }
    : { ok: false, error: result.error, ...logsPart, truncated: true, toolCalls: result.toolCalls }
}
