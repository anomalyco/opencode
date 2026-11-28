import { expect, test } from "bun:test"
import { CtrlBackspace } from "../../src/util/ctrl-backspace"

test("^H is Ctrl+Backspace unless the terminal's erase character is ^H", () => {
  expect(CtrlBackspace.fromControlH({ environment: {}, platform: "linux", erase: () => "^?" })).toBe(true)
  expect(CtrlBackspace.fromControlH({ environment: {}, platform: "darwin", erase: () => "^?" })).toBe(true)
  expect(CtrlBackspace.fromControlH({ environment: {}, platform: "linux", erase: () => undefined })).toBe(true)
  expect(CtrlBackspace.fromControlH({ environment: {}, platform: "linux", erase: () => "^H" })).toBe(false)
})

test("^H is Ctrl+Backspace on Windows only in Windows Terminal", () => {
  const erase = () => {
    throw new Error("Windows has no termios")
  }
  expect(CtrlBackspace.fromControlH({ environment: { WT_SESSION: "1" }, platform: "win32", erase })).toBe(true)
  expect(CtrlBackspace.fromControlH({ environment: {}, platform: "win32", erase })).toBe(false)
})

test("^H stays Backspace inside herdr", () => {
  expect(CtrlBackspace.fromControlH({ environment: { HERDR_ENV: "1" }, platform: "linux", erase: () => "^?" })).toBe(
    false,
  )
  expect(
    CtrlBackspace.fromControlH({ environment: { HERDR_ENV: "1", WT_SESSION: "1" }, platform: "win32" }),
  ).toBe(false)
})

test("reads the erase character from Linux and macOS stty output", () => {
  const linux = "speed 38400 baud; rows 40; columns 161; line = 0;\nintr = ^C; quit = ^\\; erase = ^?; kill = ^U; eof = ^D;"
  const macos = "cchars: discard = ^O; dsusp = ^Y; eof = ^D; eol = <undef>;\n\terase = ^H; intr = ^C; kill = ^U; werase = ^W;"
  expect(CtrlBackspace.parseErase(linux)).toBe("^?")
  expect(CtrlBackspace.parseErase(macos)).toBe("^H")
  expect(CtrlBackspace.parseErase("werase = ^W;")).toBeUndefined()
  expect(CtrlBackspace.parseErase("")).toBeUndefined()
})
