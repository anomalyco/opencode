#!/usr/bin/env bun

// The bytecode disassembler: pcs, ops, constants, handler and finally tables, local names, source lines.
import { sourceLocation } from "../src/runtime/model.js"
import type { Code } from "../src/code.js"
import { compileSource } from "../src/compiler/compile.js"
import {
  BinOpSymbols,
  CheckBaseKind,
  CodeFlags,
  CondKind,
  Op,
  OpNames,
  PutKind,
  UnaryOpSymbols,
} from "../src/opcodes.js"
import { parseProgram } from "../src/runtime/execute.js"

const formatFlags = (flags: number): string => {
  const names: Array<string> = []
  if (flags & CodeFlags.PROGRAM) names.push("PROGRAM")
  if (flags & CodeFlags.ARROW) names.push("ARROW")
  if (flags & CodeFlags.ASYNC) names.push("ASYNC")
  if (flags & CodeFlags.GENERATOR) names.push("GENERATOR")
  if (flags & CodeFlags.SIMPLE_PARAMS) names.push("SIMPLE_PARAMS")
  if (flags & CodeFlags.USES_THIS) names.push("USES_THIS")
  if (flags & CodeFlags.USES_ARGUMENTS) names.push("USES_ARGUMENTS")
  if (flags & CodeFlags.INTERNAL) names.push("INTERNAL")
  if (flags & CodeFlags.NEEDS_ARGS) names.push("NEEDS_ARGS")
  return names.join("|") || "NONE"
}

export const disassembleCode = (c: Code): string => {
  const lines: Array<string> = []
  const header = `=== fn#${c.index} ${c.name || "<anonymous>"} (params=${c.params}, locals=${c.locals}, maxStack=${c.maxStack}, flags=${formatFlags(c.flags)}) ===`
  lines.push(header)
  if (c.localNames.length > 0) {
    lines.push(`locals: ${c.localNames.map((n, i) => `${i}:${n}`).join(", ")}`)
  }
  if (c.captures.length > 0) {
    const caps: Array<string> = []
    for (let i = 0, j = 0; i < c.captures.length; i += 2, j++) {
      const from = c.captures[i] === 0 ? "local" : "upval"
      const idx = c.captures[i + 1]!
      caps.push(`${j}:${c.upvalNames[j] ?? "?"}(${from}[${idx}])`)
    }
    lines.push(`upvals: ${caps.join(", ")}`)
  }

  const words = c.code
  for (let pc = 0; pc < words.length; pc++) {
    const w = words[pc]!
    const op = w & 0xff
    let a = (w >>> 8) & 0xff
    let bx = w >>> 16
    if (op !== Op.EXTRA && pc > 0 && (words[pc - 1]! & 0xff) === Op.EXTRA) {
      const w1 = words[pc - 1]!
      const w0 = pc > 1 ? words[pc - 2]! : 0
      a = (w0 & 0xff) === Op.EXTRA ? ((w0 >>> 16) << 16) | (w1 & 0xff00) | a : (w1 & 0xff00) | a
      bx = ((w1 >>> 16) << 16) | bx
    }
    const sbx = w >> 16
    const opName = OpNames[op] ?? `OP_${op}`
    const operand = formatOperand(c, op, a, bx, sbx)
    const siteNode = c.siteAt(pc)
    const loc = siteNode?.loc ? sourceLocation(siteNode) : undefined
    const locText = loc ? ` ; L${loc.line}:${loc.column}` : ""
    lines.push(`${String(pc).padStart(4)}  ${opName.padEnd(18)} ${operand.padEnd(28)}${locText}`.trimEnd())
  }

  if (c.handlers.length > 0) {
    const hList: Array<string> = []
    for (let i = 0; i < c.handlers.length; i += 4) {
      hList.push(`[${c.handlers[i]}, ${c.handlers[i + 1]}) -> ${c.handlers[i + 2]} (depth ${c.handlers[i + 3]})`)
    }
    lines.push(`handlers: ${hList.join(", ")}`)
  }

  if (c.finallies.length > 0) {
    const fList: Array<string> = []
    for (let level = 0; level < c.finallyOffsets.length; level++) {
      const off = c.finallyOffsets[level]!
      const tag = c.finallies[off]!
      const val = c.finallies[off + 1]!
      const depth = c.finallies[off + 2]!
      const n = c.finallies[off + 3]!
      const targets: Array<number> = []
      for (let k = 0; k < n; k++) targets.push(c.finallies[off + 4 + k]!)
      fList.push(`#${level}{tag=${tag}, val=${val}, depth=${depth}, targets=[${targets.join(", ")}]}`)
    }
    lines.push(`finallies: ${fList.join(", ")}`)
  }

  return lines.join("\n")
}

