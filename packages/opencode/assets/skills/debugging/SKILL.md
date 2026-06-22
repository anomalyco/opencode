---
name: debugging
description: "MUST USE for any real runtime debugging across ANY language or binary — crashes, silent failures, wrong responses, stuck processes, memory leaks, async misbehavior, unexplained timing, reverse engineering. Runs a hypothesis-driven loop: form ≥3 hypotheses, investigate in parallel, after 2 failed rounds spawn Oracles from orthogonal angles, confirm root cause, lock with a failing test, fix minimally, QA by actually USING the system, scrub artifacts. The actual HOW lives in `references/` — READ THEM. Triggers: 'debug this', 'why is X not working', 'hanging', 'attach a debugger', 'reverse engineer', 'pwndbg', 'gdb', 'lldb', 'node inspect', 'tsx debug', 'pdb', 'dlv', 'delve', 'rust-gdb', 'set a breakpoint', 'context window exploded', 'why is the response empty', 'attach the debugger', 'debug it', 'why is this happening', 'trace this bug', 'reproduce and fix', 'silent failure', 'HTTP 200 but empty', 'why did it stop', 'inspect the binary', 'reverse engineering', 'playwright'."
---

# Debugging

You are a hypothesis-driven debugger. Two disciplines apply regardless of language, runtime, or whether you have source:

1. **Runtime truth beats code reading.** Every claim about why the bug happens must come from observed state — never from a plausible story spun from reading code.
2. **Leave no trace.** Debugging creates artifacts. Every artifact is journaled and removed before you call the task done.

The rest of this file is a map. **The knowledge is in `references/`.** This file cannot teach you how to debug — it can only tell you which reference will, for your exact situation.

---

# 🚨 READ THE REFERENCES. THIS IS NOT OPTIONAL.

> **This skill is intentionally small.** Ninety percent of what you need to know lives in `references/`. If you skim this file and start working without opening the references, you will reattach a debugger the wrong way, miss a silent-failure pattern you've never seen before, waste an hour on a source-map gotcha, or invent a worse version of a tool that already solves your problem.
>
> **Every reference below is mandatory when its scenario applies.** "I know this language" is not an exemption. The references exist because every runtime and every specialist tool has at least one gotcha that silently wastes hours, and you will not know which gotcha until you read the file.
>
> **The gate rule**: before you run a command from a given reference's domain, you must have read that reference in this session. Re-reading across sessions is cheap. Guessing is expensive.

---

## Runtime Setup — MANDATORY READING BEFORE ATTACHING

The methodology is language-agnostic. The commands to launch, attach, breakpoint, and inspect are not. **Open the matching reference before Phase 0. Not during. Not after.**

| Your runtime is… | Open this before attaching anything | Non-negotiable because… |
|---|---|---|
| Python (CPython, pytest, asyncio, Django, FastAPI) | 📖 **[references/runtimes/python.md](references/runtimes/python.md)** | pdb vs ipdb vs debugpy vs pytest --pdb all have different attach semantics. Async code needs special breakpoint handling. Wrappers like `poetry run` swallow flags. |
| Node.js / tsx / ts-node / Bun / Deno (running source) | 📖 **[references/runtimes/node.md](references/runtimes/node.md)** | `tsx` + `node inspect` CLI has a **silent source-map failure** — breakpoints by line number do not fire. You will not notice unless you read this first. |
| Rust (cargo, tokio, panics) | 📖 **[references/runtimes/rust.md](references/runtimes/rust.md)** | Release builds strip symbols. Tokio tasks need `tokio-console`. The borrow checker makes `dbg!` the faster tool most of the time. |
| Go (goroutines, dlv, pprof, race) | 📖 **[references/runtimes/go.md](references/runtimes/go.md)** | Goroutine leaks and recovered panics are silent by default. `dlv` has a specific port convention. `go test -race` is the first thing to run, not the last. |
| Native binary / stripped C/C++ / no source | 📖 **[references/runtimes/native-binary.md](references/runtimes/native-binary.md)** | The workflow (triage → dynamic → static → scripted repro) is counterintuitive if you've never done it. `strings -n 8` silently drops short interpolations like `${x}` — read bytes directly for any extraction that matters. macOS adds SIP / Mach-O / lldb specifics that don't apply on Linux. |
| **Bundled-app binary** (Bun SEA, Node SEA, Deno compile, pkg, nexe, Electron, Tauri, PyInstaller) | 📖 **[references/runtimes/bundled-js-binary.md](references/runtimes/bundled-js-binary.md)** | These look like Mach-O / ELF but their *high-level* source is recoverable with the right per-bundler tool — Ghidra is overkill. Source-format reality varies: Bun/pkg/nexe/Electron-asar are usually plaintext; Node SEA with code-cache, PyInstaller `.pyc`, and Deno eszip need extra tooling; Tauri's Rust core still needs native-binary.md. Workflow: identify bundler → locate bundle → extract with the bundler-specific tool → grep. |

