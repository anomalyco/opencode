import type { Code } from "../src/code.js"
import { CheckBaseKind, CondKind, ImportKind, Op, OpNames } from "../src/opcodes.js"

/**
 * Stack-depth verifier (C5): runs abstract interpretation over packed bytecode independent of `CodeBuilder`,
 * proving a single static operand depth at every reachable pc, `0 <= depth <= maxStack`, valid handler and
 * `END_FINALLY` entry depths, T&S successor depths, and valid local/upvalue slot bounds.
 */
export const verifyCode = (c: Code): Array<string> => {
  const errors: Array<string> = []
  const label = `${c.source.id}#${c.index}(${c.name || "<anon>"})`
  const words = c.code
  const depth = new Int32Array(words.length).fill(-1)
  const work: Array<number> = []

  const at = (pc: number, d: number, from: number) => {
    if (pc < 0 || pc >= words.length) {
      errors.push(`${label}: pc ${pc} out of range (from ${from})`)
      return
    }
    if (pc > 0 && (words[pc - 1]! & 0xff) === Op.EXTRA) {
      errors.push(`${label}: jump into middle of EXTRA sequence at pc ${pc} (from ${from})`)
      return
    }
    if (d < 0) {
      errors.push(`${label}: negative depth ${d} at pc ${pc} (from ${from})`)
      return
    }
    if (d > c.maxStack) {
      errors.push(`${label}: depth ${d} > maxStack ${c.maxStack} at pc ${pc}`)
    }
    if (depth[pc] === -1) {
      depth[pc] = d
      work.push(pc)
    } else if (depth[pc] !== d) {
      errors.push(`${label}: depth conflict at pc ${pc}: ${depth[pc]} vs ${d} (from ${from})`)
    }
  }

  if (words.length > 0) at(0, 0, -1)

  const h = c.handlers
  for (let i = 0; i < h.length; i += 4) {
    at(h[i + 2]!, h[i + 3]! + 1, -2)
  }

  const checkSlot = (s: number, pc: number) => {
    if (s < 0 || s >= c.locals) {
      errors.push(`${label}: local slot ${s} out of [0, ${c.locals}) at pc ${pc}`)
    }
  }

  const checkUpval = (u: number, pc: number) => {
    const count = c.captures.length >>> 1
    if (u < 0 || u >= count) {
      errors.push(`${label}: upval ${u} out of [0, ${count}) at pc ${pc}`)
    }
  }

  while (work.length > 0) {
    const pc = work.pop()!
    const d = depth[pc]!
    const w = words[pc]!
    let op = w & 0xff
    let stride = 1
    let a = (w >>> 8) & 0xff
    let bx = w >>> 16
    if (op === Op.EXTRA) {
      if (pc + 1 >= words.length) {
        errors.push(`${label}: trailing EXTRA at pc ${pc}`)
        continue
      }
      const w1 = words[pc + 1]!
      if ((w1 & 0xff) === Op.EXTRA) {
        if (pc + 2 >= words.length) {
          errors.push(`${label}: trailing EXTRA at pc ${pc + 1}`)
          continue
        }
        const w2 = words[pc + 2]!
        op = w2 & 0xff
        a = ((w >>> 16) << 16) | (w1 & 0xff00) | ((w2 >>> 8) & 0xff)
        bx = ((w1 >>> 16) << 16) | (w2 >>> 16)
        stride = 3
      } else {
        op = w1 & 0xff
        a = (w & 0xff00) | ((w1 >>> 8) & 0xff)
        bx = ((w >>> 16) << 16) | (w1 >>> 16)
        stride = 2
      }
      if (op === Op.EXTRA) {
        errors.push(`${label}: more than two EXTRA prefixes at pc ${pc}`)
        continue
      }
    }
    const next = (delta: number) => at(pc + stride, d + delta, pc)

    switch (op) {
      case Op.PUSH_UNDEF:
      case Op.PUSH_NULL:
      case Op.PUSH_BOOL:
      case Op.PUSH_INT:
      case Op.PUSH_CONST:
      case Op.DUP:
      case Op.GET_INTRINSIC:
      case Op.ARGS:
      case Op.CLOSURE:
      case Op.NEW_OBJECT:
      case Op.TEMPLATE:
      case Op.REGEXP:
        next(1)
        break
      case Op.GET_GLOBAL:
        next(a === 2 ? -1 : 1)
        break
      case Op.IMPORT:
        next(a === ImportKind.SIDE_EFFECT ? 0 : a === ImportKind.DYNAMIC ? 0 : 1)
        break
      case Op.PICK:
        if (a >= d) errors.push(`${label}: PICK ${a} at depth ${d} (pc ${pc})`)
        next(1)
        break
      case Op.ROT:
        if (a >= d) errors.push(`${label}: ROT ${a} at depth ${d} (pc ${pc})`)
        next(0)
        break
      case Op.GET_LOCAL:
      case Op.GET_CELL:
        checkSlot(bx, pc)
        next(1)
        break
      case Op.PUT_LOCAL:
      case Op.PUT_CELL:
        checkSlot(bx, pc)
        next(-1)
        break
      case Op.HOLE_LOCAL:
      case Op.NEW_CELL:
      case Op.COPY_CELL:
        checkSlot(bx, pc)
        next(0)
        break
      case Op.GET_UPVAL:
        checkUpval(bx, pc)
        next(1)
        break
      case Op.PUT_UPVAL:
        checkUpval(bx, pc)
        next(-1)
        break
      case Op.POP:
      case Op.PUT_PROP:
      case Op.COPY_DATA_PROPS:
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
      case Op.BINOP:
      case Op.DELETE_ELEM:
      case Op.NEW_SPREAD:
        next(-1)
        break
      case Op.POPN:
      case Op.COPY_REST:
        next(-bx)
        break
      case Op.SET_NAME:
      case Op.DELETE_PROP:
      case Op.CHECK_BASE:
      case Op.TO_KEY:
      case Op.UNARY:
      case Op.NOT:
      case Op.TO_NUMERIC:
      case Op.INC:
      case Op.TO_STRING:
      case Op.NOP:
      case Op.FOR_IN:
      case Op.ITER_INIT:
      case Op.GENERATOR_START:
        if (op === Op.CHECK_BASE && a === CheckBaseKind.READ && d < 2) {
          errors.push(`${label}: CHECK_BASE.read at depth ${d} (pc ${pc})`)
        }
        next(0)
        break
      case Op.GET_PROP:
        next(a === 1 ? 1 : 0)
        break
      case Op.GET_ELEM:
        next(a === 1 ? 0 : -1)
        break
      case Op.PUT_ELEM:
      case Op.CALL_SPREAD:
        next(-2)
        break
      case Op.DEFINE_FIELD:
        next(a === 0 ? -1 : -2)
        break
      case Op.NEW_ARRAY:
      case Op.CONCAT:
        next(1 - bx)
        break
      case Op.ARRAY_APPEND:
        next(a === 1 ? 0 : -1)
        break
      case Op.JUMP:
      case Op.LOOP:
        at(bx, d, pc)
        break
      case Op.JUMP_IF_FALSE:
      case Op.JUMP_IF_TRUE:
        at(bx, d - 1, pc)
        next(-1)
        break
      case Op.JUMP_COND:
        if (a === CondKind.NULLISH) {
          at(bx, d, pc)
          next(0)
        } else if (a === CondKind.NULLISH_METHOD) {
          at(bx, d - 1, pc)
          next(0)
        } else {
          at(bx, d, pc)
          next(-1)
        }
        break
      case Op.THROW:
      case Op.RETURN:
      case Op.END_PROGRAM:
        if (d < 1) errors.push(`${label}: ${OpNames[op]} on empty stack at pc ${pc}`)
        break
      case Op.THROW_ERROR:
        break
      case Op.END_FINALLY: {
        if (bx < 0 || bx >= c.finallyOffsets.length) {
          errors.push(`${label}: END_FINALLY level ${bx} out of range at pc ${pc}`)
          break
        }
        const off = c.finallyOffsets[bx]!
        const fin = c.finallies
        const tagSlot = fin[off]!
        const valSlot = fin[off + 1]!
        const entryDepth = fin[off + 2]!
        const n = fin[off + 3]!
        if (d !== entryDepth) {
          errors.push(`${label}: END_FINALLY ${bx} at depth ${d}, expected ${entryDepth} (pc ${pc})`)
        }
        checkSlot(tagSlot, pc)
        checkSlot(valSlot, pc)
        for (let k = 0; k < n; k++) {
          const target = fin[off + 4 + k]!
          if (k !== 1 && target >= 0) at(target, entryDepth, pc)
        }
        break
      }
      case Op.CALL:
        if (d < a + 2) errors.push(`${label}: CALL ${a} at depth ${d} (pc ${pc})`)
        next(-(a + 1))
        break
      case Op.NEW:
        if (a === 255) {
          if (d < 1) errors.push(`${label}: NEW.check at depth ${d} (pc ${pc})`)
          next(0)
        } else {
          if (d < a + 1) errors.push(`${label}: NEW ${a} at depth ${d} (pc ${pc})`)
          next(-a)
        }
        break
      case Op.ITER_OPEN: {
        const jumpPc = pc + stride
        const jumpStride = jumpPc < words.length && (words[jumpPc]! & 0xff) === Op.EXTRA ? 2 : 1
        if (jumpPc + jumpStride > words.length || (words[jumpPc + jumpStride - 1]! & 0xff) !== Op.JUMP) {
          errors.push(`${label}: T&S ITER_OPEN at pc ${pc} not followed by JUMP`)
          break
        }
        at(jumpPc, d + 1, pc)
        at(jumpPc + jumpStride, d, pc)
        break
      }
      case Op.ITER_STEP: {
        checkSlot(a, pc)
        const jumpPc = pc + stride
        const jumpStride = jumpPc < words.length && (words[jumpPc]! & 0xff) === Op.EXTRA ? 2 : 1
        if (jumpPc + jumpStride > words.length || (words[jumpPc + jumpStride - 1]! & 0xff) !== Op.JUMP) {
          errors.push(`${label}: T&S ITER_STEP at pc ${pc} not followed by JUMP`)
          break
        }
        at(jumpPc, d + 2, pc)
        at(jumpPc + jumpStride, d + 1, pc)
        at(bx, d, pc)
        break
      }
      case Op.ITER_RESULT:
        checkSlot(a, pc)
        next(0)
        at(bx, d - 1, pc)
        break
      case Op.ITER_CLOSE:
        checkSlot(a, pc)
        next(2)
        at(bx, d, pc)
        break
      case Op.ITER_APPEND_ALL:
        checkSlot(a, pc)
        next(0)
        at(bx, d, pc)
        break
      case Op.AWAIT:
        if (d < 1) errors.push(`${label}: AWAIT on empty stack at pc ${pc}`)
        next(0)
        break
      case Op.YIELD:
        if (d < 1) errors.push(`${label}: YIELD on empty stack at pc ${pc}`)
        next(1)
        break
      case Op.RESUME:
        if (d < 2) errors.push(`${label}: RESUME at depth ${d} (pc ${pc})`)
        at(bx, d - 1, pc)
        next(-1)
        break
      case Op.YSTAR:
        checkSlot(a, pc)
        if (d < 2) errors.push(`${label}: YSTAR at depth ${d} (pc ${pc})`)
        at(bx, d + 1, pc)
        next(-1)
        break
      case Op.YSTAR_RESULT:
        checkSlot(a, pc)
        if (d < 1) errors.push(`${label}: YSTAR_RESULT on empty stack at pc ${pc}`)
        at(bx, d, pc)
        next(0)
        break
      default:
        errors.push(`${label}: unhandled op ${OpNames[op] ?? op} at pc ${pc}`)
        break
    }
  }

  for (let i = 0; i < h.length; i += 4) {
    const start = h[i]!
    const end = h[i + 1]!
    const handlerDepth = h[i + 3]!
    for (let pc = start; pc < end; pc++) {
      if (depth[pc]! !== -1 && depth[pc]! < handlerDepth) {
        errors.push(`${label}: pc ${pc} depth ${depth[pc]} < handler depth ${handlerDepth}`)
      }
    }
  }

  return errors
}

export const verifyAll = (codes: ReadonlyArray<Code>): Array<string> => codes.flatMap((c) => verifyCode(c))
