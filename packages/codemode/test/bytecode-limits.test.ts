import { describe, expect, test } from "bun:test"
import { createBuiltins } from "../src/runtime/intrinsics.js"
import { Interpreter } from "../src/runtime/interpreter.js"
import type { ToolRuntime } from "../src/tool-runtime.js"
import { CodeBuilder, CodeSizeOverflow, hashOf } from "../src/code.js"
import { compileSource } from "../src/compiler/compile.js"
import { CodeFlags, EMPTY_CELLS, Op, packWord, PutKind } from "../src/opcodes.js"
import { Mode } from "../src/vm.js"
import { parseVmSource, type RunOptions, runProgram } from "./run-program.js"
import { verifyAll, verifyCode } from "./verify-bytecode.js"

const emptyTools = {
  calls: [],
  keys: () => [],
} as unknown as ToolRuntime<never>

const compileVerified = (code: string) => {
  const parsed = parseVmSource(code)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(parsed.error.message)
  const codes = compileSource(parsed.source, { noCache: true })
  expect(verifyAll(codes)).toEqual([])
  return { source: parsed.source, codes }
}

const runVerified = (code: string, options?: RunOptions) => {
  const compiled = compileVerified(code)
  const res = runProgram(code, options)
  if (!res.ok) throw new Error(`${res.error.kind}: ${res.error.message}`)
  return { value: res.value, codes: compiled.codes }
}

// Emits ~27 words per line in wide mode (~25 in narrow mode) with shallow AST depth, reaching >65,535 words in ~2,800 lines.
const makePaddingBlock = (count: number, accVar = "padAcc", condVar = "padCond"): string => {
  const lines = Array.from(
    { length: count },
    (_, i) =>
      `if (${condVar}) { ${accVar} += ${(i % 7) + 1} + 1 + 1 + 1 + 1 + 1 + 1 + 1 } else { ${accVar} -= 1 }`,
  )
  return lines.join("\n")
}

