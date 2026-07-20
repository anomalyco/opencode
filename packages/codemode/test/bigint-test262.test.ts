/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/language/literals/bigint/numeric-separators/numeric-separator-literal-hil-hds-nsl-hds.js
 * - test/language/expressions/addition/bigint-arithmetic.js
 * - test/language/expressions/addition/bigint-and-number.js
 * - test/language/expressions/subtraction/bigint-arithmetic.js
 * - test/language/expressions/multiplication/bigint-arithmetic.js
 * - test/language/expressions/division/bigint-arithmetic.js
 * - test/language/expressions/division/bigint-complex-infinity.js
 * - test/language/expressions/modulus/bigint-arithmetic.js
 * - test/language/expressions/exponentiation/bigint-arithmetic.js
 * - test/language/expressions/exponentiation/bigint-negative-exponent-throws.js
 * - test/language/expressions/equals/bigint-and-number.js
 * - test/language/expressions/less-than/bigint-and-number.js
 * - test/language/expressions/bitwise-and/bigint.js
 * - test/language/expressions/bitwise-or/bigint.js
 * - test/language/expressions/bitwise-xor/bigint.js
 * - test/language/expressions/left-shift/bigint.js
 * - test/language/expressions/right-shift/bigint.js
 * - test/language/expressions/prefix-increment/bigint.js
 * - test/language/expressions/unary-plus/bigint-throws.js
 * - test/language/expressions/unsigned-right-shift/bigint.js
 *
 * Copyright (C) 2017 Josh Wolfe. All rights reserved.
 * Copyright (C) 2017 Robin Templeton. All rights reserved.
 * Copyright (C) 2018 Igalia, S.L. All rights reserved.
 * Copyright (C) 2019 Leo Balter. All rights reserved.
 * Test262 portions are governed by the BSD license in LICENSE.test262.
 * Assertions are grouped into CodeMode programs and return booleans or strings
 * because BigInt intentionally cannot cross CodeMode's JSON-like boundary.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"

const execute = (code: string) => Effect.runPromise(CodeMode.execute({ code, tools: {} }))