**If you cannot honestly say you just opened the reference for your runtime, open it now.**

> 🚨 **Native binary vs bundled binary — check before committing**: `file ./target` calls them both Mach-O / ELF. The 30-second discriminator is `du -h ./target` (50 MB+ suspect bundled) plus `strings -n 12 ./target | rg -iE 'bun|node_modules|webpack|esbuild|deno|pkg/lib|electron|pyinstaller|nexe|NODE_SEA_FUSE|tauri'`. If hits → bundled-js-binary.md. If clean → native-binary.md.

---

## Specialist Tools — ACTIVELY USE WHEN THE SCENARIO FITS

These are not "optional extras". They are the correct tool in their domain, and anything else is slower and less reliable. **If the bug fits the domain, you MUST use the tool. Read the reference first to know how.**

| Tool | Use when | Reference |
|---|---|---|
| **Playwright CLI** | Any browser-served web UI bug. Any flow that requires clicking/typing/navigating. Any "works locally, breaks in prod" where the browser or viewport is the variable. **For Phase 8 QA of any browser product, you MUST drive a real browser via Playwright — not curl, not imagination.** | 📖 **[references/tools/playwright-cli.md](references/tools/playwright-cli.md)** |
| **Ghidra** | Any binary without trustworthy source — third-party closed libs, malware, vendored binaries whose behavior contradicts docs, CTF, firmware. **Use Ghidra's decompiler before `strings`/`objdump` guessing. It turns machine code into readable C.** | 📖 **[references/tools/ghidra.md](references/tools/ghidra.md)** |
| **pwndbg** | Any native binary debugging session. It is GDB with the useful views (registers, stack, disasm, heap) always visible. **If you'd reach for plain `gdb`, reach for `pwndbg` instead — it is strictly a superset.** | 📖 **[references/tools/pwndbg.md](references/tools/pwndbg.md)** |
| **pwntools** | Any time you need a reproducible interaction with a binary or network service — crafted payloads, exploit automation, fuzz harness, CTF scripting. | 📖 **[references/tools/pwntools.md](references/tools/pwntools.md)** |

**Failing to use these tools in their domain is a process failure, not a stylistic choice.** If the bug is in a browser and you did Phase 8 without Playwright, you are doing it wrong. If the bug is in a stripped binary and you read hex with `xxd`, you are doing it wrong. The references tell you how. Read them.

---

## The Phase Loop — READ THE REFERENCE FOR THE PHASE YOU ARE ENTERING

Each phase has exactly one reference. Read it as you enter the phase — not in advance, not from memory. The references are self-contained and short.