const formatOperand = (c: Code, op: number, a: number, bx: number, sbx: number): string => {
  switch (op) {
    case Op.PUSH_UNDEF:
    case Op.PUSH_NULL:
    case Op.POP:
    case Op.DUP:
    case Op.NEW_OBJECT:
    case Op.COPY_DATA_PROPS:
    case Op.PUT_ELEM:
    case Op.DELETE_ELEM:
    case Op.TO_KEY:
    case Op.IN:
    case Op.INSTANCEOF:
    case Op.ADD:
    case Op.SUB:
    case Op.MUL:
    case Op.LT:
    case Op.LE:
    case Op.GT:
    case Op.GE:
    case Op.SEQ:
    case Op.SNE:
    case Op.NOT:
    case Op.THROW:
    case Op.RETURN:
    case Op.END_PROGRAM:
    case Op.NOP:
    case Op.CALL_SPREAD:
    case Op.NEW_SPREAD:
    case Op.FOR_IN:
    case Op.GENERATOR_START:
      return ""
    case Op.PUSH_BOOL:
      return a === 1 ? "true" : "false"
    case Op.PUSH_INT:
      return String(sbx)
    case Op.PUSH_CONST:
      return `${bx} (${JSON.stringify(c.consts[bx])})`
    case Op.POPN:
    case Op.NEW_ARRAY:
    case Op.CONCAT:
    case Op.COPY_REST:
    case Op.END_FINALLY:
    case Op.EXTRA:
      return a === 0 ? String(bx) : `a=${a} bx=${bx}`
    case Op.PICK:
    case Op.ROT:
    case Op.CALL:
      return String(a)
    case Op.NEW:
      return a === 255 ? "check" : String(a)
    case Op.GET_LOCAL:
    case Op.HOLE_LOCAL:
    case Op.COPY_CELL:
    case Op.GET_CELL:
      return `${bx} (${c.localNames[bx] ?? "?"})`
    case Op.NEW_CELL:
      return `${a === 1 ? "wrap " : ""}${bx} (${c.localNames[bx] ?? "?"})`
    case Op.PUT_LOCAL:
    case Op.PUT_CELL: {
      const prefix = a === PutKind.INIT ? ".init " : a === PutKind.CONST ? ".const " : ""
      return `${prefix}${bx} (${c.localNames[bx] ?? "?"})`
    }
    case Op.GET_UPVAL:
      return `${bx} (${c.upvalNames[bx] ?? "?"})`
    case Op.PUT_UPVAL: {
      const prefix = a === PutKind.INIT ? ".init " : a === PutKind.CONST ? ".const " : ""
      return `${prefix}${bx} (${c.upvalNames[bx] ?? "?"})`
    }
    case Op.GET_GLOBAL: {
      const prefix = a === 1 ? ".typeof " : a === 2 ? ".put " : ""
      return `${prefix}${JSON.stringify(c.consts[bx])}`
    }
    case Op.GET_INTRINSIC:
      return `${JSON.stringify(c.consts[bx])}`
    case Op.ARGS:
      return a === 0 ? "arguments" : a === 1 ? `rest(${bx})` : a === 2 ? "self" : a === 3 ? "this" : `arg[${bx}]`
    case Op.CLOSURE:
      return `fn#${bx}`
    case Op.SET_NAME:
      return a === 0 ? JSON.stringify(c.consts[bx]) : "(computed)"
    case Op.GET_PROP: {
      const prefix = a === 1 ? ".keep " : a === 2 ? ".destr " : ""
      return `${prefix}${JSON.stringify(c.consts[bx])}`
    }
    case Op.GET_ELEM:
      return a === 1 ? ".keep" : a === 2 ? ".destr" : ""
    case Op.PUT_PROP:
    case Op.DELETE_PROP:
      return JSON.stringify(c.consts[bx])
    case Op.DEFINE_FIELD:
      return a === 0 ? JSON.stringify(c.consts[bx]) : "(computed)"
    case Op.CHECK_BASE:
      return a === CheckBaseKind.READ
        ? ".read"
        : a === CheckBaseKind.WRITE_PROP
          ? `.writeProp ${JSON.stringify(c.consts[bx])}`
          : a === CheckBaseKind.WRITE_ELEM
            ? ".writeElem"
            : ".destructure"
    case Op.BINOP:
      return BinOpSymbols[a] ?? String(a)
    case Op.UNARY:
      return UnaryOpSymbols[a] ?? String(a)
    case Op.INC:
      return a === 0 ? "+1" : "-1"
    case Op.JUMP:
    case Op.LOOP:
    case Op.JUMP_IF_FALSE:
    case Op.JUMP_IF_TRUE:
      return `-> ${bx}`
    case Op.JUMP_COND: {
      const kind =
        a === CondKind.TRUTHY_KEEP
          ? ".truthyKeep"
          : a === CondKind.FALSY_KEEP
            ? ".falsyKeep"
            : a === CondKind.NOT_NULLISH_KEEP
              ? ".notNullishKeep"
              : a === CondKind.DEFINED
                ? ".defined"
                : a === CondKind.NULLISH
                  ? ".nullish"
                  : ".nullishMethod"
      return `${kind} -> ${bx}`
    }
    case Op.ITER_STEP:
    case Op.ITER_RESULT:
    case Op.ITER_CLOSE:
    case Op.ITER_APPEND_ALL:
    case Op.YSTAR:
    case Op.YSTAR_RESULT:
      return `slot=${a} -> ${bx}`
    case Op.AWAIT:
      return a === 1 ? ".unlocated" : ""
    case Op.YIELD:
      return ""
    case Op.RESUME:
      return `-> ${bx}`
    default:
      return `a=${a} bx=${bx}`
  }
}

export const disassemble = (codes: ReadonlyArray<Code> | Code): string => {
  const list = Array.isArray(codes) ? codes : [codes]
  return list.map(disassembleCode).join("\n\n")
}

export const disassembleSource = (sourceText: string): string => {
  const parsed = parseProgram(sourceText)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return disassemble(compileSource(parsed.source))
}

if (import.meta.main) {
  const arg = process.argv[2]
  if (!arg) {
    console.error("Usage: bun run script/disasm.ts <code-or-file>")
    process.exit(1)
  }
  const file = Bun.file(arg)
  const source = (await file.exists()) ? await file.text() : arg
  console.log(disassembleSource(source))
}
