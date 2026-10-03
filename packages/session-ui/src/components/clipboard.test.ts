import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { writeClipboard } from "./clipboard"
import { setupCodeCopy } from "./markdown-code-copy"

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

let clipboardDescriptor: PropertyDescriptor | undefined
let execCommandDescriptor: PropertyDescriptor | undefined
let execCommandCalls: { command: string; selected: string | undefined }[]

function hideClipboard() {
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard")
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
}

function restoreClipboard() {
  const prior = clipboardDescriptor
  clipboardDescriptor = undefined
  if (prior) {
    Object.defineProperty(navigator, "clipboard", prior)
    return
  }
  delete (navigator as { clipboard?: unknown }).clipboard
}

function stubExecCommand(result: boolean) {
  execCommandCalls = []
  execCommandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand")
  document.execCommand = (command: string) => {
    execCommandCalls.push({ command, selected: document.querySelector("textarea")?.value })
    return result
  }
}

function restoreExecCommand() {
  const prior = execCommandDescriptor
  execCommandDescriptor = undefined
  if (prior) {
    Object.defineProperty(document, "execCommand", prior)
    return
  }
  delete (document as { execCommand?: unknown }).execCommand
}

afterEach(() => {
  restoreClipboard()
  restoreExecCommand()
  document.body.innerHTML = ""
})

test("copies via execCommand when navigator.clipboard is missing", async () => {
  hideClipboard()
  expect(navigator.clipboard).toBeUndefined()
  stubExecCommand(true)

  const copied = await writeClipboard("hello insecure origin")

  expect(copied).toBe(true)
  expect(execCommandCalls).toEqual([{ command: "copy", selected: "hello insecure origin" }])
})

test("code-block copy button works without navigator.clipboard", async () => {
  hideClipboard()
  expect(navigator.clipboard).toBeUndefined()
  stubExecCommand(true)

  const root = document.createElement("div")
  const wrapper = document.createElement("div")
  wrapper.setAttribute("data-component", "markdown-code")
  const pre = document.createElement("pre")
  const code = document.createElement("code")
  code.textContent = "const x = 1"
  pre.appendChild(code)
  const host = document.createElement("div")
  host.setAttribute("data-slot", "markdown-copy-button")
  const inner = document.createElement("button")
  inner.type = "button"
  host.appendChild(inner)
  wrapper.appendChild(pre)
  wrapper.appendChild(host)
  root.appendChild(wrapper)
  document.body.appendChild(root)

  const cleanup = setupCodeCopy(root, () => ({ copy: "Copy", copied: "Copied" }))
  inner.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 10))
  cleanup()

  expect(execCommandCalls).toEqual([{ command: "copy", selected: "const x = 1" }])
  expect(host.getAttribute("data-copied")).toBe("true")
})
