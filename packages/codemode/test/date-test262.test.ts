/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/built-ins/Date/prototype/setTime/arg-to-number.js
 * - test/built-ins/Date/prototype/setTime/arg-to-number-err.js
 * - test/built-ins/Date/prototype/setTime/new-value-time-clip.js
 * - test/built-ins/Date/prototype/setMilliseconds/this-value-valid-date.js
 * - test/built-ins/Date/prototype/setUTCMilliseconds/this-value-valid-date.js
 * - test/built-ins/Date/prototype/setSeconds/this-value-valid-date-sec.js
 * - test/built-ins/Date/prototype/setSeconds/this-value-valid-date-ms.js
 * - test/built-ins/Date/prototype/setUTCSeconds/this-value-valid-date-sec.js
 * - test/built-ins/Date/prototype/setUTCSeconds/this-value-valid-date-ms.js
 * - test/built-ins/Date/prototype/setMinutes/this-value-valid-date.js
 * - test/built-ins/Date/prototype/setUTCMinutes/this-value-valid-date.js
 * - test/built-ins/Date/prototype/setHours/this-value-valid-date-hour.js
 * - test/built-ins/Date/prototype/setHours/this-value-valid-date-min.js
 * - test/built-ins/Date/prototype/setHours/this-value-valid-date-sec.js
 * - test/built-ins/Date/prototype/setHours/this-value-valid-date-ms.js
 * - test/built-ins/Date/prototype/setUTCHours/this-value-valid-date-hour.js
 * - test/built-ins/Date/prototype/setUTCHours/this-value-valid-date-min.js
 * - test/built-ins/Date/prototype/setUTCHours/this-value-valid-date-sec.js
 * - test/built-ins/Date/prototype/setUTCHours/this-value-valid-date-ms.js
 * - test/built-ins/Date/prototype/setDate/this-value-valid-date.js
 * - test/built-ins/Date/prototype/setUTCDate/date-value-read-before-tonumber-when-date-is-valid.js
 * - test/built-ins/Date/prototype/setMonth/this-value-valid-date-month.js
 * - test/built-ins/Date/prototype/setMonth/this-value-valid-date-date.js
 * - test/built-ins/Date/prototype/setUTCMonth/this-value-valid-date-month.js
 * - test/built-ins/Date/prototype/setUTCMonth/this-value-valid-date-date.js
 * - test/built-ins/Date/prototype/setFullYear/this-value-valid-date-year.js
 * - test/built-ins/Date/prototype/setFullYear/this-value-valid-date-month.js
 * - test/built-ins/Date/prototype/setFullYear/this-value-valid-date-date.js
 * - test/built-ins/Date/prototype/setFullYear/this-value-invalid-date.js
 * - test/built-ins/Date/prototype/setFullYear/arg-year-to-number-err.js
 * - test/built-ins/Date/prototype/setFullYear/arg-month-to-number-err.js
 * - test/built-ins/Date/prototype/setFullYear/arg-date-to-number-err.js
 * - test/built-ins/Date/prototype/setUTCFullYear/date-value-read-before-tonumber-when-date-is-invalid.js
 * - test/built-ins/Date/prototype/setMonth/arg-coercion-order.js
 * - test/language/expressions/addition/S11.6.1_A2.2_T2.js
 *
 * Copyright (C) 2016 the V8 project authors. All rights reserved.
 * Copyright (C) 2021 Kevin Gibbons. All rights reserved.
 * Copyright (C) 2024 André Bargull. All rights reserved.
 * Copyright 2009 the Sputnik authors. All rights reserved.
 * Test262 portions are governed by the BSD license in LICENSE.test262.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

