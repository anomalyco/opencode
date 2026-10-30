import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createLinkCheck } from "../src/runtime/plugin/link-check"

function setup(answer: (href: string) => boolean | Promise<boolean>) {
  return createRoot((dispose) => {
    const [active, setActive] = createSignal(true)
    const asked: string[] = []

    const exists = createLinkCheck(active, (href) => {
      asked.push(href)

      return answer(href)
    })

    return { exists, asked, setActive, dispose }
  })
}

test("passes through a check asked while the timeline is selected", async () => {
  const input = setup((href) => (href === "sync.ts" ? true : Promise.resolve(href === "async.ts")))

  try {
    expect(input.exists("sync.ts")).toBe(true)
    expect(await input.exists("async.ts")).toBe(true)
    expect(await input.exists("missing.ts")).toBe(false)
    expect(input.asked).toEqual(["sync.ts", "async.ts", "missing.ts"])
  } finally {
    input.dispose()
  }
})

test("defers a check asked while the timeline is hidden until it is selected", async () => {
  const input = setup(() => true)

  try {
    input.setActive(false)
    const pending = input.exists("src/app.ts")
    await Promise.resolve()
    expect(input.asked).toEqual([])
    input.setActive(true)
    expect(await pending).toBe(true)
    expect(input.asked).toEqual(["src/app.ts"])
  } finally {
    input.dispose()
  }
})

test("asks again when a check comes back negative after the timeline was hidden", async () => {
  const answers = [Promise.withResolvers<boolean>(), Promise.withResolvers<boolean>()]
  const input = setup(() => answers[input.asked.length - 1]!.promise)

  try {
    const pending = input.exists("src/app.ts")
    input.setActive(false)
    answers[0]!.resolve(false)
    await Bun.sleep(0)
    expect(input.asked).toHaveLength(1)
    input.setActive(true)
    await Bun.sleep(0)
    expect(input.asked).toHaveLength(2)
    answers[1]!.resolve(true)
    expect(await pending).toBe(true)
  } finally {
    input.dispose()
  }
})

test("asks again when a check comes back negative after the timeline was hidden and shown again", async () => {
  const answers = [Promise.withResolvers<boolean>(), Promise.withResolvers<boolean>()]
  const input = setup(() => answers[input.asked.length - 1]!.promise)

  try {
    const pending = input.exists("src/app.ts")
    input.setActive(false)
    input.setActive(true)
    answers[0]!.resolve(false)
    await Bun.sleep(0)
    expect(input.asked).toHaveLength(2)
    answers[1]!.resolve(true)
    expect(await pending).toBe(true)
  } finally {
    input.dispose()
  }
})