describe("CodeBuilder and packWord encoding bounds", () => {
  test("packWord and CodeBuilder reject out-of-range operands instead of masking", () => {
    expect(() => packWord(Op.NOP, -1, 0)).toThrow(RangeError)
    expect(() => packWord(Op.NOP, 256, 0)).toThrow(RangeError)
    expect(() => packWord(Op.NOP, 0, -1)).toThrow(RangeError)
    expect(() => packWord(Op.NOP, 0, 65536)).toThrow(RangeError)
    expect(() => packWord(256 as never, 0, 0)).toThrow(RangeError)

    const builder = new CodeBuilder(
      { id: "test", hash: "" },
      undefined,
      0,
      "test",
      CodeFlags.PROGRAM,
      0,
      0,
      2,
      ["a", "b"],
      new Int32Array(0),
    )
    expect(() => builder.emit(Op.EXTRA, 0, 0)).toThrow(RangeError)
    expect(() => builder.emit(Op.GET_LOCAL, -1, 0)).toThrow(RangeError)
    expect(() => builder.emit(Op.GET_LOCAL, 0, -1)).toThrow(RangeError)
    expect(() => builder.emit(Op.GET_LOCAL, 0x80000000, 0)).toThrow(RangeError)
    expect(() => builder.emit(Op.GET_LOCAL, 0, 0x80000000)).toThrow(RangeError)
    expect(() => builder.emit(Op.NEW, 256, 0)).toThrow(RangeError)
    expect(() => builder.emit(Op.PUSH_INT, 1, 0)).toThrow(RangeError)
    expect(() => builder.emit(Op.PUSH_INT, 0, 0x10000)).toThrow(RangeError)
  })

  test("narrow CodeBuilder throws CodeSizeOverflow past 65,535 words, while wideJumps supports 31-bit jumps and double EXTRA", () => {
    const narrow = new CodeBuilder(
      { id: "test", hash: "" },
      undefined,
      0,
      "narrow",
      CodeFlags.PROGRAM,
      0,
      0,
      0,
      [],
      new Int32Array(0),
    )
    for (let i = 0; i < 0xffff; i++) narrow.emit(Op.NOP)
    expect(() => narrow.emit(Op.NOP)).toThrow(CodeSizeOverflow)

    const localCount = 70_000
    const wide = new CodeBuilder(
      { id: "test", hash: "" },
      undefined,
      0,
      "wide",
      CodeFlags.PROGRAM,
      0,
      0,
      localCount,
      Array.from({ length: localCount }, (_, i) => `v${i}`),
      new Int32Array(0),
    )
    wide.wideJumps = true
    const slow = wide.newLabel(2)
    const join = wide.newLabel(1)
    const stepSlow = wide.newLabel(2)
    const got = wide.newLabel(1)
    const done = wide.newLabel(0)
    // Build `[42]` on stack, ITER_OPEN into slot 69,999, ITER_STEP (with a = 69,999 > 0xffff -> double EXTRA)
    // jumping past 66,000 NOPs on done, and return the stepped item.
    wide.emitNumber(42)
    wide.emit(Op.NEW_ARRAY, 0, 1, -1, 0)
    wide.emitJump(Op.ITER_OPEN, 0, slow, -1, 0, 1)
    wide.emitJump(Op.JUMP, 0, slow, -1, 0, null)
    wide.mark(join)
    wide.emit(Op.PUT_LOCAL, PutKind.INIT, 69_999, -1, -1)
    wide.emitJump(Op.ITER_STEP, 69_999, done, -1, 0, 2)
    wide.emitJump(Op.JUMP, 0, stepSlow, -1, 0, null)
    wide.mark(got)
    wide.emit(Op.PUT_LOCAL, PutKind.INIT, 69_998, -1, -1)
    for (let i = 0; i < 66_000; i++) wide.emit(Op.NOP)
    // Second ITER_STEP hits done -> jumps past slow handlers to `done` (target > 66,000)
    wide.emitJump(Op.ITER_STEP, 69_999, done, -1, 0, 2)
    wide.emitJump(Op.JUMP, 0, stepSlow, -1, 0, null)
    wide.setDepth(1)
    wide.emit(Op.POP, 0, 0, -1, -1)
    wide.emitJump(Op.JUMP, 0, done, -1, 0, null)
    wide.mark(slow)
    wide.emit(Op.CALL, 0, 0, -1, -1)
    wide.emit(Op.ITER_INIT, 0, 0, -1, 0)
    wide.emitJump(Op.JUMP, 0, join, -1, 0, null)
    wide.mark(stepSlow)
    wide.emit(Op.CALL, 0, 0, -1, -1)
    wide.emitJump(Op.ITER_RESULT, 69_999, done, -1, -1, 0)
    wide.emitJump(Op.JUMP, 0, got, -1, 0, null)
    wide.mark(done)
    wide.emit(Op.GET_LOCAL, 0, 69_998, -1, 1)
    wide.emit(Op.END_PROGRAM, 0, 0, -1, -1)
    const finished = wide.finish()
    expect(finished.code.length).toBeGreaterThan(66_000)
    expect(verifyCode(finished)).toEqual([])

    const ctx = new Interpreter<never>({ tools: emptyTools, builtins: createBuiltins(), logs: [] })
    const vm = ctx.vm
    vm.sourceCodes.set("test", [finished])
    const root = vm.acquire(finished)
    root.fn = null
    root.cells = EMPTY_CELLS
    root.pc = 0
    root.sp = finished.locals
    root.mode = Mode.PROGRAM
    root.counted = true
    vm.depth = 1
    vm.frames.push(root)
    const stop = vm.run()
    expect(stop).toEqual({ kind: "done", completion: { ok: true, value: 42 } })
  })
})

