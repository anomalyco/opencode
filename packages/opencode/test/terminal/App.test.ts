import { test, expect, afterEach } from "bun:test"
import { App } from "@/terminal/app/App"
import { TerminalManager } from "@/terminal/window/TerminalManager"
import { Container } from "@/terminal/app/Container"

const terminal = new TerminalManager()
let app: App | null = null

afterEach(() => {
  app?.stop()
  app = null
})

test("mount throws when already started", () => {
  const a = new App(terminal)
  const c = new Container()
  a.mount(c)
  a.start()
  expect(() => a.mount(c)).toThrow("[App] Cannot mount while running")
  a.stop()
})

test("double start is no-op", () => {
  app = new App(terminal)
  app.start()
  app.start()
})

test("double stop is no-op", () => {
  app = new App(terminal)
  app.start()
  app.stop()
  app.stop()
})

test("stop without start is no-op", () => {
  app = new App(terminal)
  app.stop()
})
