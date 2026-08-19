import { expect, test } from "bun:test"
import { resolve } from "../../src/config"
import { bindings, parse } from "../../src/feature-plugins/session/side-question"

test("side question intercepts the default input submit binding", () => {
  const keys = resolve({}, { terminalSuspend: true }).keybinds

  expect(bindings(keys)).toMatchObject([{ key: "return", cmd: "side-question.submit" }])
})

test("side question intercepts custom prompt submit bindings", () => {
  const keys = resolve(
    { keybinds: { input_submit: "ctrl+s", prompt_submit: "return" } },
    { terminalSuspend: true },
  ).keybinds

  expect(bindings(keys)).toMatchObject([
    { key: "ctrl+s", cmd: "side-question.submit" },
    { key: "return", cmd: "side-question.submit" },
  ])
})

test("side question cannot fall through from the home page", () => {
  expect(parse("/btw what is the current time")).toEqual({ type: "missing" })
  expect(parse("ordinary prompt")).toEqual({ type: "pass" })
})

test("side question parses a question inside a session", () => {
  expect(parse("/btw what is the current time", "session-id")).toEqual({
    type: "ask",
    question: "what is the current time",
  })
  expect(parse("/btw ", "session-id")).toEqual({ type: "empty" })
})