describe("wide `a` operands and `execWide` coverage", () => {
  test("executes a multi-feature program compiled entirely with forceExtra (every opcode widened)", () => {
    const src = `
      function helper(a, b = 3, ...rest) {
        let local = a + b + rest.length + arguments.length
        const box = { v: local, [ "k" + 1 ]: 10 }
        box.v++
        ++box.k1
        const { k1, ...rem } = { ...box, extra: 7 }
        return rem.v + k1 + (typeof unknownGlobal === "undefined" ? 1 : 0) + (-2 >>> 0 > 0 ? 1 : 0)
      }
      function* gen(xs) {
        yield* xs
        const r = yield 99
        return r
      }
      async function run() {
        const arr = [1, , ...[2, 3]]
        let sum = 0
        for (const x of arr) sum += x ?? 0
        const custom = {
          closed: 0,
          [Symbol.iterator]() {
            let i = 0
            return {
              next: () => (i++ < 3 ? { value: i * 10, done: false } : { value: undefined, done: true }),
              return: () => { custom.closed++; return {} },
            }
          },
        }
        for (const v of custom) {
          sum += v
          if (v === 20) break
        }
        const g = gen([4, 5])
        sum += g.next().value + g.next().value + g.next().value + g.next(6).value
        const d = new Date(0)
        return [sum, custom.closed, helper(2, undefined, 8, 9), d instanceof Date, \`\${sum}-\${custom.closed}\`]
      }
      return await run()
    `
    const parsed = parseVmSource(src)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const baseline = runProgram(src)
    expect(baseline).toEqual({ ok: true, value: [150, 1, 25, true, "150-1"], toolCalls: [] })
    const wideCodes = compileSource(parsed.source, { forceExtra: true, noCache: true })
    expect(verifyAll(wideCodes)).toEqual([])

    const ctx = new Interpreter<never>({
      tools: emptyTools,
      builtins: createBuiltins(),
      logs: [],
    })
    const vm = ctx.vm
    ctx.sources.set(parsed.source.id, parsed.source)
    vm.sourceCodes.set(parsed.source.id, wideCodes)
    const root = vm.acquire(wideCodes[0]!)
    root.fn = null
    root.cells = EMPTY_CELLS
    root.pc = 0
    root.sp = wideCodes[0]!.locals
    root.mode = Mode.PROGRAM
    root.counted = true
    vm.depth = 1
    vm.frames.push(root)
    while (true) {
      const stop = vm.run()
      if (stop.kind === "slice") continue
      expect(stop.kind).toBe("done")
      if (stop.kind === "done") {
        expect(stop.completion).toEqual({
          ok: true,
          value: [150, 1, 25, true, "150-1"],
        })
      }
      break
    }
  })

  test("280+ locals with hoisted functions, for...of (array, custom, generator), spread, yield*, and destructuring", () => {
    const localDecls = Array.from({ length: 280 }, (_, i) =>
      i % 25 === 0 ? `let v${i} = ${i}; const c${i} = () => v${i}` : `let v${i} = ${i}`,
    ).join("\n")
    const localReads = Array.from({ length: 280 }, (_, i) => (i % 25 === 0 ? `c${i}()` : `v${i}`)).join(" + ")

    const src = `
      function hoisted0(x) { return x + 100 }
      function hoisted1(x) { return x * 2 }
      function* hoistedGen(base) {
        yield base + 1
        yield base + 2
        yield base + 3
      }

      async function exercise() {
        function innerHoisted(z) { return hoisted0(z) + hoisted1(z) }
        ${localDecls}

        let acc = ${localReads}

        // Array for...of (Position fast path with itSlot > 280)
        for (const item of [10, 20, 30]) {
          acc += innerHoisted(item)
        }

        // Sync generator for...of (answerCaller with wide itSlot > 280, plus early break)
        for (const item of hoistedGen(5)) {
          acc += item
        }
        for (const item of hoistedGen(50)) {
          acc += item
          if (item === 52) break
        }

        // Custom iterator with ITER_RESULT and ITER_CLOSE (break + throw) at itSlot > 280
        let closedCount = 0
        const makeCustom = (vals) => ({
          [Symbol.iterator]() {
            let idx = 0
            return {
              next() {
                return idx < vals.length ? { value: vals[idx++], done: false } : { value: undefined, done: true }
              },
              return() {
                closedCount++
                return { done: true }
              },
            }
          },
        })
        for (const item of makeCustom([7, 8, 9])) {
          acc += item
          if (item === 8) break
        }
        try {
          for (const item of makeCustom([11, 12])) {
            if (item === 11) throw new Error("boom")
          }
        } catch (e) {
          acc += e.message.length
        }

        // Spread and array destructuring with itSlot > 280
        const spreadArr = [...[1, 2], ...hoistedGen(10), ...makeCustom([30, 40])]
        const [d0, , d2, ...dRest] = hoistedGen(100)
        acc += spreadArr.reduce((a, b) => a + b, 0) + d0 + d2 + dRest.length

        // Sync and async yield* with itSlot/kindSlot > 280 (including .return() and .throw())
        function* wideDelegate() {
          ${Array.from({ length: 265 }, (_, i) => `const dLoc${i} = ${i}`).join("; ")}
          const res = yield* {
            [Symbol.iterator]() {
              let step = 0
              return {
                next(v) {
                  step++
                  return step === 1 ? { value: dLoc264 + 1, done: false } : { value: (v ?? 0) + 5, done: true }
                },
                return(v) {
                  return { value: v * 10, done: true }
                },
              }
            },
          }
          return res + dLoc0
        }
        const dg1 = wideDelegate()
        const y1 = dg1.next().value
        const y2 = dg1.next(4).value
        const dg2 = wideDelegate()
        dg2.next()
        const yRet = dg2.return(7).value

        async function* wideAsyncGen() {
          ${Array.from({ length: 265 }, (_, i) => `const aLoc${i} = ${i}`).join("; ")}
          yield await Promise.resolve(aLoc260 + 2)
          yield* hoistedGen(200)
        }
        let asyncSum = 0
        for await (const x of wideAsyncGen()) asyncSum += x

        // Hoisted functions in low slots must still be intact
        return [acc, closedCount, y1, y2, yRet, asyncSum, hoisted0(1), hoisted1(3), innerHoisted(2)]
      }

      return await exercise()
    `

    const { value, codes } = runVerified(src)
    expect(codes.some((c) => c.locals > 280)).toBe(true)
    const expectedTriangular = (279 * 280) / 2
    // innerHoisted(10)=130, (20)=160, (30)=190 => 480
    // hoistedGen(5): 6+7+8 = 21; hoistedGen(50) break at 52: 51+52 = 103
    // custom break: 7+8 = 15; custom throw "boom".length = 4
    // spreadArr: 1+2 + 11+12+13 + 30+40 = 109; destructure: d0=101, d2=103, dRest=[] (0) => 204
    const expectedAcc = expectedTriangular + 480 + 21 + 103 + 15 + 4 + 109 + 204
    expect(value).toEqual([expectedAcc, 2, 265, 9, 70, 262 + 201 + 202 + 203, 101, 6, 106])
  })
})