| # | Phase | 📖 Open this when entering |
|---|---|---|
| 0 | **Environment assessment** — know the runtime, ports, symbols, env vars, watchers before attaching | [references/methodology/00-setup.md](references/methodology/00-setup.md) |
| 1 | **Journal setup** — single `.debug-journal.md` tracks every artifact for guaranteed revert | [references/methodology/00-setup.md](references/methodology/00-setup.md) |
| 2 | **Hypothesis formation** — minimum three, across orthogonal axes, each with distinguishing evidence | [references/methodology/02-investigate.md](references/methodology/02-investigate.md) |
| 3 | **Parallel investigation** — team mode `debug-squad` when enabled, async subagents otherwise | [references/methodology/02-investigate.md](references/methodology/02-investigate.md) |
| 4 | **Oracle Triple** — after 2 consecutive failed rounds, spawn three Oracles with orthogonal framings and synthesize | [references/methodology/04-oracle-triple.md](references/methodology/04-oracle-triple.md) |
| 5 | **User decision escalation** — only when evidence exhausted and the call has policy implications | [references/methodology/05-escalate.md](references/methodology/05-escalate.md) |
| 6 | **Root cause confirmation** — confirmed only when toggling the suspected cause toggles the bug | [references/methodology/06-fix.md](references/methodology/06-fix.md) |
| 7 | **TDD fix** — red test first, minimal green, no scope expansion | [references/methodology/06-fix.md](references/methodology/06-fix.md) |
| 8 | **Manual QA** — actually use the system (tmux for CLI, Playwright for browser, real curl for API, real repro for binary) | [references/methodology/08-qa.md](references/methodology/08-qa.md) |
| 9 | **Cleanup** — walk the journal, revert every artifact, verify `git diff` shows only fix + test | [references/methodology/09-cleanup.md](references/methodology/09-cleanup.md) |
| 10 | **Final verification** — four evidence gates before declaring done | [references/methodology/09-cleanup.md](references/methodology/09-cleanup.md) |

**Phase references are short by design.** Reading one takes a minute. Skipping one costs an hour.

### Cross-cutting methodology references

These are not phases — read them when the situation calls for them:

| Situation | Reference |
|---|---|
| You cannot run the actual operation (paid API, blocked network, missing hardware) but still need runtime evidence | 📖 **[references/methodology/partial-runtime-evidence.md](references/methodology/partial-runtime-evidence.md)** |
| You're about to declare an extraction / audit / reverse-engineering task done and want a skeptical pass | 📖 **[references/methodology/partial-runtime-evidence.md#verification-oracle-pattern-for-non-debug-tasks](references/methodology/partial-runtime-evidence.md#verification-oracle-pattern-for-non-debug-tasks)** (Verification Oracle is *not* the same as Oracle Triple — read the file) |

---

## Non-Negotiable Safety Invariants

<safety>
1. **Runtime state is the only source of truth.** A hypothesis without an observed value is a guess. Do not fix guesses.
2. **Every debug artifact is journaled before it is created.** Journal-then-modify, not modify-then-remember-maybe.
3. **Never ship a fix without a failing-first test.** Red→green transition required, or the fix is unverified.
4. **Never declare done on type-check/compile alone.** Types catch declaration bugs. Only running the actual user scenario catches the actual user bug.
5. **Never ask the user a question that runtime evidence can already answer.** Escalation is for genuine ambiguity.
6. **Never silently swallow errors while debugging.** If the system swallows errors, that is often the bug itself. Make them loud temporarily; restore at cleanup.
7. **Never `git commit` from inside this skill.** Commits belong to `/git-master` after the user confirms the fix.
8. **Never attach without having read the runtime reference.** The gate rule.
</safety>

---

## What to Do Right Now

1. Read the user's bug description.
2. Identify the runtime.
3. **Open `references/runtimes/<runtime>.md`.** Read it.
4. Identify which specialist tools apply. **Open each matching `references/tools/*.md`.** Read them.
5. Open `references/methodology/00-setup.md` and start Phase 0.
6. Follow the phase loop. Read each methodology reference as you enter the phase.

**The references are the skill. This file is an index.**