const value = async (code: string) => {
  const result = await Effect.runPromise(CodeMode.execute({ code, tools: {} }))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

describe("Date setter Test262 parity", () => {
  test("UTC setters mutate every supported component and return the new time", async () => {
    expect(
      await value(`
        const create = () => new Date(Date.UTC(2000, 0, 2, 3, 4, 5, 6))
        const result = []
        let date = create()
        result.push([date.setTime(1234) === date.getTime(), date.getTime()])
        date = create()
        result.push([date.setUTCMilliseconds(10) === date.getTime(), date.getUTCMilliseconds()])
        date = create()
        result.push([date.setUTCSeconds(10, 11) === date.getTime(), date.getUTCSeconds(), date.getUTCMilliseconds()])
        date = create()
        result.push([date.setUTCMinutes(10, 11, 12) === date.getTime(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()])
        date = create()
        result.push([date.setUTCHours(10, 11, 12, 13) === date.getTime(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()])
        date = create()
        result.push([date.setUTCDate(10) === date.getTime(), date.getUTCDate()])
        date = create()
        result.push([date.setUTCMonth(6, 10) === date.getTime(), date.getUTCMonth(), date.getUTCDate()])
        date = create()
        result.push([date.setUTCFullYear(2020, 6, 10) === date.getTime(), date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()])
        return result
      `),
    ).toEqual([
      [true, 1234],
      [true, 10],
      [true, 10, 11],
      [true, 10, 11, 12],
      [true, 10, 11, 12, 13],
      [true, 10],
      [true, 6, 10],
      [true, 2020, 6, 10],
    ])
  })

  test("local setters mutate every supported component", async () => {
    expect(
      await value(`
        const create = () => new Date(2000, 0, 2, 3, 4, 5, 6)
        const result = []
        let date = create()
        date.setMilliseconds(10)
        result.push(date.getMilliseconds())
        date = create()
        date.setSeconds(10, 11)
        result.push([date.getSeconds(), date.getMilliseconds()])
        date = create()
        date.setMinutes(10, 11, 12)
        result.push([date.getMinutes(), date.getSeconds(), date.getMilliseconds()])
        date = create()
        date.setHours(10, 11, 12, 13)
        result.push([date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()])
        date = create()
        date.setDate(10)
        result.push(date.getDate())
        date = create()
        date.setMonth(6, 10)
        result.push([date.getMonth(), date.getDate()])
        date = create()
        date.setFullYear(2020, 6, 10)
        result.push([date.getFullYear(), date.getMonth(), date.getDate()])
        return result
      `),
    ).toEqual([10, [10, 11], [10, 11, 12], [10, 11, 12, 13], 10, [6, 10], [2020, 6, 10]])
  })

  test("setter arguments use numeric coercion in source order", async () => {
    expect(
      await value(`
        const calls = []
        const date = new Date(0)
        const returned = date.setUTCSeconds(
          { valueOf: () => { calls.push("seconds"); return "2" } },
          { valueOf: () => { calls.push("milliseconds"); return true } },
        )
        const fallback = new Date(0)
        fallback.setTime({ valueOf: () => ({}), toString: () => "3" })
        return [returned === date.getTime(), date.getUTCSeconds(), date.getUTCMilliseconds(), fallback.getTime(), calls]
      `),
    ).toEqual([true, 2, 1, 3, ["seconds", "milliseconds"]])
  })

  test("setters snapshot the Date before coercing arguments", async () => {
    expect(
      await value(`
        const date = new Date(Date.UTC(2000, 5, 15, 1, 2, 3, 4))
        date.setUTCFullYear({
          valueOf: () => {
            date.setTime(Date.UTC(2020, 11, 20))
            return 2001
          },
        })

        const invalid = new Date(NaN)
        invalid.setUTCFullYear({ valueOf: () => { invalid.setTime(0); return 1 } })

        const effects = []
        const staysInvalid = new Date(NaN)
        const result = staysInvalid.setUTCMonth(
          { valueOf: () => { effects.push("month"); return 0 } },
          { valueOf: () => { effects.push("date"); return 1 } },
        )
        return [
          date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
          invalid.getUTCFullYear(), invalid.getUTCMonth(), invalid.getUTCDate(),
          Number.isNaN(result), Number.isNaN(staysInvalid.getTime()), effects,
        ]
      `),
    ).toEqual([2001, 5, 15, 1, 0, 1, true, true, ["month", "date"]])
  })

  test("setFullYear recovers an invalid local Date", async () => {
    expect(
      await value(`
        const year = new Date(NaN)
        const yearResult = year.setFullYear(2016)
        const month = new Date(NaN)
        const monthResult = month.setFullYear(2016, 6)
        const day = new Date(NaN)
        const dayResult = day.setFullYear(2016, 6, 7)
        return [
          yearResult === year.getTime(), year.getFullYear(), year.getMonth(), year.getDate(),
          monthResult === month.getTime(), month.getFullYear(), month.getMonth(), month.getDate(),
          dayResult === day.getTime(), day.getFullYear(), day.getMonth(), day.getDate(),
        ]
      `),
    ).toEqual([true, 2016, 0, 1, true, 2016, 6, 1, true, 2016, 6, 7])
  })

  test("abrupt argument coercion stops later coercion and preserves the Date", async () => {
    expect(
      await value(`
        const calls = []
        const failure = { valueOf: () => { throw new Error("stop") } }
        const counter = { valueOf: () => { calls.push("counter"); return 1 } }
        const results = []

        const time = new Date(0)
        try { time.setTime(failure) } catch (error) { results.push(error.message) }
        results.push(time.getTime())

        const year = new Date(0)
        try { year.setFullYear(failure, counter, counter) } catch (error) { results.push(error.message) }
        results.push(year.getTime())

        const month = new Date(0)
        try { month.setFullYear(0, failure, counter) } catch (error) { results.push(error.message) }
        results.push(month.getTime())

        const day = new Date(0)
        try { day.setFullYear(0, 0, failure) } catch (error) { results.push(error.message) }
        results.push(day.getTime(), calls)
        return results
      `),
    ).toEqual(["stop", 0, "stop", 0, "stop", 0, "stop", 0, []])
  })

  test("omitted arguments, explicit undefined, extra arguments, and TimeClip match native behavior", async () => {
    expect(
      await value(`
        const calls = []
        const omittedOptional = new Date(0)
        const explicitUndefined = new Date(0)
        const noArgument = new Date(0)
        const extra = new Date(0)
        const clipped = new Date(0)
        const badPrimitive = new Date(0)
        let conversionError = ""
        try {
          badPrimitive.setTime({ valueOf: () => ({}), toString: () => ({}) })
        } catch (error) {
          conversionError = error.name
        }
        return [
          omittedOptional.setUTCSeconds(1),
          Number.isNaN(explicitUndefined.setUTCSeconds(1, undefined)),
          Number.isNaN(noArgument.setTime()),
          extra.setTime(1, { valueOf: () => { calls.push("extra"); return 2 } }),
          calls,
          Number.isNaN(clipped.setTime(8.64e15 + 1)),
          Number.isNaN(clipped.getTime()),
          conversionError,
        ]
      `),
    ).toEqual([1000, true, true, 1, [], true, true, "TypeError"])
  })
})

describe("Date default primitive Test262 parity", () => {
  test("addition and loose equality use the Date string primitive", async () => {
    expect(
      await value(`
        const date = new Date(0)
        const text = String(date)
        return [
          date + date === text + text,
          date + 0 === text + "0",
          date + true === text + "true",
          date == text,
          text == date,
          date == Number(date),
          Number(date) == date,
          date != Number(date),
          date == date,
          date == new Date(0),
          date == null,
        ]
      `),
    ).toEqual([true, true, true, true, true, false, false, true, true, false, false])
  })
})
