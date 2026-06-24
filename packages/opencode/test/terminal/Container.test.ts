import { test, expect } from "bun:test"
import { Container } from "@/terminal/app/Container"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"

function isTitlePos(x: number, w: number, title: string): boolean {
  const titleX = Math.floor((w - title.length) / 2)
  return x >= titleX && x < titleX + title.length
}

test("render fills entire screen with border", () => {
  const w = 20, h = 5
  const buffer = new ScreenBuffer(w, h)
  const c = new Container()
  c.setBounds(0, 0, w, h)
  c.render(buffer)

  expect(buffer.getCodePoint(0, 0)).toBe(0x250c)
  expect(buffer.getCodePoint(w - 1, 0)).toBe(0x2510)
  expect(buffer.getCodePoint(0, h - 1)).toBe(0x2514)
  expect(buffer.getCodePoint(w - 1, h - 1)).toBe(0x2518)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cp = buffer.getCodePoint(x, y)
      if (y === 0 || y === h - 1) {
        if (x === 0) expect(cp).toBe(y === 0 ? 0x250c : 0x2514)
        else if (x === w - 1) expect(cp).toBe(y === 0 ? 0x2510 : 0x2518)
        else if (isTitlePos(x, w, "Phase 2 Active")) continue
        else expect(cp).toBe(0x2500)
      } else {
        if (x === 0 || x === w - 1) expect(cp).toBe(0x2502)
        else expect(cp).toBe(0x20)
      }
    }
  }
})

test("render sets title in top border", () => {
  const buffer = new ScreenBuffer(30, 5)
  const c = new Container()
  c.setBounds(0, 0, 30, 5)
  c.render(buffer)

  const title = "Phase 2 Active"
  const titleX = Math.floor((30 - title.length) / 2)
  for (let i = 0; i < title.length; i++) {
    const cp = buffer.getCodePoint(titleX + i, 0)
    expect(String.fromCodePoint(cp)).toBe(title[i])
  }
})

test("render always starts dirty", () => {
  const c = new Container()
  expect(c.dirty).toBe(true)
})

test("invalidate sets dirty flag", () => {
  const c = new Container()
  c.setBounds(0, 0, 10, 3)
  const buf = new ScreenBuffer(10, 3)
  c.render(buf)
  expect(c.dirty).toBe(false)
  c.invalidate()
  expect(c.dirty).toBe(true)
})

test("buffer smaller than 2×2 renders nothing", () => {
  const c = new Container()
  c.setBounds(0, 0, 1, 1)
  const buf = new ScreenBuffer(1, 1)
  c.render(buf)
  expect(buf.getCodePoint(0, 0)).toBe(32)
})
