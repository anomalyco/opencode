/**
 * Portions adapted from web-platform-tests at revision 863077959ca8c1a7ceecfbe2534b75d2527b9013:
 * - html/webappapis/structured-clone/structured-clone-battery-of-tests.js
 *
 * Copyright © web-platform-tests contributors. Governed by the 3-Clause BSD license in LICENSE.wpt.
 *
 * The battery's `check(description, input, compare)` shape and its `compare_*` helpers are kept, run
 * inside the interpreter. Ported: primitives, Array/Object of primitives, Date, RegExp, Error, sparse
 * arrays, identical (shared) property values, and the index-property-plus-length object. Not portable:
 * boxed primitives, BigInt, Blob/File/ImageData/ArrayBuffer/typed arrays (no binary values), circular
 * references (rejected at insertion here), property descriptors and prototype properties (no
 * defineProperty or prototypes), and the throwing-getter case (no getters). `assert_throws_dom` for
 * `DataCloneError` becomes an `error.name` check.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

const value = async (code: string) => {
  const result = await Effect.runPromise(CodeMode.execute({ code, tools: {} }))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

// The WPT harness, minus async: assertions push a failure description instead of throwing so one run
// reports every failing check.
const harness = `
  const failures = []
  const assert_equals = (a, b, m) => { if (!Object.is(a, b) && !(a !== a && b !== b)) failures.push((m ?? "") + ": " + String(a) + " !== " + String(b)) }
  const assert_not_equals = (a, b, m) => { if (a === b) failures.push((m ?? "") + ": unexpectedly identical") }
  const assert_true = (a, m) => { if (a !== true) failures.push((m ?? "") + ": not true") }
  const assert_false = (a, m) => { if (a !== false) failures.push((m ?? "") + ": not false") }
  let current = ""
  function check(description, input, callback) {
    current = description
    const newInput = typeof input === "function" ? input() : input
    const copy = structuredClone(newInput)
    const before = failures.length
    callback(copy, newInput)
    for (let i = before; i < failures.length; i++) failures[i] = description + " — " + failures[i]
  }
  function compare_primitive(actual, input) { assert_equals(actual, input) }
  function compare_Array(callback) {
    return function (actual, input) {
      assert_true(Array.isArray(actual), "instanceof Array")
      assert_not_equals(actual, input)
      assert_equals(actual.length, input.length, "length")
      callback(actual, input)
    }
  }
  function compare_Object(callback) {
    return function (actual, input) {
      assert_true(actual instanceof Object, "instanceof Object")
      assert_false(Array.isArray(actual), "instanceof Array")
      assert_not_equals(actual, input)
      callback(actual, input)
    }
  }
  function enumerate_props(compare_func) {
    return function (actual, input) { for (const x in input) compare_func(actual[x], input[x]) }
  }
`

describe("structuredClone WPT battery", () => {
  test("primitives, and arrays and objects of primitives", async () => {
    expect(
      await value(`
        ${harness}
        check('primitive undefined', undefined, compare_primitive)
        check('primitive null', null, compare_primitive)
        check('primitive true', true, compare_primitive)
        check('primitive false', false, compare_primitive)
        check('primitive string, empty string', '', compare_primitive)
        check('primitive string, lone high surrogate', '\\uD800', compare_primitive)
        check('primitive string, lone low surrogate', '\\uDC00', compare_primitive)
        check('primitive string, NUL', '\\u0000', compare_primitive)
        check('primitive string, astral character', '\\uDBFF\\uDFFD', compare_primitive)
        check('primitive number, 0.2', 0.2, compare_primitive)
        check('primitive number, 0', 0, compare_primitive)
        check('primitive number, -0', -0, compare_primitive)
        check('primitive number, NaN', NaN, compare_primitive)
        check('primitive number, Infinity', Infinity, compare_primitive)
        check('primitive number, -Infinity', -Infinity, compare_primitive)
        check('primitive number, 9007199254740992', 9007199254740992, compare_primitive)
        check('primitive number, -9007199254740992', -9007199254740992, compare_primitive)
        check('primitive number, 9007199254740994', 9007199254740994, compare_primitive)
        check('primitive number, -9007199254740994', -9007199254740994, compare_primitive)
        check('Array primitives', [undefined, null, true, false, '', '\\uD800', '\\uDC00', '\\u0000', '\\uDBFF\\uDFFD',
          0.2, 0, -0, NaN, Infinity, -Infinity, 9007199254740992, -9007199254740992, 9007199254740994, -9007199254740994],
          compare_Array(enumerate_props(compare_primitive)))
        check('Object primitives', { 'undefined': undefined, 'null': null, 'true': true, 'false': false, 'empty': '',
          'high surrogate': '\\uD800', 'low surrogate': '\\uDC00', 'nul': '\\u0000', 'astral': '\\uDBFF\\uDFFD',
          '0.2': 0.2, '0': 0, '-0': -0, 'NaN': NaN, 'Infinity': Infinity, '-Infinity': -Infinity,
          '9007199254740992': 9007199254740992, '-9007199254740992': -9007199254740992,
          '9007199254740994': 9007199254740994, '-9007199254740994': -9007199254740994 },
          compare_Object(enumerate_props(compare_primitive)))
        return failures
      `),
    ).toEqual([])
  })

  test("Date", async () => {
    expect(
      await value(`
        ${harness}
        function compare_Date(actual, input) {
          assert_true(actual instanceof Date, 'instanceof Date')
          assert_equals(Number(actual), Number(input), 'converted to primitive')
          assert_not_equals(actual, input)
        }
        check('Date 0', new Date(0), compare_Date)
        check('Date -0', new Date(-0), compare_Date)
        check('Date -8.64e15', new Date(-8.64e15), compare_Date)
        check('Date 8.64e15', new Date(8.64e15), compare_Date)
        check('Array Date objects', [new Date(0), new Date(-0), new Date(-8.64e15), new Date(8.64e15)],
          compare_Array(enumerate_props(compare_Date)))
        check('Object Date objects', { '0': new Date(0), '-0': new Date(-0), '-8.64e15': new Date(-8.64e15), '8.64e15': new Date(8.64e15) },
          compare_Object(enumerate_props(compare_Date)))
        return failures
      `),
    ).toEqual([])
  })

  test("RegExp: flags copied, lastIndex reset, source escaped", async () => {
    expect(
      await value(`
        ${harness}
        function compare_RegExp(expected_source) {
          return function (actual, input) {
            assert_true(actual instanceof RegExp, 'instanceof RegExp')
            assert_equals(actual.global, input.global, 'global')
            assert_equals(actual.ignoreCase, input.ignoreCase, 'ignoreCase')
            assert_equals(actual.multiline, input.multiline, 'multiline')
            assert_equals(actual.source, expected_source, 'source')
            assert_equals(actual.sticky, input.sticky, 'sticky')
            assert_equals(actual.unicode, input.unicode, 'unicode')
            assert_equals(actual.lastIndex, 0, 'lastIndex')
            assert_not_equals(actual, input)
          }
        }
        function func_RegExp_flags_lastIndex() {
          const r = /foo/gim
          r.lastIndex = 2
          return r
        }
        function func_RegExp_sticky() { return new RegExp('foo', 'y') }
        function func_RegExp_unicode() { return new RegExp('foo', 'u') }
        check('RegExp flags and lastIndex', func_RegExp_flags_lastIndex, compare_RegExp('foo'))
        check('RegExp sticky flag', func_RegExp_sticky, compare_RegExp('foo'))
        check('RegExp unicode flag', func_RegExp_unicode, compare_RegExp('foo'))
        check('RegExp empty', new RegExp(''), compare_RegExp('(?:)'))
        check('RegExp slash', new RegExp('/'), compare_RegExp('\\\\/'))
        check('RegExp new line', new RegExp('\\n'), compare_RegExp('\\\\n'))
        check('Array RegExp object, RegExp flags and lastIndex', [func_RegExp_flags_lastIndex()], compare_Array(enumerate_props(compare_RegExp('foo'))))
        check('Array RegExp object, RegExp sticky flag', function () { return [func_RegExp_sticky()] }, compare_Array(enumerate_props(compare_RegExp('foo'))))
        check('Array RegExp object, RegExp unicode flag', function () { return [func_RegExp_unicode()] }, compare_Array(enumerate_props(compare_RegExp('foo'))))
        check('Array RegExp object, RegExp empty', [new RegExp('')], compare_Array(enumerate_props(compare_RegExp('(?:)'))))
        check('Array RegExp object, RegExp slash', [new RegExp('/')], compare_Array(enumerate_props(compare_RegExp('\\\\/'))))
        check('Array RegExp object, RegExp new line', [new RegExp('\\n')], compare_Array(enumerate_props(compare_RegExp('\\\\n'))))
        check('Object RegExp object, RegExp flags and lastIndex', { 'x': func_RegExp_flags_lastIndex() }, compare_Object(enumerate_props(compare_RegExp('foo'))))
        check('Object RegExp object, RegExp sticky flag', function () { return { 'x': func_RegExp_sticky() } }, compare_Object(enumerate_props(compare_RegExp('foo'))))
        check('Object RegExp object, RegExp unicode flag', function () { return { 'x': func_RegExp_unicode() } }, compare_Object(enumerate_props(compare_RegExp('foo'))))
        check('Object RegExp object, RegExp empty', { 'x': new RegExp('') }, compare_Object(enumerate_props(compare_RegExp('(?:)'))))
        check('Object RegExp object, RegExp slash', { 'x': new RegExp('/') }, compare_Object(enumerate_props(compare_RegExp('\\\\/'))))
        check('Object RegExp object, RegExp new line', { 'x': new RegExp('\\n') }, compare_Object(enumerate_props(compare_RegExp('\\\\n'))))
        return failures
      `),
    ).toEqual([])
  })

  test("Error: name and message kept, custom properties dropped", async () => {
    expect(
      await value(`
        ${harness}
        function compare_Error(actual, input) {
          assert_true(actual instanceof Error, "Checking instanceof")
          assert_equals(actual.name, input.name, "Checking name")
          assert_equals(Object.hasOwn(actual, "message"), Object.hasOwn(input, "message"), "Checking message existence")
          assert_equals(actual.message, input.message, "Checking message")
          assert_equals(actual.foo, undefined, "Checking for absence of custom property")
        }
        check('Empty Error object', new Error(), compare_Error)
        for (const constructor of [Error, RangeError, ReferenceError, SyntaxError, TypeError, URIError]) {
          check(constructor.name, () => {
            const error = new constructor("Error message here")
            error.foo = "testing"
            return error
          }, compare_Error)
        }
        return failures
      `),
    ).toEqual([])
  })

  test("sparse arrays, index-property objects, and identical property values", async () => {
    expect(
      await value(`
        ${harness}
        check('Array sparse', new Array(10), compare_Array(enumerate_props(compare_primitive)))
        check('Object with index property and length', { '0': 'foo', 'length': 1 }, compare_Object(enumerate_props(compare_primitive)))
        function check_identical_property_values(prop1, prop2) {
          return function (actual) { assert_equals(actual[prop1], actual[prop2]) }
        }
        check('Array with identical property values', function () {
          const obj = {}
          return [obj, obj]
        }, compare_Array(check_identical_property_values('0', '1')))
        check('Object with identical property values', function () {
          const obj = {}
          return { 'x': obj, 'y': obj }
        }, compare_Object(check_identical_property_values('x', 'y')))
        return failures
      `),
    ).toEqual([])
  })
})

describe("structuredClone beyond the WPT battery", () => {
  test("Map, Set, URL, and URLSearchParams are copied, with shared references preserved across containers", async () => {
    expect(
      await value(`
        const shared = { n: 1 }
        const input = { m: new Map([[shared, shared]]), s: new Set([shared]), u: new URL("https://a.b/c?d=1") }
        const copy = structuredClone(input)
        const [[key, item]] = [...copy.m]
        copy.u.searchParams.set("d", "2")
        return [
          copy.m !== input.m, key !== shared, key === item, key === [...copy.s][0],
          copy.u !== input.u, input.u.href, copy.u.href,
        ]
      `),
    ).toEqual([true, true, true, true, true, "https://a.b/c?d=1", "https://a.b/c?d=2"])
  })

  test("functions, promises, and tool references throw DataCloneError", async () => {
    expect(
      await value(`
        return [() => 1, Promise.resolve(1), tools, Math, { nested: [() => 1] }].map((input) => {
          try { structuredClone(input); return "cloned" } catch (error) { return error.name }
        })
      `),
    ).toEqual(Array(5).fill("DataCloneError"))
    expect(await value(`try { structuredClone() } catch (error) { return error.name }`)).toBe("TypeError")
  })
})
