import { describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import jsQR from "jsqr"
import { encode, renderSVG, renderUnicodeCompact } from "../src/qr.js"
import fixtures from "./fixtures/qr.json" with { type: "json" }

// Fixtures were generated once with the uqr package, a port of Nayuki's reference encoder. Each row is hex with a
// leading 1 bit so leading light modules survive.
const golden = fixtures.map((fixture) => ({
  ...fixture,
  modules: fixture.rows.map((row) =>
    [
      ...BigInt("0x" + row)
        .toString(2)
        .slice(1),
    ].map((bit) => bit === "1"),
  ),
}))

describe("qr", () => {
  test.each(golden.map((fixture) => [fixture.version, fixture.text.slice(0, 40), fixture] as const))(
    "matches the reference encoder at version %i: %s",
    (version, _, fixture) => {
      const modules = encode(fixture.text)
      expect(modules.length).toBe(version * 4 + 17)
      expect(modules).toEqual(fixture.modules)
    },
  )

  // jsQR 1.4.0 places version 23's alignment patterns at 74 instead of 78, so it can't read that version.
  test.each(golden.filter((fixture) => fixture.version !== 23).map((fixture) => [fixture.version, fixture] as const))(
    "SVG and terminal output decode at version %i",
    (_, fixture) => {
      expect(decode(fromSVG(renderSVG(fixture.text, { border: 4 })))).toBe(fixture.text)
      expect(decode(fromUnicode(renderUnicodeCompact(fixture.text, { border: 1 })))).toBe(fixture.text)
    },
  )

  test("random pairing payloads decode", () => {
    Array.from({ length: 30 }, (_, i) => {
      const text = JSON.stringify({
        code: randomBytes(16).toString("base64url"),
        urls: Array.from({ length: 1 + (i % 5) }, (_, j) => `http://192.168.${i}.${j + 1}:4096`),
      })
      expect(decode(fromUnicode(renderUnicodeCompact(text, { border: (i % 3) + 1 })))).toBe(text)
    })
  })

  test("renders the SVG as uqr did", () => {
    const svg = renderSVG("hello", { border: 4, blackColor: "currentColor", whiteColor: "transparent" })
    expect(svg).toStartWith(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 290"><rect fill="transparent" width="290" height="290"/><path fill="currentColor" d="M40,40h10v10h-10zM50,40h10v10h-10z',
    )
    expect(fromSVG(svg)).toEqual(withBorder(golden[0].modules, 4))
  })

  test("renders terminal rows in pairs and shows the background below the last odd row", () => {
    const lines = renderUnicodeCompact("hello", { border: 2 }).split("\n")
    expect(lines).toHaveLength(13)
    expect(lines.every((line) => line.length === 25)).toBe(true)
    expect(lines[0]).toBe("\u2588".repeat(25))
    expect(lines.at(-1)).toBe("\u2580".repeat(25))
    expect(fromUnicode(lines.join("\n"))).toEqual(withBorder(golden[0].modules, 2))
  })

  test("rejects text longer than version 40 holds", () => {
    expect(encode("a".repeat(2953))).toHaveLength(177)
    expect(() => encode("a".repeat(2954))).toThrow(RangeError)
  })
})

function withBorder(modules: boolean[][], border: number) {
  const width = modules.length + border * 2
  const light = Array<boolean>(border).fill(false)
  const edge = Array.from({ length: border }, () => Array<boolean>(width).fill(false))
  return [...edge, ...modules.map((row) => [...light, ...row, ...light]), ...edge]
}

function fromSVG(svg: string) {
  const width = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1]) / 10
  const modules = Array.from({ length: width }, () => Array<boolean>(width).fill(false))
  for (const match of svg.matchAll(/M(\d+),(\d+)h10v10h-10z/g))
    modules[Number(match[2]) / 10][Number(match[1]) / 10] = true
  return modules
}

// Reverses the half-block encoding and drops the padding row under the last line.
function fromUnicode(text: string) {
  const lines = text.split("\n")
  const halves = { "\u2588": [false, false], "\u2580": [false, true], "\u2584": [true, false], " ": [true, true] }
  return lines
    .flatMap((line) => {
      const pairs = [...line].map((char) => halves[char as keyof typeof halves])
      return [pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1])]
    })
    .slice(0, lines[0].length)
}

// Draws the modules 4 pixels each with an extra quiet zone, then reads them back with jsQR.
function decode(modules: boolean[][]) {
  const scale = 4
  const padded = withBorder(modules, 4)
  const width = padded.length * scale
  const pixels = new Uint8ClampedArray(width * width * 4).map((_, i) => {
    if (i % 4 === 3) return 255
    const pixel = Math.floor(i / 4)
    return padded[Math.floor(pixel / width / scale)][Math.floor((pixel % width) / scale)] ? 0 : 255
  })
  // jsqr is CommonJS, so under NodeNext its function is the module's `default` property.
  const result = jsQR.default(pixels, width, width)
  if (!result) throw new Error("jsQR could not read the QR Code")
  return new TextDecoder().decode(new Uint8Array(result.binaryData))
}
