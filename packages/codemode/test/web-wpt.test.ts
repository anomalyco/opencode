/**
 * Portions adapted from web-platform-tests at revision 863077959ca8c1a7ceecfbe2534b75d2527b9013:
 * - html/webappapis/atob/base64.any.js (btoa reference encoder, input list, and atob WebIDL cases)
 * - fetch/data-urls/resources/base64.json (copied to fixtures/wpt-base64.json)
 * - WebCryptoAPI/randomUUID.https.any.js
 * - fetch/api/headers/{headers-basic,headers-errors}.any.js
 *
 * Copyright © web-platform-tests contributors. Governed by the 3-Clause BSD license in LICENSE.wpt.
 *
 * `assert_throws_dom("InvalidCharacterError", …)` becomes a check for a TypeError: CodeMode has no DOMException.
 * Headers cases that need `Symbol.iterator`, iterator objects from `keys()`/`values()`/`entries()` (CodeMode returns
 * arrays), or a custom iterator on a Headers instance are left out.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

const base64Cases = (await Bun.file(new URL("./fixtures/wpt-base64.json", import.meta.url)).json()) as Array<
  [string, Array<number> | null]
>

const value = async (code: string) => {
  const result = await Effect.runPromise(CodeMode.execute({ code, tools: {} }))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

// The reference encoder from base64.any.js, run inside the interpreter so btoa is checked against
// an independent implementation rather than against the host's btoa.
const referenceEncoder = `
  function btoaLookup(idx) {
    if (idx < 26) return String.fromCharCode(idx + "A".charCodeAt(0))
    if (idx < 52) return String.fromCharCode(idx - 26 + "a".charCodeAt(0))
    if (idx < 62) return String.fromCharCode(idx - 52 + "0".charCodeAt(0))
    if (idx == 62) return "+"
    if (idx == 63) return "/"
  }
  function mybtoa(s) {
    s = String(s)
    for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) return "INVALID_CHARACTER_ERR"
    var out = ""
    for (var i = 0; i < s.length; i += 3) {
      var groupsOfSix = [undefined, undefined, undefined, undefined]
      groupsOfSix[0] = s.charCodeAt(i) >> 2
      groupsOfSix[1] = (s.charCodeAt(i) & 0x03) << 4
      if (s.length > i + 1) {
        groupsOfSix[1] |= s.charCodeAt(i + 1) >> 4
        groupsOfSix[2] = (s.charCodeAt(i + 1) & 0x0f) << 2
      }
      if (s.length > i + 2) {
        groupsOfSix[2] |= s.charCodeAt(i + 2) >> 6
        groupsOfSix[3] = s.charCodeAt(i + 2) & 0x3f
      }
      for (var j = 0; j < groupsOfSix.length; j++) {
        out += typeof groupsOfSix[j] == "undefined" ? "=" : btoaLookup(groupsOfSix[j])
      }
    }
    return out
  }
  function testBtoa(input) {
    var expected = mybtoa(input)
    if (expected === "INVALID_CHARACTER_ERR") {
      try { btoa(input) } catch (error) { return error instanceof TypeError ? "ok" : error.name }
      return "did not throw"
    }
    if (btoa(input) !== expected) return "btoa mismatch"
    if (atob(btoa(input)) !== String(input)) return "roundtrip mismatch"
    return "ok"
  }
`

describe("btoa WPT parity (html/webappapis/atob/base64.any.js)", () => {
  test("every input encodes like the reference encoder and round-trips through atob", async () => {
    expect(
      await value(`
        ${referenceEncoder}
        var tests = ["עברית", "", "ab", "abc", "abcd", "abcde", "\\xff\\xff\\xc0", "\\0a", "a\\0b",
          undefined, null, 7, 12, 1.5, true, false, NaN, +Infinity, -Infinity, 0, -0]
        for (var i = 0; i < 258; i++) tests.push(String.fromCharCode(i))
        tests.push(String.fromCharCode(10000), String.fromCharCode(65534), String.fromCharCode(65535))
        tests.push(String.fromCharCode(0xd800, 0xdc00))
        var everything = ""
        for (var i = 0; i < 256; i++) everything += String.fromCharCode(i)
        tests.push(everything)
        return tests.map(testBtoa).filter((outcome) => outcome !== "ok")
      `),
    ).toEqual([])
  })
})

describe("atob WPT parity (fetch/data-urls/resources/base64.json)", () => {
  const idlCases: Array<[unknown, Array<number> | null]> = [
    [undefined, null],
    [null, [158, 233, 101]],
    [7, null],
    [12, [215]],
    [1.5, null],
    [true, [182, 187]],
    [false, null],
    [NaN, [53, 163]],
    [Infinity, [34, 119, 226, 158, 43, 114]],
    [-Infinity, null],
    [0, null],
    [-0, null],
  ]

  test(`${base64Cases.length} forgiving-base64 inputs decode to the expected bytes or throw a TypeError`, async () => {
    expect(
      await value(`
        const cases = ${JSON.stringify(base64Cases)}
        return cases.flatMap(([input, output]) => {
          try {
            const result = atob(input)
            if (output === null) return [[input, "expected throw"]]
            const bytes = Array.from({ length: result.length }, (_, i) => result.charCodeAt(i))
            return JSON.stringify(bytes) === JSON.stringify(output) ? [] : [[input, bytes]]
          } catch (error) {
            return output === null && error instanceof TypeError ? [] : [[input, error.name]]
          }
        })
      `),
    ).toEqual([])
  })

  test("WebIDL argument conversion stringifies non-string inputs", async () => {
    const literal = (input: unknown) =>
      Object.is(input, -0)
        ? "-0"
        : typeof input === "number" || input === undefined
          ? String(input)
          : JSON.stringify(input)
    expect(
      await value(`
        const cases = [${idlCases.map(([input, output]) => `[${literal(input)}, ${JSON.stringify(output)}]`).join(",")}]
        return cases.flatMap(([input, output]) => {
          try {
            const result = atob(input)
            if (output === null) return [[String(input), "expected throw"]]
            // The source loop checks only the listed prefix of the decoded bytes.
            const bytes = output.map((_, i) => result.charCodeAt(i))
            return JSON.stringify(bytes) === JSON.stringify(output) ? [] : [[String(input), bytes]]
          } catch (error) {
            return output === null && error instanceof TypeError ? [] : [[String(input), error.name]]
          }
        })
      `),
    ).toEqual([])
  })
})

describe("crypto.randomUUID WPT parity (WebCryptoAPI/randomUUID.https.any.js)", () => {
  test("namespace format, version, and variant bits over 256 iterations without collision", async () => {
    expect(
      await value(`
        const uuids = new Set()
        const randomUUID = () => {
          const uuid = crypto.randomUUID()
          if (uuids.has(uuid)) throw new Error("uuid collision " + uuid)
          uuids.add(uuid)
          return uuid
        }
        const UUIDRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
        let format = true, version = true, variant = true
        for (let i = 0; i < 256; i++) format = format && UUIDRegex.test(randomUUID())
        for (let i = 0; i < 256; i++) version = version && (parseInt(randomUUID().split("-")[2].slice(0, 2), 16) & 0b11110000) === 0b01000000
        for (let i = 0; i < 256; i++) variant = variant && (parseInt(randomUUID().split("-")[3].slice(0, 2), 16) & 0b11000000) === 0b10000000
        return [format, version, variant, uuids.size]
      `),
    ).toEqual([true, true, true, 768])
  })
})

// Enough of testharness.js to run the Headers files close to verbatim; each `test` records its failure, if any.
const testharness = `
  const failures = []
  function test(run, name) { try { run() } catch (error) { failures.push(name + ": " + (error && error.message ? error.message : error)) } }
  function assert_equals(actual, expected, message) { if (actual !== expected) throw new Error((message || "") + " expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)) }
  function assert_true(actual, message) { assert_equals(actual, true, message) }
  function assert_false(actual, message) { assert_equals(actual, false, message) }
  function assert_array_equals(actual, expected, message) { assert_equals(JSON.stringify(actual), JSON.stringify(expected), message) }
  function assert_throws_js(type, run) { try { run() } catch (error) { if (error instanceof type) return; throw new Error("threw " + error.name) } throw new Error("did not throw") }
  function assert_unreached() { throw new Error("unreachable") }
`

describe("Headers WPT parity (fetch/api/headers)", () => {
  test("headers-basic.any.js", async () => {
    expect(
      await value(`
        ${testharness}
        test(function() { new Headers() }, "Create headers from no parameter")
        test(function() { new Headers(undefined) }, "Create headers from undefined parameter")
        test(function() { new Headers({}) }, "Create headers from empty object")
        var parameters = [null, 1]
        parameters.forEach(function(parameter) {
          test(function() { assert_throws_js(TypeError, function() { new Headers(parameter) }) }, "Create headers with " + parameter + " should throw")
        })
        var headerDict = {"name1": "value1", "name2": "value2", "name3": "value3", "name4": null, "name5": undefined, "name6": 1, "Content-Type": "value4"}
        var headerSeq = []
        for (var name in headerDict) headerSeq.push([name, headerDict[name]])
        test(function() {
          var headers = new Headers(headerSeq)
          for (name in headerDict) assert_equals(headers.get(name), String(headerDict[name]), "name: " + name + " has value: " + headerDict[name])
          assert_equals(headers.get("length"), null, "init should be treated as a sequence, not as a dictionary")
        }, "Create headers with sequence")
        test(function() {
          var headers = new Headers(headerDict)
          for (name in headerDict) assert_equals(headers.get(name), String(headerDict[name]), "name: " + name + " has value: " + headerDict[name])
        }, "Create headers with record")
        test(function() {
          var headers = new Headers(headerDict)
          var headers2 = new Headers(headers)
          for (name in headerDict) assert_equals(headers2.get(name), String(headerDict[name]), "name: " + name + " has value: " + headerDict[name])
        }, "Create headers with existing headers")
        test(function() {
          var headers = new Headers()
          for (name in headerDict) {
            headers.append(name, headerDict[name])
            assert_equals(headers.get(name), String(headerDict[name]), "name: " + name + " has value: " + headerDict[name])
          }
        }, "Check append method")
        test(function() {
          var headers = new Headers()
          for (name in headerDict) {
            headers.set(name, headerDict[name])
            assert_equals(headers.get(name), String(headerDict[name]), "name: " + name + " has value: " + headerDict[name])
          }
        }, "Check set method")
        test(function() {
          var headers = new Headers(headerDict)
          for (name in headerDict) assert_true(headers.has(name), "headers has name " + name)
          assert_false(headers.has("nameNotInHeaders"), "headers do not have header: nameNotInHeaders")
        }, "Check has method")
        test(function() {
          var headers = new Headers(headerDict)
          for (name in headerDict) {
            assert_true(headers.has(name), "headers have a header: " + name)
            headers.delete(name)
            assert_true(!headers.has(name), "headers do not have anymore a header: " + name)
          }
        }, "Check delete method")
        test(function() {
          var headers = new Headers(headerDict)
          for (name in headerDict) assert_equals(headers.get(name), String(headerDict[name]), "name: " + name + " has value: " + headerDict[name])
          assert_equals(headers.get("nameNotInHeaders"), null, "header: nameNotInHeaders has no value")
        }, "Check get method")
        var headerEntriesDict = {"name1": "value1", "Name2": "value2", "name": "value3", "content-Type": "value4", "Content-Typ": "value5", "Content-Types": "value6"}
        var sortedHeaderDict = {}
        var headerValues = []
        var sortedHeaderKeys = Object.keys(headerEntriesDict).map(function(value) {
          sortedHeaderDict[value.toLowerCase()] = headerEntriesDict[value]
          headerValues.push(headerEntriesDict[value])
          return value.toLowerCase()
        }).sort()
        test(function() {
          var headers = new Headers(headerEntriesDict)
          assert_array_equals(headers.keys(), sortedHeaderKeys)
          for (const key of headers.keys()) assert_true(sortedHeaderKeys.indexOf(key) != -1)
        }, "Check keys method")
        test(function() {
          var headers = new Headers(headerEntriesDict)
          assert_array_equals(headers.values(), sortedHeaderKeys.map((key) => sortedHeaderDict[key]))
          for (const value of headers.values()) assert_true(headerValues.indexOf(value) != -1)
        }, "Check values method")
        test(function() {
          var headers = new Headers(headerEntriesDict)
          assert_array_equals(headers.entries(), sortedHeaderKeys.map((key) => [key, sortedHeaderDict[key]]))
          for (const entry of headers.entries()) assert_equals(entry[1], sortedHeaderDict[entry[0]])
        }, "Check entries method")
        test(function() {
          var headers = new Headers(headerEntriesDict)
          assert_array_equals([...headers], sortedHeaderKeys.map((key) => [key, sortedHeaderDict[key]]))
        }, "Check Symbol.iterator method")
        test(function() {
          var headers = new Headers(headerEntriesDict)
          var index = 0
          headers.forEach(function(value, key, container) {
            assert_equals(headers, container)
            assert_equals(key, sortedHeaderKeys[index])
            assert_equals(value, sortedHeaderDict[sortedHeaderKeys[index]])
            index++
          })
          assert_equals(index, sortedHeaderKeys.length)
        }, "Check forEach method")
        test(() => {
          const headers = new Headers({"foo": "2", "baz": "1", "BAR": "0"})
          const actualKeys = []
          const actualValues = []
          for (const [header, value] of headers) {
            actualKeys.push(header)
            actualValues.push(value)
            headers.delete("foo")
          }
          assert_array_equals(actualKeys, ["bar", "baz"])
          assert_array_equals(actualValues, ["0", "1"])
        }, "Iteration skips elements removed while iterating")
        test(() => {
          const headers = new Headers({"foo": "2", "baz": "1", "BAR": "0", "quux": "3"})
          const actualKeys = []
          const actualValues = []
          for (const [header, value] of headers) {
            actualKeys.push(header)
            actualValues.push(value)
            if (header === "baz") headers.delete("bar")
          }
          assert_array_equals(actualKeys, ["bar", "baz", "quux"])
          assert_array_equals(actualValues, ["0", "1", "3"])
        }, "Removing elements already iterated over causes an element to be skipped during iteration")
        test(() => {
          const headers = new Headers({"foo": "2", "baz": "1", "BAR": "0", "quux": "3"})
          const actualKeys = []
          const actualValues = []
          for (const [header, value] of headers) {
            actualKeys.push(header)
            actualValues.push(value)
            if (header === "baz") headers.append("X-yZ", "4")
          }
          assert_array_equals(actualKeys, ["bar", "baz", "foo", "quux", "x-yz"])
          assert_array_equals(actualValues, ["0", "1", "2", "3", "4"])
        }, "Appending a value pair during iteration causes it to be reached during iteration")
        test(() => {
          const headers = new Headers({"foo": "2", "baz": "1", "BAR": "0", "quux": "3"})
          const actualKeys = []
          const actualValues = []
          for (const [header, value] of headers) {
            actualKeys.push(header)
            actualValues.push(value)
            if (header === "baz") headers.append("abc", "-1")
          }
          assert_array_equals(actualKeys, ["bar", "baz", "baz", "foo", "quux"])
          assert_array_equals(actualValues, ["0", "1", "1", "2", "3"])
        }, "Prepending a value pair before the current element position causes it to be skipped during iteration and adds the current element a second time")
        return failures
      `),
    ).toEqual([])
  })

  test("headers-errors.any.js", async () => {
    expect(
      await value(`
        ${testharness}
        test(function() { assert_throws_js(TypeError, function() { new Headers([["name"]]) }) }, "Create headers giving an array having one string as init argument")
        test(function() { assert_throws_js(TypeError, function() { new Headers([["invalid", "invalidValue1", "invalidValue2"]]) }) }, "Create headers giving an array having three strings as init argument")
        test(function() { assert_throws_js(TypeError, function() { new Headers([["invalid\u0100", "Value1"]]) }) }, "Create headers giving bad header name as init argument")
        test(function() { assert_throws_js(TypeError, function() { new Headers([["name", "invalidValue\u0100"]]) }) }, "Create headers giving bad header value as init argument")
        var badNames = ["invalid\u0100", {}]
        var badValues = ["invalid\u0100"]
        badNames.forEach(function(name) {
          test(function() { var headers = new Headers(); assert_throws_js(TypeError, function() { headers.get(name) }) }, "Check headers get with an invalid name " + name)
        })
        badNames.forEach(function(name) {
          test(function() { var headers = new Headers(); assert_throws_js(TypeError, function() { headers.delete(name) }) }, "Check headers delete with an invalid name " + name)
        })
        badNames.forEach(function(name) {
          test(function() { var headers = new Headers(); assert_throws_js(TypeError, function() { headers.has(name) }) }, "Check headers has with an invalid name " + name)
        })
        badNames.forEach(function(name) {
          test(function() { var headers = new Headers(); assert_throws_js(TypeError, function() { headers.set(name, "Value1") }) }, "Check headers set with an invalid name " + name)
        })
        badValues.forEach(function(value) {
          test(function() { var headers = new Headers(); assert_throws_js(TypeError, function() { headers.set("name", value) }) }, "Check headers set with an invalid value " + value)
        })
        badNames.forEach(function(name) {
          test(function() { var headers = new Headers(); assert_throws_js(TypeError, function() { headers.append("invalid\u0100", "Value1") }) }, "Check headers append with an invalid name " + name)
        })
        badValues.forEach(function(value) {
          test(function() { var headers = new Headers(); assert_throws_js(TypeError, function() { headers.append("name", value) }) }, "Check headers append with an invalid value " + value)
        })
        test(function() {
          var headers = new Headers([["name", "value"]])
          assert_throws_js(TypeError, function() { headers.forEach() })
          assert_throws_js(TypeError, function() { headers.forEach(undefined) })
          assert_throws_js(TypeError, function() { headers.forEach(1) })
        }, "Headers forEach throws if argument is not callable")
        test(function() {
          var headers = new Headers([["name1", "value1"], ["name2", "value2"], ["name3", "value3"]])
          var counter = 0
          try {
            headers.forEach(function(value, name) {
              counter++
              if (name == "name2") throw "error"
            })
          } catch (e) {
            assert_equals(counter, 2)
            assert_equals(e, "error")
            return
          }
          assert_unreached()
        }, "Headers forEach loop should stop if callback is throwing exception")
        return failures
      `),
    ).toEqual([])
  })
})
