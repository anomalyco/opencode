import { afterEach, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { createComponent, render } from "solid-js/web"
import type { GeneratedProjectIcon, ProjectIconStore } from "@opencode/ui/project-avatar"

// Bun does not compile Solid JSX. Compile the real avatar with the same presets as Vite.
const require = createRequire(import.meta.url)

const solid = createRequire(require.resolve("vite-plugin-solid"))

const { transformSync } = solid("@babel/core")

// This file runs with --isolate. Replace the shared hyperscript preload so Solid owns refs and mount effects.
Bun.plugin.clearAll()

Bun.plugin({
  name: "project-avatar-solid",
  setup(build) {
    build.onLoad({ filter: /[\\/]project-avatar[\\/]project-avatar\.tsx$/ }, async (args) => ({
      contents: transformSync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [solid.resolve("babel-preset-solid"), solid.resolve("@babel/preset-typescript")],
      }).code,
      loader: "js",
    }))
  },
})

const { ProjectAvatar, ProjectIconStoreProvider, generateProjectIcon } = await import("@opencode/ui/project-avatar")

const { motionTuning } = await import("@opencode/ui/motion-tuning")

// Generated avatars are opt-in under Knobs → Experiments.
motionTuning.list().forEach((knob) => {
  if (knob.id === "projectAvatar.style") motionTuning.set(knob, "generated")
})

const getContext = HTMLCanvasElement.prototype.getContext

const requestFrame = window.requestAnimationFrame

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = getContext
  window.requestAnimationFrame = requestFrame
  document.body.replaceChildren()
})

function mount(store: ProjectIconStore, rows: string[]) {
  const root = document.createElement("div")
  document.body.append(root)

  const dispose = render(
    () =>
      createComponent(ProjectIconStoreProvider, {
        value: store,
        get children() {
          return rows.map((row) => {
            const button = document.createElement("button")
            button.dataset.row = row
            // SAFETY: ProjectAvatar renders a single root element.
            button.append(createComponent(ProjectAvatar, { fallback: "atlas", generated: "atlas-web" }) as Node)

            return button
          })
        },
      }),
    root,
  )

  const canvases = [...root.querySelectorAll<HTMLCanvasElement>('canvas[data-slot="project-avatar-generated"]')]

  return { root, canvases, dispose }
}

function memoryStore(initial: Record<string, GeneratedProjectIcon> = {}) {
  const icons = { ...initial }
  const remembered: string[] = []

  const store: ProjectIconStore = {
    get: (key) => icons[key],
    remember: (key, icon) => {
      remembered.push(key)
      icons[key] = icon
    },
  }

  return { store, icons, remembered }
}

test("stores a project's generated icon once and keeps drawing the stored one", () => {
  const empty = memoryStore()
  const first = mount(empty.store, ["a"])
  expect(empty.remembered).toEqual(["atlas-web"])
  expect(empty.icons["atlas-web"]).toEqual(generateProjectIcon("atlas-web"))
  first.dispose()

  // A stored icon is used as is, even when today's generator would produce something else.
  const stored = { ...generateProjectIcon("other-seed"), params: { ...generateProjectIcon("other-seed").params, scale: 2 } }
  const kept = memoryStore({ "atlas-web": stored })
  mount(kept.store, ["a"]).dispose()
  expect(kept.remembered).toEqual([])
  expect(kept.icons["atlas-web"]).toBe(stored)
})

// Two rows show the same project. Hovering one row must animate only that row's avatar.
test("animates only the hovered avatar when several rows show the same project", () => {
  const frames: FrameRequestCallback[] = []
  window.requestAnimationFrame = (callback) => frames.push(callback)
  const animated = new Set<HTMLCanvasElement>()
  // @ts-expect-error - records which canvas receives an animation frame; the happy-dom mock draws nothing
  HTMLCanvasElement.prototype.getContext = function () {
    const context = getContext.call(this, "2d")
    const canvas = this

    if (!context) return context

    return { ...context, putImageData: () => canvas.isConnected && animated.add(canvas) }
  }

  const { root, canvases, dispose } = mount(memoryStore().store, ["a", "b"])
  const [a, b] = canvases
  expect(frames).toHaveLength(0)
  animated.clear()

  root.querySelector('[data-row="a"]')?.dispatchEvent(new Event("pointerenter"))
  // Passing over does no drawing; the icon starts flowing once the pointer rests.
  frames.splice(0).forEach((callback) => callback(performance.now() + 16))
  expect(animated.size).toBe(0)
  frames.splice(0).forEach((callback) => callback(performance.now() + 400))
  frames.splice(0).forEach((callback) => callback(performance.now() + 416))

  expect(animated.has(a)).toBeTrue()
  expect(animated.has(b)).toBeFalse()
  expect(frames).toHaveLength(1)

  // Leaving eases the icon back to its static frame and stops the loop.
  root.querySelector('[data-row="a"]')?.dispatchEvent(new Event("pointerleave"))

  for (let step = 1; frames.length && step < 200; step++)
    frames.splice(0).forEach((callback) => callback(performance.now() + step * 100))
  expect(frames).toHaveLength(0)
  dispose()
})
