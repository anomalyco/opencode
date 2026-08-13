import { mkdir, open, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { logSuccess } from "../log.js"

const template = `import { defineScript, Effect, Llm } from "opencode-drive"

export default defineScript({
  project: {
    files: {
      "src/example.ts": "export const value = 1\\n",
    },
  },
  run: ({ ui, llm }) =>
    Effect.gen(function* () {
      yield* llm.queue(Llm.text("The value is 1."))
      yield* ui.submit("Read src/example.ts")
      yield* ui.waitFor("The value is 1.")
      yield* ui.screenshot("result")
    }),
})
`

export async function initScript(path: string) {
  const file = resolve(path)
  await mkdir(dirname(file), { recursive: true })
  const handle = await open(file, "wx").catch((error: unknown) => {
    if (isAlreadyExists(error)) throw new Error(`script already exists: ${file}`, { cause: error })
    throw error
  })
  try {
    await handle.writeFile(template)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await rm(file, { force: true })
    throw error
  }
  await handle.close()
  logSuccess("created script")
  console.log(file)
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST"
}
