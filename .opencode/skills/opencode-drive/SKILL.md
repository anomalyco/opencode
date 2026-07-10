---
name: opencode-drive
description: Use when an agent needs drive OpenCode via a script or interact with an isolated instance
---

# OpenCode Drive

Use `opencode-drive` to launch an isolated OpenCode instance and control it via commands or a script.

There are two modes. Always default to using a script unless specifically directed to be interactive (connect
to an existing running instance, or start a new one, and make a few changes to the UI and read it, and iterate
on changes).

Scripts allow you to run a full walkthrough in one run. When the script is done opencode-drive exits,
stops all processes, and cleans up all artifacts.

# Prepare The Environment

Use `init` when files must be added to the isolated home or project before OpenCode starts. It prints the artifact directory without launching OpenCode. A later `start` with the same name reuses it.

```bash
artifacts=$(opencode-drive init --name demo)
cp -R ./fixtures/home/. "$artifacts/"
cp -R ./fixtures/project/. "$artifacts/files/"
opencode-drive start --name demo --dev ~/projects/opencode
```

The simulated project is under `$artifacts/files`. Running `start` without a prior `init` initializes the artifacts automatically.

# Scripted usage

You can write scripts that walk through entire flows, and gives you full access to controlling
the backend too. See examples of the script API at the bottom of this file.

After creating or editing a script, always typecheck it before running. Never skip this step:

```bash
opencode-drive check ./reproduce-stale-exploring-empty.ts
```

Run it by passing `--script` to start:

```bash
opencode-drive start --name auto-stop-reproduction --script ./reproduce-stale-exploring-empty.ts
```

It will output information about the run, including paths to log files which you can read
to inspect what happened. If you need to dig into failures that aren't clear, read those log
files. If the script is unsuccessful, automatically fix the script and run it again.

Scripts use one typed definition object. `setup` runs before OpenCode starts,
and `fs.writeFile` always writes inside the simulated project.

You can read the full typed API here: https://raw.githubusercontent.com/jlongster/opencode-drive/refs/heads/main/src/script/types.ts

```ts
import { defineScript } from "opencode-drive"

export default defineScript({
  async setup({ fs, config }) {
    config.autoupdate = false
    await fs.writeFile("src/example.ts", "export const value = 1\n")
  },

  async run({ ui, llm }) {
    await ui.submit("Open src/example.ts")
    await llm.send(llm.text("The file exports `value`."))
    await ui.waitFor("The file exports `value`.")
  },
})
```

`setup` receives the current OpenCode config object, which starts from the
default drive config unless the prepared instance already has one. When a script
needs custom config, mutate this `config` parameter instead of generating and
writing a new config object from scratch, so the script keeps the default
provider/model settings unless it intentionally changes them.

Note that the simulated model is a GPT model type, and opencode uses the `patch` tool for working with files Do not use a `edit` or `write` tool to edit files.

Use `launch: "manual"` when the script needs to launch the server and every TUI
itself (this is extremely rare, do not use this unless explicitly asked). In this
mode `ui` is typed as `null`; call `server.launch()` exactly
once before launching clients. Each `clients.launch(name)` result provides the
same UI methods as the automatic client. You can see an example of this API
here: https://raw.githubusercontent.com/jlongster/opencode-drive/refs/heads/main/examples/multiple-clients.ts

Use the exported `wait(milliseconds)` utility for an unconditional delay.

`await llm.send(...)` waits for the next request and resolves after OpenCode
acknowledges its complete response. `llm.queue(...)` declares responses in
advance. Chunks may be built with `text`, `reasoning`, `toolCall`, `raw`,
`finish`, and `disconnect`. A normal response receives `finish("stop")`
automatically unless it yields or queues an explicit terminal event.

`llm.text(text, { delay, chunkSize })` defaults to a 2 ms delay and a
15-character target varied by plus or minus 5 per chunk.

`llm.reasoning` accepts the same options, and `llm.pause(milliseconds)` adds a
delay between any two outputs.

Use `llm.serve` for an ongoing typed response generator:

```ts
llm.serve(async function* (request, index) {
  yield llm.reasoning(`Handling request ${index + 1}`)
  yield llm.text(`Received ${request.id}`)
  yield llm.finish("stop")
})
```

The backend connection, response cleanup, cancellation, and recording
completion are automatic.

You can see some example scripts here:

- https://raw.githubusercontent.com/jlongster/opencode-drive/refs/heads/main/examples/simple.ts
- https://raw.githubusercontent.com/jlongster/opencode-drive/refs/heads/main/examples/serve.ts

## Prune

- `prune` removes artifact directories. These are always cleaned up after running a script
  successfully, but leftover on failed runs. Always call this if a script fails.

```bash
opencode-drive prune --name demo

// --force cleans up all artifcat directories
opencode-dirve prune --force
```

# Live interaction usage

- Always give headless instances a unique `--name`. Visible instances may omit it.
- A normal headless `start` detaches automatically and returns after the instance is ready.
- Do not add `&`; the long-running owner already runs in the background.
- Configure simulated model responses after startup when needed.
- Send ordered UI commands with `send`.
- Always stop the instance when finished.

```bash
opencode-drive start --name demo

opencode-drive send --name demo \
  --command.ui.type '{"text":"Explain this project"}' \
  --command.ui.enter

opencode-drive stop --name demo
```

## Send UI Commands

- Every `send` opens a connection to the named instance, runs its commands in order, and exits.
- Combine typing and Enter in one command when submitting a prompt.
- JSON-valued commands require one JSON argument.
- Multiple command flags execute from left to right.

Commands:

- `--command.ui.type <json>` types into the focused editor. Arguments: `text` string.
- `--command.ui.press <json>` presses a key. Arguments: `key` string; optional `modifiers` object with boolean `ctrl`, `shift`, `meta`, `super`, or `hyper`.
- `--command.ui.enter` presses Enter. Arguments: none.
- `--command.ui.arrow <json>` presses an arrow key. Arguments: `direction` is `up`, `down`, `left`, or `right`.
- `--command.ui.focus <json>` focuses an element. Arguments: `target` is the numeric element `num` returned by `ui.state`.
- `--command.ui.click <json>` clicks an element. Arguments: numeric `target`, `x`, and `y`; use the element `num` returned by `ui.state` as `target`.
- `--command.ui.state` prints focus and interactive element metadata as JSON. Arguments: none.
- `--command.ui.matches <json>` prints whether literal, case-sensitive text appears on screen. Arguments: `text` string.

```bash
opencode-drive send --name demo \
  --command.ui.type '{"text":"Find the relevant code and explain it"}' \
  --command.ui.enter

opencode-drive send --name demo \
  --command.ui.press '{"key":"p","modifiers":{"ctrl":true}}'

opencode-drive send --name demo \
  --command.ui.arrow '{"direction":"down"}'

opencode-drive send --name demo \
  --command.ui.focus '{"target":12}'

opencode-drive send --name demo \
  --command.ui.click '{"target":12,"x":4,"y":1}'

opencode-drive send --name demo \
  --command.ui.matches '{"text":"OpenCode"}'
```

To read the UI state and see information about interactable elements, use the `ui.state` command:

```bash
opencode-drive send --name demo --command.ui.state
```

## Configure LLM Responses

- `responses` controls what the LLM responds with
- Only use this if you are wanting to reproduce an exact type of response
- Defaults are `text,reasoning,diff,tool` with `write,apply_patch`.
- Supported types are `text`, `reasoning`, `diff`, and `tool`.
- `--tools` limits generated tool calls to names offered by OpenCode.

```bash
opencode-drive responses --name demo \
  --types text,reasoning,diff,tool \
  --tools write,apply_patch

opencode-drive responses --name demo \
  --types tool \
  --tools read,glob,grep
```

## Inspect The UI

- `ui.state` prints focus and interactive element metadata as JSON.
- `ui.matches` checks for literal, case-sensitive screen text.
- `screenshot` prints the generated image path.

```bash
opencode-drive screenshot --name demo
```

## Lifecycle

- `stop` waits for recording export and owner cleanup before returning.

```bash
opencode-drive stop --name demo
```

# Record The UI

- Start with `--record` to capture a headless instance from its first rendered frame.
- `stop` finishes the recording, exports an MP4, and prints its path.

```bash
opencode-drive start --name demo --record

opencode-drive send --name demo \
  --command.ui.type '{"text":"Show me the current architecture"}' \
  --command.ui.enter

opencode-drive stop --name demo
```

# Artifacts dir

- `dir` prints the artifact directory for the instance.

```bash
opencode-drive dir --name demo
```