describe("tagged templates, calls, and object rest past 254 items", () => {
  test("tagged templates with 300 substitutions (plain and method tags) and 300+ call/new arguments", () => {
    const parts = Array.from({ length: 300 }, (_, i) => `s${i}\${${i + 1}}`).join("") + "end"
    const callArgs = Array.from({ length: 300 }, (_, i) => `${i}`).join(", ")
    const src = `
      function plainTag(strings, ...vals) {
        return [strings.length, strings.raw.length, strings[0], strings[300], vals.length, vals[0], vals[299], vals.reduce((a, b) => a + b, 0)]
      }
      const receiver = {
        bias: 1000,
        methodTag(strings, ...vals) {
          return this.bias + strings.length + vals.length + vals[299]
        },
      }
      const sumFn = (...xs) => xs.length * 10000 + xs[0] + xs[299]
      const constructed = new Array(${callArgs})
      return [
        plainTag\`${parts}\`,
        receiver.methodTag\`${parts}\`,
        sumFn(${callArgs}),
        [constructed.length, constructed[0], constructed[299]],
      ]
    `
    const { value } = runVerified(src)
    expect(value).toEqual([
      [301, 301, "s0", "end", 300, 1, 300, (300 * 301) / 2],
      1000 + 301 + 300 + 300,
      300 * 10000 + 0 + 299,
      [300, 0, 299],
    ])
  })

  test("object rest destructuring after 305 static and computed keys", () => {
    const objEntries = Array.from({ length: 310 }, (_, i) => `k${i}: ${i}`).join(", ")
    const patternEntries = Array.from({ length: 305 }, (_, i) =>
      i % 40 === 0 ? `["k" + ${i}]: p${i}` : `k${i}: p${i}`,
    ).join(", ")
    const sumExtracted = Array.from({ length: 305 }, (_, i) => `p${i}`).join(" + ")
    const src = `
      const srcObj = { ${objEntries} }
      const { ${patternEntries}, ...rest } = srcObj
      return [${sumExtracted}, Object.keys(rest), rest.k305, rest.k309]
    `
    const { value } = runVerified(src)
    expect(value).toEqual([(304 * 305) / 2, ["k305", "k306", "k307", "k308", "k309"], 305, 309])
  })
})

