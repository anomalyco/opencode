# Code Coach (slice 1: the post-send nudge)

An opt-in opencode plugin that watches a prompt **after** it is sent and stays
quiet unless the ask is worth one interruption. When it is, a card appears next
to the composer with something the developer can act on.

The plugin never delays, blocks, rewrites, or re-sends anything.

## The workflow

Ask for a login endpoint that compares a password against the database, and the
card says:

> **2 things before you accept this**
>
> 1. Passwords would be compared in plaintext. Nothing here says the password
>    is hashed, so the obvious implementation compares the stored value with
>    `==`. Passwords must be one-way: store `hash(password)` with a per-user
>    salt, and compare in constant time.
> 2. No rate limiting on the credential path. Nothing here limits attempts, so
>    one client can try thousands of passwords a minute against the same
>    account.
>
> **[Explain why] [Fix my prompt] [Ignore]**

- **Explain why** swaps the card in place for the first-principles version —
  what a hash is, why it is one-way, why two users with the same password force
  a salt — and offers **Back** to return to the findings.
- **Fix my prompt** puts a rewritten ask on the clipboard:

  > Add a login endpoint that checks the user's password against the database.
  > Use bcrypt or argon2id with a per-user salt, compare in constant time,
  > rate-limit to 5 attempts per minute per IP and per account, and return
  > generic errors that do not reveal whether an account exists.

- **Ignore** closes the card and touches nothing.

The next prompt is better and the developer knows why. That is the loop.

## What this slice does

| Prompt | Card |
| --- | --- |
| `Summarize the current state of the parser` | none |
| `fix the login flow so the second attempt works` | none — a bug fix is not a build ask |
| `delete the old logs after committing the current state first` | none — the ask has a recovery point |
| `delete src/app.ts` | none — one named target is specific |
| `delete all the logs from last week` | **Destructive ask without a recovery point** → Copy the guardrail / Dismiss |
| `Add a login endpoint that checks the user's password against the database` | **2 things before you accept this** → Explain why / Fix my prompt / Ignore |
| `hardcode the Stripe API key in the config` | **1 thing**: a secret would be committed |
| `build a SQL query from the user's input` | **1 thing**: SQL built from input |
| `run the user's command with child_process.exec` | **1 thing**: shell command built from input |
| `render user comments as raw HTML` | **1 thing**: user content rendered as HTML |
| `accept a file upload and save it to disk` | **1 thing**: input used without validation |

Two deterministic lanes, no model call and no network. The security lane is not
password-specific: it covers the patterns below, and every finding gets the same
three actions.

**Destructive.** A destructive verb (`delete`, `reset`, `drop`, `truncate`,
`overwrite`, `wipe`, `purge`, `destroy`, `remove`, `clear`) plus a destructive
object (`files`, `database`, `logs`, `history`, `cache`, `config`, `secrets`,
...), or a hard pattern (`rm -rf`, `git clean`, `force-push`, `drop table`),
**and no recovery point**. A recovery point is any of `backup`, `commit first`,
`commit before`, `commit the current`, `dry run`, `snapshot`, `confirm`, `only`,
`specific`, `this file`, `one file`. Naming a single file is also a specific
target; `delete all the .ts files` is not.

**Security.** Ordered by severity, capped at two findings per card:

| Finding | Fires when | Silence when the ask says |
| --- | --- | --- |
| Plaintext password | a credential ask compares or stores a password and never mentions hashing | `bcrypt`, `argon2`, `scrypt`, `hash`, `salt`, `constant time` |
| Missing rate limit | a credential ask has no limit on attempts | `rate limit`, `throttle`, `lockout`, `attempts per`, `captcha` |
| Secret in the repo | a key or token is put in code or config | `environment`, `secret manager`, `vault`, `never commit` |
| SQL built from input | a query takes user input by concatenation or interpolation | `parameterized`, `prepared statement`, `bind`, `ORM` |
| Shell command built from input | input reaches `exec`, `spawn`, `system`, or a shell | `args array`, `no shell`, `allowlist`, `validate` |
| User content as HTML | user content is rendered as markup | `escape`, `sanitize`, `DOMPurify`, `textContent` |
| Input without validation | input is read, stored, or uploaded with no check | `validate`, `schema`, `zod`, `allowlist` |

A credential ask is a credential word (`password`, `passphrase`, `credential`,
`login`, `sign in`) plus a build verb (`add`, `create`, `build`, `implement`,
`write`, `set up`, `wire`) plus an auth surface (`endpoint`, `route`, `form`,
`handler`, `service`, `flow`, `api`, ...) plus a credential-handling word
(`check`, `verify`, `compare`, `store`, `hash`, `reset`, `against the database`,
`==`). Without the last one, `make the login page look nicer` and `write unit
tests for the login form` stay silent.

One finding → `1 thing`, two → `2 things`. More than two are cut to the two most
severe, so the card stays a nudge. Destructive wins over security when an ask is
both.

## Why the hook does not wait

opencode core awaits the `prompt` hook inside `SessionPrompt.prepare`, **before
the message is admitted**. Anything slow in that hook is felt as a delay on
every send that matches. An earlier revision of this package polled for a
verdict (1.5 s) and then for a card decision (5 s) inside that hook, which
turned the coach into a pre-send gate and contradicted the design.

This revision does one small file write and returns:

```text
prompt hook  -> filter -> write req-<id>.json -> return the event untouched
daemon       -> read the request, delete it, decide, maybe show one card
```

