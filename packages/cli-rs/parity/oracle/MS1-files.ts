// P-FILE for the shared state files of the MS1 review (carbon-7) and the MS3/MS4 review (carbon-3), driven by
// crates/local/tests/shared_files.rs. Run it from <ts-root>/packages/tui with OpenTUI's Solid preload, as
// E.2-history.ts runs. Each writing command prints `ready` and waits for one line on stdin, so the Rust
// side can start writing at the same moment, then writes the way the TypeScript TUI does, with its own
// `util/persistence` functions:
//
//   bun MS1-files.ts <ts-root> pins <state> <prefix> <count>     session.json: `togglePin` of <prefix>-<i>,
//                                                                the list read once and saved whole with
//                                                                writeJsonAtomic
//   bun MS1-files.ts <ts-root> history <state> <prefix> <count>  prompt-history.jsonl: `append` below the
//                                                                limit, one appendText per entry
//   bun MS1-files.ts <ts-root> frecency <state> <prefix> <count> frecency.jsonl: `updateFrecency` of a new
//                                                                path /w/<prefix>-<i>, one appendText each
//   bun MS1-files.ts <ts-root> stash <state> <prefix> <count>    prompt-stash.jsonl: `push` below the limit,
//                                                                one appendText per entry
//   bun MS1-files.ts <ts-root> read <state>                      what the TypeScript TUI reads of them all
//
// Prints one JSON value: `{pinned, history, frecency, stash}` as `readJson`, `parsePromptHistory`,
// `parseFrecency` (paths and frequencies) and `parsePromptStash` (texts) read them.
import path from "node:path"

const [root, command, state, prefix, count] = process.argv.slice(2)
// `bun run parity/fixtures.ts` runs every oracle without arguments; this one writes no fixture.
if (root && command && state) {
  const load = (spec: string) => import(Bun.resolveSync(spec, `${root}/packages/tui/src`))
  const { appendText, readJson, readText, writeJsonAtomic } = await load("./util/persistence")
  const { parsePromptHistory } = await load("./prompt/history")
  const { parseFrecency } = await load("./prompt/frecency")
  const { parsePromptStash } = await load("./prompt/stash")
  const pins = path.join(state, "session.json")
  const history = path.join(state, "prompt-history.jsonl")
  const frecency = path.join(state, "frecency.jsonl")
  const stash = path.join(state, "prompt-stash.jsonl")
  const read = async () => ({
    pinned: await readJson(pins)
      .then((value: { pinned: string[] }) => value.pinned)
      .catch(() => null),
    history: parsePromptHistory(await readText(history).catch(() => "")).map((entry: { text: string }) => entry.text),
    frecency: Object.fromEntries(
      parseFrecency(await readText(frecency).catch(() => "")).map((entry: { path: string; frequency: number }) => [
        entry.path,
        entry.frequency,
      ]),
    ),
    stash: parsePromptStash(await readText(stash).catch(() => "")).map(
      (entry: { prompt: { text: string } }) => entry.prompt.text,
    ),
  })
  if (command !== "read") {
    console.log("ready")
    for await (const _ of console) break
  }
  if (command === "pins") {
    const pinned = (await read()).pinned ?? []
    for (let i = 0; i < Number(count); i++) {
      pinned.push(`${prefix}-${i}`)
      await writeJsonAtomic(pins, { pinned })
      await Bun.sleep(1)
    }
  }
  if (command === "history") {
    for (let i = 0; i < Number(count); i++) {
      await appendText(history, JSON.stringify({ text: `${prefix}-${i}`, pasted: [] }) + "\n")
      await Bun.sleep(1)
    }
  }
  if (command === "frecency") {
    for (let i = 0; i < Number(count); i++) {
      const entry = { path: `/w/${prefix}-${i}`, frequency: 1, lastOpen: Date.now() }
      await appendText(frecency, JSON.stringify(entry) + "\n")
      await Bun.sleep(1)
    }
  }
  if (command === "stash") {
    for (let i = 0; i < Number(count); i++) {
      const prompt = { text: `${prefix}-${i}`, files: [], agents: [], skills: [], pasted: [] }
      await appendText(stash, JSON.stringify({ prompt, timestamp: Date.now() }) + "\n")
      await Bun.sleep(1)
    }
  }
  console.log(JSON.stringify(await read()))
}