const value = async (code: string) => {
  const result = await execute(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

describe("BigInt Test262 parity", () => {
  test("supports literal bases and numeric separators", async () => {
    expect(
      await value(`
        return [
          0n === 0x0n,
          255n === 0xffn,
          10n === 0b1010n,
          63n === 0o77n,
          1_000_000n === 1000000n,
          0x01_00n === 0X0100n,
          typeof 1n === "bigint",
        ]
      `),
    ).toEqual([true, true, true, true, true, true, true])
  })

  test("applies BigInt arithmetic, unary, bitwise, shift, and assignment operators", async () => {
    expect(
      await value(`
        let assigned = 5n
        assigned += 2n
        assigned **= 2n
        assigned >>= 1n
        return [
          0xFEDCBA9876543210n + 0x1234n === 0xFEDCBA9876544444n,
          9n - 14n === -5n,
          12n * 11n === 132n,
          0x1234n / 0x3n === 0x611n,
          -7n / 3n === -2n,
          -7n % 3n === -1n,
          3n ** 5n === 243n,
          -(-8n) === 8n,
          ~0n === -1n,
          (0b1100n & 0b1010n) === 0b1000n,
          (0b1100n | 0b0011n) === 0b1111n,
          (0b1100n ^ 0b1010n) === 0b0110n,
          (0b101n << 3n) === 0b101000n,
          (-5n << -1n) === -3n,
          (-9n >> 2n) === -3n,
          assigned === 24n,
        ]
      `),
    ).toEqual(new Array(16).fill(true))
  })

  test("preserves BigInt through updates and nested interpreter data", async () => {
    expect(
      await value(`
        let direct = 0n
        const record = { value: 0x1fffffffffffff00n }
        const nested = [null, [null, null, 0n]]
        const before = direct++
        const after = --direct
        const recordValue = ++record.value
        const nestedValue = ++nested[1][2]
        return [
          before === 0n,
          after === 0n,
          direct === 0n,
          recordValue === 0x1fffffffffffff01n,
          record.value === 0x1fffffffffffff01n,
          nestedValue === 1n,
          nested[1][2] === 1n,
        ]
      `),
    ).toEqual(new Array(7).fill(true))
  })

  test("supports BigInt comparisons and string interactions", async () => {
    expect(
      await value(`
        return [
          1n == 1,
          1n !== 1,
          0n < 0.000000000001,
          0.999999999999 < 1n,
          10n > 9,
          10n >= 10,
          -1n <= -1,
          1n == "1",
          1n != "1.5",
          1n + " item" === "1 item",
          \`value=\${255n}\` === "value=255",
        ]
      `),
    ).toEqual(new Array(11).fill(true))
  })

  test("throws for mixed numeric arithmetic and unsupported BigInt operations", async () => {
    expect(
      await value(`
        const typeError = (operation) => {
          try {
            operation()
            return false
          } catch (error) {
            return error instanceof TypeError
          }
        }
        const rangeError = (operation) => {
          try {
            operation()
            return false
          } catch (error) {
            return error instanceof RangeError
          }
        }
        return [
          typeError(() => 1n + 1),
          typeError(() => 1 - 1n),
          typeError(() => 1n * true),
          typeError(() => 1n & 1),
          typeError(() => 1n << 1),
          typeError(() => +1n),
          typeError(() => 5n >>> 1n),
          rangeError(() => 1n / 0n),
          rangeError(() => 2n ** -1n),
        ]
      `),
    ).toEqual(new Array(9).fill(true))
  })
})

describe("BigInt JSON-like boundaries", () => {
  test("rejects BigInt program results", async () => {
    for (const code of [`return 1n`, `return { value: 1n }`, `return [1n]`]) {
      const result = await execute(code)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe("InvalidDataValue")
    }
  })

  test("rejects BigInt in JSON.stringify and tool arguments", async () => {
    const stringified = await execute(`return JSON.stringify({ value: 1n })`)
    expect(stringified.ok).toBe(false)
    if (!stringified.ok) expect(stringified.error.kind).toBe("InvalidDataValue")

    const capture = Tool.make({
      description: "Capture an input",
      input: Schema.Unknown,
      output: Schema.String,
      run: () => Effect.succeed("ok"),
    })
    const argument = await Effect.runPromise(
      CodeMode.execute({ code: `return await tools.capture({ value: 1n })`, tools: { capture } }),
    )
    expect(argument.ok).toBe(false)
    if (!argument.ok) expect(argument.error.kind).toBe("InvalidDataValue")
  })

  test("rejects BigInt tool results", async () => {
    const provide = Tool.make({
      description: "Return a BigInt",
      input: Schema.Struct({}),
      output: Schema.Unknown,
      run: () => Effect.succeed(1n),
    })
    const result = await Effect.runPromise(
      CodeMode.execute({ code: `return await tools.provide({})`, tools: { provide } }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe("InvalidToolOutput")
  })
})

describe("BigInt resource bound", () => {
  const separate = (digits: string) => digits.match(/.{1,32}/g)!.join("_")
  const decimalMaximum = ((1n << 4_096n) - 1n).toString()

  test("accepts 4,096-bit literal boundaries for every radix and separators", async () => {
    for (const literal of [
      `${separate(decimalMaximum)}n`,
      `0x${separate(`8${"0".repeat(1_023)}`)}n`,
      `0o${separate(`1${"0".repeat(1_365)}`)}n`,
      `0b${separate(`1${"0".repeat(4_095)}`)}n`,
    ]) {
      const result = await Effect.runPromise(
        CodeMode.execute({ code: `return typeof ${literal} === "bigint"`, tools: {}, limits: { timeoutMs: 1 } }),
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe(true)
    }
  })

  test("rejects necessarily oversized literal boundaries before parsing", async () => {
    for (const literal of [
      `${1n << 4_096n}n`,
      `0x1${"0".repeat(1_024)}n`,
      `0o2${"0".repeat(1_365)}n`,
      `0b${separate(`1${"0".repeat(4_096)}`)}n`,
    ]) {
      const result = await Effect.runPromise(
        CodeMode.execute({ code: `return ${literal}`, tools: {}, limits: { timeoutMs: 1 } }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe("InvalidDataValue")
        expect(result.error.message).toContain("literal source")
        expect(result.error.message).toContain("before parsing")
      }
    }
  })

  test("ignores BigInt-shaped text outside numeric literals", async () => {
    const oversized = `0b1${"0".repeat(4_096)}n`
    expect(await value(`const text = "${oversized}"; return text.length`)).toBe(4_100)
    expect(await value(`/* ${oversized} */ return true`)).toBe(true)
    expect(await value(`return \`${oversized}\`.length`)).toBe(4_100)
    expect(await value(`return /${oversized}/.test("no")`)).toBe(false)
    expect(await value(`if (true) /${oversized}/.test("no"); return true`)).toBe(true)
  })

  test("rejects very large literal source promptly despite a one-millisecond timeout", async () => {
    const started = performance.now()
    for (const digits of [500_000, 2_000_000]) {
      const result = await Effect.runPromise(
        CodeMode.execute({
          code: `return 0b1${"0".repeat(digits)}n`,
          tools: {},
          limits: { timeoutMs: 1 },
        }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe("InvalidDataValue")
        expect(result.error.message).toContain("before parsing")
      }
    }
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  test("rejects huge literals after Unicode whitespace", async () => {
    const literal = `0b1${"0".repeat(500_000)}n`
    for (const whitespace of ["\u00a0", "\u2003"]) {
      const result = await Effect.runPromise(
        CodeMode.execute({ code: `return${whitespace}${literal}`, tools: {}, limits: { timeoutMs: 1 } }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe("InvalidDataValue")
        expect(result.error.message).toContain("before parsing")
      }
    }
  })

  test("keeps Unicode identifier adjacency distinct from literals", async () => {
    const suffix = `0b1${"0".repeat(4_096)}n`
    expect(await value(`const π${suffix} = 1; return true`)).toBe(true)
    expect(await value(`const 𐐀${suffix} = 1; return true`)).toBe(true)
  })

  test("accepts precise safe multiplication and power-of-two exponentiation boundaries", async () => {
    const maximumBit = `0b1${"0".repeat(4_095)}n`
    expect(
      await value(`
        const value = ${maximumBit}
        return [
          value * 1n === value,
          value * -1n === -value,
          1n * value === value,
          -1n * value === -value,
          2n ** 4095n === value,
        ]
      `),
    ).toEqual(new Array(5).fill(true))
  })

  test("rejects expensive operations before native evaluation", async () => {
    for (const code of [
      `const value = 1n << 2_048n; return value * value`,
      `return 16n ** 1_024n`,
      `return 2n ** 4_096n`,
      `return 1n << 4_096n`,
      `return 1n >> -4_096n`,
    ]) {
      const result = await execute(code)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe("InvalidDataValue")
        expect(result.error.message).toContain("may exceed CodeMode's 4096-bit limit")
      }
    }
  })

  test("rejects oversized results from non-preflighted operations", async () => {
    for (const code of [
      `const value = 1n << 4_095n; return value + value`,
      `let value = ${`0b${"1".repeat(4_096)}n`}; value++; return true`,
    ]) {
      const result = await execute(code)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe("InvalidDataValue")
        expect(result.error.message).toContain("exceeds CodeMode's 4096-bit BigInt limit")
      }
    }
  })

  test("does not let synchronous BigInt work bypass a one-millisecond timeout", async () => {
    const result = await Effect.runPromise(
      CodeMode.execute({
        code: `
          for (let index = 0; index < 20; index++) {
            const huge = 1n << 499_999n
            huge * huge
          }
          return true
        `,
        tools: {},
        limits: { timeoutMs: 1 },
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("InvalidDataValue")
      expect(result.error.message).toContain("may exceed CodeMode's 4096-bit limit")
    }
  })
})
