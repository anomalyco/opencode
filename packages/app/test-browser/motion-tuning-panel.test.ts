import { afterEach, expect, it } from "bun:test"
import { motionTuning } from "@opencode/ui/motion-tuning"
import { mountMotionPanel } from "@opencode/ui/motion-tuning-panel"

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.replaceChildren()
})

it("offers Snappy, Smooth and Calm for the tab's springs, with one Global card and one card per section", async () => {
  const drawer = motionTuning.spring("test.drawer", {
    label: "Spring",
    group: "Drawer",
    presets: {
      snappy: { duration: 0.15, bounce: 0 },
      smooth: { duration: 0.25, bounce: 0 },
      calm: { duration: 0.4, bounce: 0 },
    },
  })

  const image = motionTuning.spring("test.image", {
    label: "Spring",
    group: "Image open",
    presets: {
      snappy: { duration: 0.2, bounce: 0 },
      smooth: { duration: 0.3, bounce: 0 },
      calm: { duration: 0.4, bounce: 0 },
    },
  })

  cleanups.push(motionTuning.action({ id: "test.replay", label: "Replay", group: "Drawer", run: () => {} }))

  const container = document.createElement("div")
  document.body.append(container)
  cleanups.push(mountMotionPanel(container, { section: "Drawer" }))

  const chip = await waitFor(() =>
    [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Smooth"),
  )

  const labels = [...container.querySelectorAll("button")].map((button) => button.textContent?.trim())

  expect(labels).toContain("Snappy")
  expect(labels).toContain("Calm")
  expect(labels).not.toContain("default")

  // Global once, then the section's spring with its replay buttons under a sub-heading in the same card.
  const shown = (selector: string) =>
    [...container.querySelectorAll(selector)].flatMap((element) =>
      element.closest("[hidden]") === null ? [element.textContent?.trim()] : [],
    )

  expect(shown(".knobs-group-label")).toEqual(["Global", "Drawer"])
  expect(shown(".knobs-subhead-label")).toEqual(["Replay"])
  expect(labels).not.toContain("Jump to…")
  expect(drawer()).toEqual({ duration: 0.15, bounce: 0 })

  chip.click()
  expect(drawer()).toEqual({ duration: 0.25, bounce: 0 })
  // A tab's presets move only its own springs.
  expect(image()).toEqual({ duration: 0.2, bounce: 0 })
})

it("describes each card under its title and outlines what a hovered row changes", async () => {
  const target = document.createElement("div")
  target.id = "outlined"
  target.getBoundingClientRect = () => new DOMRect(10, 20, 100, 40)
  document.body.append(target)

  motionTuning.number("test.outline", {
    group: "Outline",
    label: "Size",
    value: 1,
    min: 0,
    max: 2,
    step: 0.1,
    description: "Sets the size.",
    target: "#outlined",
  })

  const other = document.createElement("div")
  other.id = "other"
  other.getBoundingClientRect = () => new DOMRect(300, 20, 50, 50)
  document.body.append(other)
  motionTuning.number("test.other", {
    group: "Other",
    label: "Size",
    value: 1,
    min: 0,
    max: 2,
    step: 0.1,
    target: "#other",
  })

  const container = document.createElement("div")
  document.body.append(container)
  cleanups.push(mountMotionPanel(container))

  const row = await waitFor(() => container.querySelector<HTMLElement>('[data-field="test.outline"]') ?? undefined)

  expect(container.textContent).toContain("Sets the size.")
  expect(row.title).toBe("")

  const frames = () =>
    [...document.body.children].flatMap((element) =>
      element instanceof HTMLDivElement && element.style.position === "fixed" ? [element] : [],
    )

  row.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }))
  row.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementX: 1 }))
  // knobs reports what's active once a frame.
  await waitFor(() => (frames().length > 0 ? true : undefined))
  expect(frames().map((frame) => frame.style.left)).toEqual(["7px"])

  row.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }))
  await waitFor(() => (frames().length === 0 ? true : undefined))
})

it("closes only from its own close button or Esc inside it, never from the app around it", async () => {
  let closed = 0
  const outside = document.createElement("button")
  const container = document.createElement("div")
  document.body.append(outside, container)
  cleanups.push(mountMotionPanel(container, { onClose: () => closed++ }))

  const close = await waitFor(() => container.querySelector<HTMLButtonElement>(".knobs-close") ?? undefined)

  outside.focus()
  outside.click()
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", metaKey: true, bubbles: true }))
  expect(closed).toBe(0)

  const random = await waitFor(
    () => container.querySelector<HTMLButtonElement>('button[aria-label="Random"]') ?? undefined,
  )

  random.focus()
  random.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  expect(closed).toBe(1)

  close.click()
  expect(closed).toBe(2)
})

it("jumps with s from inside the panel, and leaves s and the backtick outside it alone", async () => {
  const outside = document.createElement("button")
  const container = document.createElement("div")
  document.body.append(outside, container)
  let closed = 0
  cleanups.push(mountMotionPanel(container, { onClose: () => closed++ }))

  const panel = await waitFor(() => container.querySelector<HTMLElement>(".knobs-panel") ?? undefined)

  const press = (target: Element, key: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))

  outside.focus()
  press(outside, "s")
  press(outside, "`")
  expect(panel.classList.contains("knobs-hinting")).toBe(false)
  expect(panel.closest("[hidden],[data-leaving]")).toBeNull()

  const random = await waitFor(() => panel.querySelector<HTMLButtonElement>('button[aria-label="Random"]') ?? undefined)
  random.focus()
  press(random, "s")
  expect(panel.classList.contains("knobs-hinting")).toBe(true)
  const codes = [...panel.querySelectorAll(".knobs-hint")].map((el) => el.textContent ?? "")
  expect(codes.length).toBeGreaterThan(0)

  // Esc leaves hint mode, not the panel.
  press(random, "Escape")
  expect(panel.classList.contains("knobs-hinting")).toBe(false)
  expect(closed).toBe(0)

  const code = codes.find((item) => item.length === 2) ?? codes[0]!
  press(random, "s")
  ;[...code].forEach((key) => press(document.activeElement ?? random, key))
  expect(panel.classList.contains("knobs-hinting")).toBe(false)
  expect(document.activeElement).not.toBe(random)
  expect(panel.contains(document.activeElement)).toBe(true)
})

async function waitFor<T>(find: () => T | undefined) {
  for (let i = 0; i < 200; i++) {
    const found = find()

    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error("timed out")
}
