# Unattended work in opencode-skein

Two things run work without you sitting there: **`/loop`** repeats one prompt, and
**`/backlog`** works a backlog of openspec changes to completion.

> **Removed 2026-08-07.** This document previously described auto-reply, pattern
> detection, a webhook auto-reply hook system, and cron-style `/loop` scheduling
> (`/loop every 5 minutes`, `/loop-pause <task-id>`). None of it existed. The services were
> never registered in the layer graph and had no call site in the turn loop; the CLI
> commands built a fresh service instance per invocation, mutated it, printed a success
> message, and exited, so `pattern-detection --enable` configured nothing that outlived the
> process. The code is deleted (`retire-auto-reply`) and this file now describes only what
> is actually there.

## `/loop` — repeat one prompt until it is done

```bash
opencode loop "keep fixing the failing tests"
```

It re-sends the prompt each iteration and stops when the model emits
`<promise>COMPLETE</promise>`, which is disclosed to it every iteration, or when it runs
out of iterations, or when several consecutive iterations make no progress.

| flag | meaning |
| --- | --- |
| `-n, --max` | iterations before giving up (default 50) |
| `-i, --interval` | seconds between iterations (default 2) |
| `--completion-token` | the stop word (default `<promise>COMPLETE</promise>`) |
| `--no-progress-limit` | consecutive no-progress iterations before stopping (default 3, 0 disables) |

```bash
opencode loop list
opencode loop pause <id>
opencode loop resume <id>
opencode loop cancel <id>
```

In the TUI: `/loop <prompt>`, and `/loop` alone lists running loops.

## `/backlog` — work the openspec backlog to completion

> Named `/auto` until it collided with upstream's own "Auto mode" (permission
> auto-approve, documented at opencode.ai/docs/permissions and unrelated to
> this). `/queue` remains as an alias.

```bash
opencode loop --queue                    # every eligible change
opencode loop --queue my-change other    # these, in this order
```

The unit of work is an openspec change, not a prompt. Each change goes through
`implement → test → verify → commit`, then its branch is pushed.

**Done comes from disk, not from the model.** A change is complete when every checkbox in
its `tasks.md` is checked. The run ends when nothing under `openspec/changes/` is left
eligible — everything is complete or quarantined. A change that fails the same gate three
times is quarantined with a `.skein/blocker.md` and the queue moves on; the model can also
emit `<promise>BLOCKED</promise>` to quarantine a change it genuinely cannot do. `--max` is
per change, not per run.

| flag | meaning |
| --- | --- |
| `--gate-cwd` | where gate commands run (default: repo root) |
| `--test-command` | the test gate (default `bun test`) |
| `--verify-command` | the verify gate (default `bun run typecheck`) |
| `--guidance <text>` | standing instruction repeated every iteration; takes the rest of the line |
| `--no-push` | leave completed branches local |
| `--sync` | run specsync for each completed change (a dry run goes first) |

In the TUI: `/backlog` (or `/queue`). Note that `/backlog foo bar` reads `foo` and `bar` as
change **slugs** — use `--guidance` for prose.

### Authority

Every session in a queue run denies `git push`, tag, publish, release, deploy, and ssh, by
permission rule rather than by prompt instruction. The **driver** pushes the completed
branch — one ref it computed itself, after gates it evaluated itself, never the default
branch, never a merge or a tag. That distinction is the point: the model cannot push
whatever it constructs.

### Gate personas

`verify` is decided by a `reviewer` subagent returning `LGTM` or `NEEDS_WORK`, not by a
command exit code. Anything else — an error, a timeout, no recognisable verdict — fails the
gate, because this is the last step before commit. Configure with
`experimental.queue_personas` (`{"verify": false}` restores the plain command).

Gate subagents are denied `bash`, `write`, `edit`, and `patch` outright. A shell that can
run `git diff` can also run `git diff > f`, so a reviewer with a shell is a reviewer that
can rewrite what it is judging.

## Related

- `/btw <question>` — ask a side question without disturbing a running loop; answered from
  context, uses no tools, never joins the conversation.
- `peers` — a tool an agent can call to see which other sessions are working in this
  directory. Two agents in one checkout is a real failure mode here.
- `opencode hook` — hooks are configured in your opencode config file under `hooks`.

## Repo defaults

Set once per repo in `opencode.json` so you do not retype flags:

```jsonc
{
  "experimental": {
    "queue_gate": {
      "cwd": "packages/opencode",
      "test_command": "bun test",
      "verify_command": "bun run typecheck",
      "default_branch": "dev"
    }
  }
}
```