describe("per-function wide jumps past 65,535 words and snapshot round-trips", () => {
  test("a single function >65,535 words compiles with wide jumps (leaving sibling functions narrow) and runs all control flow", () => {
    const padA = makePaddingBlock(1500, "padAcc", "padCond")
    const padB = makePaddingBlock(1500, "padAcc", "padCond")

    const src = `
      function smallSibling(x) {
        let s = 0
        for (let i = 0; i < x; i++) s += i
        return s
      }

      function* smallGen() {
        yield 10
        yield 20
      }

      async function hugeControlFlow(mode) {
        function hoistedInsideHuge(v) { return v * 3 }
        let padAcc = 0
        let padCond = true
        let trace = 0
        let finallyRuns = 0

        // Outer labelled loop spanning >75,000 words from top to bottom
        outer: for (let pass = 0; pass < 3; pass++) {
          try {
            // Switch whose dispatch jumps across the 65,535-word boundary
            switch (pass) {
              case 0:
                ${padA}
                trace += 1
                break
              case 1:
                ${padB}
                // Continue outer across finally from past word 65,535 back to top of function
                trace += 10
                continue outer
              default:
                // Break outer across finally and open for...of iterator past word 65,535
                for (const item of [100, 200, 300]) {
                  trace += item
                  if (item === 200) break outer
                }
            }
          } catch (err) {
            trace += 1000
          } finally {
            finallyRuns++
          }
        }

        // Code past word 75,000: while, do...while, for...in, for...of (array + generator), try/catch/finally, await
        let w = 0
        while (w < 3) w++
        do { w += 2 } while (w < 7)
        for (const k in { a: 1, b: 2 }) trace += k.length
        for (const gVal of smallGen()) trace += gVal

        let caughtLate = ""
        try {
          await Promise.reject("late-reject")
        } catch (e) {
          caughtLate = e
        } finally {
          finallyRuns += 10
        }

        async function* lateAsyncGen() {
          yield await Promise.resolve(5)
          yield* smallGen()
        }
        for await (const av of lateAsyncGen()) trace += av

        return [
          hoistedInsideHuge(7),
          smallSibling(5),
          padAcc,
          trace,
          finallyRuns,
          w,
          caughtLate,
          mode,
        ]
      }

      function* hugeGenerator() {
        let padAcc = 0
        let padCond = true
        const first = yield 1
        ${makePaddingBlock(2800, "padAcc", "padCond")}
        yield* smallGen()
        const second = yield padAcc + first
        return second * 2
      }

      const mainRes = await hugeControlFlow("ok")
      const hg = hugeGenerator()
      const gSteps = [hg.next().value, hg.next(4).value, hg.next().value, hg.next().value, hg.next(9).value]
      return { mainRes, gSteps }
    `

    const { value, codes } = runVerified(src)
    const smallCode = codes.find((c) => c.name === "smallSibling")!
    const hugeCode = codes.find((c) => c.name === "hugeControlFlow")!
    const hugeGenCode = codes.find((c) => c.name === "hugeGenerator")!
    expect(hugeCode.code.length).toBeGreaterThan(75_000)
    expect(hugeGenCode.code.length).toBeGreaterThan(70_000)
    // Sibling small function must NOT have any EXTRA prefixes: per-function wide mode keeps it byte-identical.
    expect([...smallCode.code].some((w) => (w & 0xff) === Op.EXTRA)).toBe(false)

    // Determinism: recompiling produces identical hash
    const parsed2 = parseVmSource(src)
    expect(parsed2.ok).toBe(true)
    if (parsed2.ok) {
      expect(hashOf(compileSource(parsed2.source, { noCache: true }))).toBe(hashOf(codes))
    }

    // padA on pass 0: 1500 iterations; sum_{i=0..1499} ((i % 7) + 8)
    let expectedPadA = 0
    for (let i = 0; i < 1500; i++) expectedPadA += (i % 7) + 8
    let expectedGenPad = 0
    for (let i = 0; i < 2800; i++) expectedGenPad += (i % 7) + 8

    // trace: pass 0 (+1), pass 1 (+10), pass 2 (+100+200=300), for-in (+2), smallGen (+30), lateAsyncGen (+5+10+20=35) => 378
    expect(value).toEqual({
      mainRes: [21, 10, expectedPadA * 2, 378, 13, 7, "late-reject", "ok"],
      gSteps: [1, 10, 20, expectedGenPad + 4, 18],
    })
  }, 15_000)

  // Compiling a >65,535-word program and round-tripping 8 full snapshots takes ~8-9s on loaded Windows runners.
  test("top-level script >65,535 words runs correctly and survives snapshot round-trips at pc > 65,535", () => {
    const src = `
      function hoistedTop(n) { return n + 42 }
      function* topGen() {
        yield 3
        yield 4
      }
      let padAcc = 0
      let padCond = true
      let total = 0

      // Jump forward over >70,000 words on iteration 0, execute padding on iteration 1, then run post-65,535 loops
      for (let round = 0; round < 2; round++) {
        if (round === 0) {
          ${makePaddingBlock(2800, "padAcc", "padCond")}
        } else {
          total += hoistedTop(8)
        }
      }

      // Now at pc > 70,000 in top-level <program>: exercise loop, try/finally, generator for...of, and top-level await
      try {
        for (let k = 0; k < 25; k++) {
          total += k
        }
        for (const v of topGen()) {
          total += v
        }
        total += await Promise.resolve(100)
      } finally {
        total += 1
      }

      return [padAcc, total]
    `

    const compiled = compileVerified(src)
    expect(compiled.codes[0]!.code.length).toBeGreaterThan(70_000)

    let expectedPad = 0
    for (let i = 0; i < 2800; i++) expectedPad += (i % 7) + 8
    // hoistedTop(8)=50, sum(0..24)=300, topGen=7, await=100, finally=1 => 458
    const expected = [expectedPad, 458]

    // First verify normal execution
    expect(runProgram(src)).toEqual({ ok: true, value: expected, toolCalls: [] })

    // Now run through snapshot round-trip mode, slicing inside both the padding loop and the >70,000-pc tail loop
    let trips = 0
    let sawHighPc = false
    const roundTripped = runProgram(src, {
      roundTrip: { every: 6, max: 8 },
      onTrip: (snap) => {
        trips++
        const text = JSON.stringify(snap)
        for (const rec of snap.records) {
          if (rec.t === "Frame" && Array.isArray(rec.f) && typeof rec.f[2] === "number" && rec.f[2] > 65_535) {
            sawHighPc = true
          }
        }
        expect(text.length).toBeGreaterThan(0)
      },
    })
    expect(roundTripped).toEqual({ ok: true, value: expected, toolCalls: [] })
    expect(trips).toBeGreaterThan(2)
    expect(sawHighPc).toBe(true)
  }, 15_000)
})