There is no verdict file, no decision file, no polling, no timeout, and no
mutation of `event.prompt`. The card's buttons cannot change a send that has
already happened; they copy text or dismiss.

## What is not here yet

This is the first reviewable slice requested in
[#59587](https://github.com/anomalyco/opencode/pull/59587). Later slices add:

- the model-backed triage lane (a cheap model call per eligible send) and the
  learned severity that goes with it
- Snooze, the learner profile, lessons, insights, and persisted state
- the project layer (repo map, "you already have an auth middleware")
- autostart install/uninstall, `coach-guard`, and the doctor
- the VS Code/Cursor/Claude lanes — this slice is the opencode plugin only

Until then the daemon is started by hand and stopped with a `stop` file.

## Requirements

- Windows 10 or 11. The daemon is Windows PowerShell 5.1 + WPF; on macOS and
  Linux the plugin logs `skip: unsupported platform` and does nothing.
- opencode with the v2 plugin API (`session.hook("prompt")`).
- Node or Bun only for the plugin's tests.

## Run it from a checkout

This is the supported setup for slice 1, because the daemon is a separate
process and is not started by the plugin.

1. Clone and install:

   ```powershell
   git clone https://github.com/anomalyco/opencode.git
   cd opencode
   bun install
   ```

2. Add the plugin to your opencode config. In `%USERPROFILE%\.config\opencode\opencode.json`
   (or the project's `opencode.jsonc`):

   ```jsonc
   {
     "plugins": ["./packages/plugins/code-coach"]
   }
   ```

3. Start the daemon in its own PowerShell window:

   ```powershell
   powershell -NoProfile -STA -ExecutionPolicy Bypass -File packages\plugins\code-coach\src\Coach.Daemon.ps1
   ```

   `COACH_DATA_DIR` overrides the data folder (`%LOCALAPPDATA%\CodeCoachData`).
   The daemon writes `daemon.pid`, `logs\daemon.log`, and `trace.jsonl` there.

   **If you already run another Code Coach build, use a separate folder.** The
   full product uses the same default folder with a different request format,
   and its daemon will hold the pid file. Set `COACH_DATA_DIR` to something like
   `%LOCALAPPDATA%\CodeCoachData-pr` in the daemon's environment *and* in
   opencode's environment before starting either half.

4. Send one of the prompts from the table above. The plugin writes a request
   only when the send is substantive and the daemon is alive.

5. Stop the daemon:

   ```powershell
   New-Item -ItemType File (Join-Path $env:LOCALAPPDATA 'CodeCoachData\stop')
   ```

The daemon removes its pid file and the `stop` file on exit.

## Install the plugin from Git

The plugin half can be installed without a checkout:

```powershell
opencode plugin add 'git+https://github.com/anomalyco/opencode.git#path:packages/plugins/code-coach'
```

The daemon still has to run from a checkout in this slice. Autostart and a
one-command installer are a later slice.

## Privacy

- The plugin writes prompt text only when `daemon.pid` names a live process. If
  the coach is not running, nothing is written and the send is untouched.
- The daemon deletes the request as soon as it reads it. A request older than
  120 s is deleted without a card.
- The daemon logs the prompt **length** and the outcome, never the text. The
  live test asserts that none of the prompts it sends appear in `daemon.log` or
  `trace.jsonl`.
- There is no transcript, no key, and no network call in this slice.
- Every card string is a fixed template. The card never reads the session, the
  repo, or a model.

## Verify

```powershell
cd packages/plugins/code-coach
bun test                                       # 7 tests, no daemon, all platforms
bun run typecheck:tsc                          # clean
powershell -STA -File tests\Rules.ps1          # 65 rule checks, headless
powershell -STA -File tests\Run-Minimal.ps1    # 76 live checks, Windows desktop
```

`tests/Rules.ps1` asserts every branch of the rule engine with no daemon and no
desktop, so it runs anywhere PowerShell runs. `tests/Run-Minimal.ps1` starts the
real daemon in a child process, writes the same `req-<id>.json` the plugin
writes, drives the real WPF card through UI Automation, clicks every button, and
reads the real clipboard.

## Files

| Path | What |
| --- | --- |
| `index.ts` | plugin half: filter, write one request, return |
| `src/Coach.Rules.ps1` | the decisions: destructive, the seven security findings, suppression, fixed prompt |
| `src/Coach.Daemon.ps1` | daemon half: scan, one card, buttons, clipboard, pid guard |
| `index.test.ts` | plugin tests; no daemon, no timers |
| `tests/Rules.ps1` | headless rule tests; no desktop needed |
| `tests/Run-Minimal.ps1` | live end-to-end test for the daemon and card |
| `docs/IPC.md` | the one-file contract |

## Design notes

- **Post-send, not pre-send.** A pre-send gate turns a coach into a blocker and
  trains people to click through. A post-send card costs nothing when it is
  wrong.
- **One write, no wait.** The hook is on the send path; the daemon is not.
- **Teach, then rewrite.** Explain why is the part that makes the next prompt
  better; Fix my prompt is the part that makes this one better. Both are one
  click, and neither is required.
- **The card cannot take focus.** The window uses `WS_EX_NOACTIVATE` and
  `ShowActivated = false`, so a click leaves the caret where it was.
- **Fail-open everywhere.** A dead daemon, a missing folder, a malformed file,
  or a write error leaves the developer's send untouched. There is no path that
  drops or alters a prompt.
- **One card at a time.** A second card-worthy ask while a card is up is dropped
  and traced, not stacked.
