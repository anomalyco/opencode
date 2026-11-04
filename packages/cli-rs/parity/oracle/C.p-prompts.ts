// C.p oracle: runs one named prompt script with the `@clack/prompts` that `packages/cli` uses.
// `crates/cli/src/prompt/demo.rs` (the `opencode-prompt-demo` binary) runs the same scripts with the
// Rust prompt kit, so P-PTY and P-CLI can compare the two screen for screen.
//
//   bun run parity/oracle/C.p-prompts.ts <case>

import path from "node:path"

const cli = path.resolve(import.meta.dir, "../../../cli")
const clack: typeof import("@clack/prompts") = await import(Bun.resolveSync("@clack/prompts", cli))

// Ends the script the way `packages/cli/src/ui/prompt.ts` `handlePromptErrors` does on a cancel.
function check<T>(value: T | symbol): T {
  if (!clack.isCancel(value)) return value
  clack.cancel("Cancelled")
  process.exit(130)
}

function show(value: unknown) {
  clack.log.step(`value: ${Array.isArray(value) ? value.join(",") : String(value)}`)
}

const providers = [
  { value: "anthropic", label: "Anthropic", hint: "recommended" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google", hint: "Gemini" },
  { value: "local" },
]
const many = Array.from({ length: 20 }, (_, index) => ({ value: `item-${index + 1}`, label: `Item ${index + 1}` }))

const cases: Record<string, () => Promise<void>> = {
  async text() {
    clack.intro("Text")
    show(check(await clack.text({ message: "Your name", placeholder: "Ada Lovelace" })))
    clack.outro("Done")
  },
  async "text-validate"() {
    show(
      check(
        await clack.text({
          message: "Port",
          initialValue: "80",
          defaultValue: "8080",
          validate: (value) => (!value ? undefined : /^\d+$/.test(value) ? undefined : "Expected a number"),
        }),
      ),
    )
    show(check(await clack.text({ message: "Required", validate: (value) => (value ? undefined : "Required") })))
  },
  async password() {
    show(check(await clack.password({ message: "API key", validate: (value) => (value ? undefined : "Required") })))
  },
  async confirm() {
    show(check(await clack.confirm({ message: "Continue?" })))
    show(check(await clack.confirm({ message: "Delete it?", initialValue: false, active: "Delete", inactive: "Keep" })))
  },
  async select() {
    show(check(await clack.select({ message: "Provider", options: providers, initialValue: "openai" })))
  },
  async "select-long"() {
    show(check(await clack.select({ message: "Pick one", options: many, maxItems: 7 })))
  },
  async multiselect() {
    show(check(await clack.multiselect({ message: "Providers", options: providers, initialValues: ["google"] })))
    show(check(await clack.multiselect({ message: "Optional", options: providers.slice(0, 2), required: false })))
  },
  async autocomplete() {
    show(check(await clack.autocomplete({ message: "Search", options: [...providers, ...many], maxItems: 6 })))
  },
  async spinner() {
    clack.intro("Spinner")
    const progress = clack.spinner()
    progress.start("Installing...")
    await Bun.sleep(300)
    progress.message("Linking")
    await Bun.sleep(300)
    progress.stop("Installed")
    const failing = clack.spinner()
    failing.start("Connecting")
    await Bun.sleep(200)
    failing.stop("Connection failed", 1)
    clack.outro("Done")
  },
  async "spinner-wait"() {
    const progress = clack.spinner()
    progress.start("Waiting")
    await Bun.sleep(20_000)
    progress.stop("Finished")
  },
  async messages() {
    clack.intro("Messages")
    clack.log.message("Plain message\nsecond line\n\nafter a blank")
    clack.log.info("Info")
    clack.log.success("Success")
    clack.log.step("Step")
    clack.log.warn("Warning")
    clack.log.error("Error")
    clack.note("First line of the note\nsecond", "A title")
    clack.note("Short", "A much longer title than the body")
    clack.outro("Bye")
    clack.cancel("Cancelled")
  },
}

const name = Bun.argv[2] ?? ""
const run = cases[name]
if (!run) {
  console.error(`unknown case: ${name}`)
  process.exit(2)
}
await run()
