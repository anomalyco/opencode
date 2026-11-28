import { describe, expect, test } from "bun:test"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { tmpdir } from "node:os"
import type { BaseWindow, BrowserWindow, OpenDialogOptions, SaveDialogOptions } from "electron"
import { Effect, FileSystem, Layer, Path } from "effect"
import { createPickedFileAuthorizations } from "./attachment-picker"
import { createFilePickers, type PickerDialog } from "./pickers"

const platformLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

type DialogCall =
  | { readonly kind: "open"; readonly args: [BaseWindow, OpenDialogOptions] | [OpenDialogOptions] }
  | { readonly kind: "save"; readonly args: [BaseWindow, SaveDialogOptions] | [SaveDialogOptions] }

function createFakeWindow(destroyed = false) {
  let isDestroyed = destroyed

  // SAFETY: file pickers only check `isDestroyed()` and pass the BrowserWindow reference to Electron's dialog API.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const win = {
    isDestroyed: () => isDestroyed,
  } as unknown as BrowserWindow

  return {
    win,
    destroy: () => {
      isDestroyed = true
    },
  }
}

function createFakeDialog(calls: DialogCall[]): PickerDialog {
  const showOpenDialog = (...args: [BaseWindow, OpenDialogOptions] | [OpenDialogOptions]) => {
    calls.push({ kind: "open", args })

    return Promise.resolve({ canceled: true, filePaths: [] })
  }

  const showSaveDialog = (...args: [BaseWindow, SaveDialogOptions] | [SaveDialogOptions]) => {
    calls.push({ kind: "save", args })

    return Promise.resolve({ canceled: true, filePath: "" })
  }

  return {
    showOpenDialog,
    showSaveDialog,
  }
}

function runWithPickers<A>(
  run: (pickers: ReturnType<typeof createFilePickers>) => Effect.Effect<A, unknown>,
  options?: { readonly onExists?: () => void },
) {
  const calls: DialogCall[] = []

  const program = Effect.gen(function* () {
    const baseFs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const fs = options?.onExists
      ? {
          ...baseFs,
          exists: (target: string) =>
            Effect.sync(() => options.onExists?.()).pipe(Effect.andThen(baseFs.exists(target))),
        }
      : baseFs

    const pickedFiles = createPickedFileAuthorizations(() => Effect.succeed(new ArrayBuffer(0)))

    const pickers = createFilePickers({
      fs,
      path,
      pickedFiles,
      dialog: createFakeDialog(calls),
      home: tmpdir,
    })

    return yield* run(pickers)
  }).pipe(Effect.provide(platformLayer))

  return Effect.runPromise(program).then((result) => ({ result, calls }))
}

describe("native file pickers parent window", () => {
  const actions = [
    {
      name: "openDirectoryPicker",
      kind: "open" as const,
      invoke: (pickers: ReturnType<typeof createFilePickers>, parent: BrowserWindow | null) =>
        pickers.openDirectoryPicker(parent, { title: "Choose folder" }),
      expectedOptions: expect.objectContaining({
        title: "Choose folder",
        properties: ["openDirectory", "createDirectory"],
      }),
    },
    {
      name: "openFilePicker",
      kind: "open" as const,
      invoke: (pickers: ReturnType<typeof createFilePickers>, parent: BrowserWindow | null) =>
        pickers.openFilePicker(1, parent, { title: "Choose file", multiple: true }),
      expectedOptions: expect.objectContaining({
        title: "Choose file",
        properties: ["openFile", "multiSelections"],
      }),
    },
    {
      name: "saveFile",
      kind: "save" as const,
      invoke: (pickers: ReturnType<typeof createFilePickers>, parent: BrowserWindow | null) =>
        pickers.saveFile(parent, { title: "Save file" }, "hello"),
      expectedOptions: expect.objectContaining({
        title: "Save file",
      }),
    },
  ]

  test.each(actions)("$name attaches a live parent BrowserWindow as the first dialog argument", async (entry) => {
    const fake = createFakeWindow(false)
    const run = await runWithPickers((pickers) => entry.invoke(pickers, fake.win))

    expect(run.calls).toHaveLength(1)
    expect(run.calls[0].kind).toBe(entry.kind)
    expect(run.calls[0].args).toHaveLength(2)
    expect(run.calls[0].args[0]).toBe(fake.win)
    expect(run.calls[0].args[1]).toEqual(entry.expectedOptions)
  })

  test.each(actions)("$name falls back to a 1-arg dialog call when no parent window is resolved", async (entry) => {
    const run = await runWithPickers((pickers) => entry.invoke(pickers, null))

    expect(run.calls).toHaveLength(1)
    expect(run.calls[0].kind).toBe(entry.kind)
    expect(run.calls[0].args).toHaveLength(1)
    expect(run.calls[0].args[0]).toEqual(entry.expectedOptions)
  })

  test.each(actions)("$name falls back to a 1-arg dialog call when the parent window is destroyed", async (entry) => {
    const fake = createFakeWindow(true)
    const run = await runWithPickers((pickers) => entry.invoke(pickers, fake.win))

    expect(run.calls).toHaveLength(1)
    expect(run.calls[0].kind).toBe(entry.kind)
    expect(run.calls[0].args).toHaveLength(1)
    expect(run.calls[0].args[0]).toEqual(entry.expectedOptions)
  })

  test.each(actions)(
    "$name falls back to a 1-arg dialog call if the parent window is destroyed before the dialog opens",
    async (entry) => {
      const fake = createFakeWindow(false)
      const run = await runWithPickers((pickers) => entry.invoke(pickers, fake.win), { onExists: fake.destroy })

      expect(run.calls).toHaveLength(1)
      expect(run.calls[0].kind).toBe(entry.kind)
      expect(run.calls[0].args).toHaveLength(1)
      expect(run.calls[0].args[0]).toEqual(entry.expectedOptions)
    },
  )
})
