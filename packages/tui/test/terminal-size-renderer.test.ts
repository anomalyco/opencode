import { expect, mock, spyOn, test } from "bun:test"
import { createTestRenderer, ManualClock } from "@opentui/core/testing"
import { RendererControlState } from "@opentui/core"
import { guardTerminalResize } from "../src/terminal-size"
import { exclusiveTerminal } from "../src/terminal-queue"

// Bun reports an inverted console viewport as 2^64 - 29, printed as 2^64.
const INVERTED_WIDTH = 18446744073709552000

// Inverted until repair() runs. `fixed` decides whether repair() makes it valid.
function fakeViewport(fixed: boolean) {
  let repaired = false
  return {
    repairs: 0,
    valid: () => repaired,
    size: () => ({ width: 120, height: 30 }),
    repair() {
      this.repairs++
      if (fixed) repaired = true
    },
  }
}

// Lets the restart's awaited suspend() and resume() calls run.
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

test("terminal re-inits run one at a time", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 })
  try {
    const order: string[] = []
    let release = () => {}
    const gate = new Promise<void>((done) => {
      release = () => done()
    })
    const first = exclusiveTerminal(setup.renderer, async () => {
      order.push("first starts")
      await gate
      order.push("first ends")
    })
    const second = exclusiveTerminal(setup.renderer, async () => {
      order.push("second")
    })
    await settle()
    expect(order).toEqual(["first starts"])

    release()
    await Promise.all([first, second])
    expect(order).toEqual(["first starts", "first ends", "second"])
  } finally {
    setup.renderer.destroy()
  }
})

test("a bogus resize reading never reaches the native renderer", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock })
  setup.renderer.pause()
  const errors = spyOn(console, "error")
  const restore = guardTerminalResize(setup.renderer, undefined, () => {})
  try {
    setup.renderer.requestResize(INVERTED_WIDTH, 30)
    clock.advance(500)
    await setup.renderOnce()

    expect(errors).not.toHaveBeenCalled()
    expect(setup.renderer.width).toBe(120)
  } finally {
    restore()
    errors.mockRestore()
    setup.renderer.destroy()
  }
})

test("a viewport the repair cannot fix restarts the renderer once on the alternate screen", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock, screenMode: "alternate-screen" })
  setup.renderer.pause()
  const suspend = spyOn(setup.renderer, "suspend").mockResolvedValue(undefined)
  const resume = spyOn(setup.renderer, "resume").mockResolvedValue(undefined)
  const viewport = fakeViewport(false)
  const restore = guardTerminalResize(setup.renderer, viewport, () => {})
  try {
    // Each tick runs after the previous restart has finished, so a repeat would show.
    for (let tick = 0; tick < 3; tick++) {
      clock.advance(500)
      await settle()
    }

    expect(viewport.repairs).toBe(3)
    expect(suspend).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledTimes(1)
  } finally {
    restore()
    suspend.mockRestore()
    resume.mockRestore()
    setup.renderer.destroy()
  }
})

test("a viewport that recovers at the current size restarts the renderer once", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock })
  setup.renderer.pause()
  const suspend = spyOn(setup.renderer, "suspend").mockResolvedValue(undefined)
  const resume = spyOn(setup.renderer, "resume").mockResolvedValue(undefined)
  const viewport = fakeViewport(true)
  const restore = guardTerminalResize(setup.renderer, viewport, () => {})
  try {
    clock.advance(500)
    expect(viewport.repairs).toBe(1)
    expect(suspend).not.toHaveBeenCalled()

    clock.advance(500)
    await settle()
    expect(suspend).toHaveBeenCalledTimes(1)
  } finally {
    restore()
    suspend.mockRestore()
    resume.mockRestore()
    setup.renderer.destroy()
  }
})

test("a failed resume is retried once", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock, screenMode: "alternate-screen" })
  setup.renderer.pause()
  const suspend = spyOn(setup.renderer, "suspend").mockResolvedValue(undefined)
  const resume = spyOn(setup.renderer, "resume")
    .mockRejectedValueOnce(new Error("resume failed"))
    .mockResolvedValue(undefined)
  const report = mock(() => {})
  const restore = guardTerminalResize(setup.renderer, fakeViewport(false), report)
  try {
    clock.advance(500)
    await settle()

    expect(resume).toHaveBeenCalledTimes(2)
    expect(report).not.toHaveBeenCalled()
  } finally {
    restore()
    suspend.mockRestore()
    resume.mockRestore()
    setup.renderer.destroy()
  }
})

test("a resume that fails twice is reported, not thrown", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock, screenMode: "alternate-screen" })
  setup.renderer.pause()
  const suspend = spyOn(setup.renderer, "suspend").mockResolvedValue(undefined)
  const failure = new Error("resume failed")
  const resume = spyOn(setup.renderer, "resume").mockRejectedValue(failure)
  const report = mock(() => {})
  const restore = guardTerminalResize(setup.renderer, fakeViewport(false), report)
  try {
    clock.advance(500)
    await settle()

    expect(resume).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledWith("Failed to restart the renderer after a console viewport repair", failure)
  } finally {
    restore()
    suspend.mockRestore()
    resume.mockRestore()
    setup.renderer.destroy()
  }
})

test("a restart is skipped while the renderer is suspended for the external editor", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock, screenMode: "alternate-screen" })
  setup.renderer.pause()
  const suspend = spyOn(setup.renderer, "suspend").mockResolvedValue(undefined)
  Object.defineProperty(setup.renderer, "controlState", {
    get: () => RendererControlState.EXPLICIT_SUSPENDED,
    configurable: true,
  })
  const restore = guardTerminalResize(setup.renderer, fakeViewport(false), () => {})
  try {
    clock.advance(500)
    await settle()

    expect(suspend).not.toHaveBeenCalled()
  } finally {
    restore()
    delete (setup.renderer as { controlState?: unknown }).controlState
    suspend.mockRestore()
    setup.renderer.destroy()
  }
})

test("a restart queued behind the editor does nothing once the guard is removed", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock, screenMode: "alternate-screen" })
  setup.renderer.pause()
  const suspend = spyOn(setup.renderer, "suspend").mockResolvedValue(undefined)
  const resume = spyOn(setup.renderer, "resume").mockResolvedValue(undefined)
  let release = () => {}
  const gate = new Promise<void>((done) => {
    release = () => done()
  })
  // Holds the terminal queue the way an external editor's suspend does.
  const busy = exclusiveTerminal(setup.renderer, () => gate)
  const restore = guardTerminalResize(setup.renderer, fakeViewport(false), () => {})
  try {
    clock.advance(500)
    restore()
    release()
    await busy
    await settle()

    expect(suspend).not.toHaveBeenCalled()
  } finally {
    suspend.mockRestore()
    resume.mockRestore()
    setup.renderer.destroy()
  }
})
