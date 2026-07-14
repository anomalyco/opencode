import { expect, test } from "bun:test"
import { resolve } from "../../src/config"
import { bindings } from "../../src/feature-plugins/session/side-question"

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
