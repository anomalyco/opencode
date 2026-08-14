# Recruiting harness backlog

Work this list one item at a time. The fork is done. What remains is making the *working set* first-class the way a repo is first-class in a coding harness — not rebuilding the harness.

Strategy: `docs/gtm.html`. Ontology: `AGENTS.md`.

## How to pick up an item

1. Take the next **open** item in the current wave. Do not skip ahead into a later wave unless the current wave is blocked.
2. Read **Keep** before you touch anything. If the change would delete that analog, stop and split the item.
3. Ship the **Change** only. Leave follow-ups as their own items.
4. Verify on a dedicated req folder (`packages/moks/src/product/fixtures/hiring` or a throwaway req), not this monorepo root.
5. Mark the item `done` in this file in the same PR.

### Rules

- Mold prominence, defaults, copy, agent wiring, and workspace paths.
- Keep the session runner, permissions, MCP host, skill loader, multi-provider, plan-mode machinery, and diff plumbing.
- One cwd, one req. Do not invent `.moks/reqs/`, a multi-req book, or `@slug` focus.
- People are not files. Cards stay markdown working copies. Do not build a cloud ATS UI.
- There is no coding agent. Do not re-add `build` or `/init-code`.

### Analog map (do not break)

| Coding harness | moks |
|---|---|
| cwd is the repo | cwd is the req |
| `AGENTS.md` | `HIRING.md` |
| working tree | `HIRING.md` + `candidates/` |
| `git commit` | `moks commit` |
| `git push` | `moks push` |
| PR review | `/review` packet |
| file tree | packet / slate |
| diff | local hiring file deltas |
| plan → implement | plan → recruit |
| GitHub | ATS (mock now, Ashby later) |

---

## Already done — do not re-litigate

- Product paths: `moks.json` / `.moks/` / `MOKS_*` / `~/.config/moks`
- Default agent is `recruit`. `build` is hidden. Plan exits to recruit.
- Skills: `req-context`, `score-candidate`, `draft-outreach`, `commit-disposition`
- `/init` writes `HIRING.md` + `candidates/`. Instruction loader reads `HIRING.md` only.
- `/review` is packet review text, not `gh pr`.
- CLI verbs `commit` / `push` / `status` / `activity` exist and are hiring-shaped.
- Recruit edit allowlist + bash policy + Ashby write deny.
- LSP / formatters off unless configured.
- Home tips and placeholders already speak TA.
- **H01** — `moks pr` deleted (no GitHub PR checkout command)
- **H02** — `moks uninstall` removes moks dirs / `~/.moks/bin` only; never OpenCode

---

## Wave 0 — remove leftover coding verbs

Safe, local, no ontology change. Clear product landmines first.

### H01 — Hide or delete `moks pr`

- **Status:** done
- **Outcome:** A TA user cannot tab-complete into GitHub PR checkout.
- **Keep:** `/review` as the review verb. `gh` remains available to `build`.
- **Change:** Unregister `PrCommand` from `packages/moks/src/index.ts`. Prefer delete `cli/cmd/pr.ts` if nothing imports it. If something still needs it, `describe: false` is not enough — it is already hidden from help and still invokable.
- **Don't:** Rework `/review`. Touch GitHub MCP. Invent an ATS “PR.”
- **Touch:** `packages/moks/src/index.ts`, `packages/moks/src/cli/cmd/pr.ts`
- **Verify:** `moks pr --help` is unknown. `/review` still runs packet review.

### H02 — Stop `moks uninstall` from uninstalling OpenCode

- **Status:** done
- **Outcome:** `moks uninstall` only removes moks binaries and `~/.config/moks` / `~/.local/share/moks` paths.
- **Keep:** An uninstall command.
- **Change:** Rewrite package names, brew/npm/choco identifiers, and rc-file scrubbing so they target moks only. Do not touch `opencode-ai`, `brew uninstall opencode`, or `.opencode/bin`.
- **Don't:** Delete uninstall. Migrate OpenCode user configs.
- **Touch:** `packages/moks/src/cli/cmd/uninstall.ts`
- **Verify:** Read the command. Confirm it never prints or runs an OpenCode package name.

### H03 — Quarantine the GitHub Action agent

- **Status:** open
- **Outcome:** The old “install the GitHub agent / review this PR” product cannot be re-registered by accident.
- **Keep:** MCP host. Future Ashby/GitHub-as-source integrations can come back as their own items.
- **Change:** `GithubCommand` is already unregistered. Move `cli/cmd/github.ts` + `github.handler.ts` out of the product CLI tree or delete if unused. Remove stale help snapshots that document `moks github`.
- **Don't:** Build an Ashby GitHub app. Wire it back “just in case.”
- **Touch:** `packages/moks/src/cli/cmd/github.ts`, `packages/moks/src/cli/cmd/github.handler.ts`, related snapshots
- **Verify:** `rg "GithubCommand|moks github" packages/moks/src` has no CLI registration.

### H04 — Keep `/init-code` hidden; stop advertising it

- **Status:** open
- **Outcome:** First-run `/init` never mentions `AGENTS.md`, `/init-code`, or `build`.
- **Keep:** `/init-code` as a typed-if-you-know-it hatch, hidden from `/` autocomplete.
- **Change:** Strip hatch narration from `command/template/initialize.txt` and `packages/core/src/plugin/command/initialize.txt`. Fix OpenAPI `session.init` description (still says “create an AGENTS.md”). Align core `/init-code` description with “escape hatch,” not a featured setup.
- **Don't:** Delete `/init-code`. Change scaffold behavior.
- **Touch:** `packages/moks/src/command/template/initialize.txt`, `packages/core/src/plugin/command.ts`, `packages/moks/src/server/routes/instance/httpapi/groups/session.ts`
- **Verify:** `/init` prompt never contains `AGENTS.md` or `/init-code`. Scaffold still writes `HIRING.md`.

---

## Wave 1 — copy the recruit agent still sees

These strings go to the default doer every turn. Small diffs, high leverage. Do not rewrite `recruit.txt`.

### H05 — Shell tool teaches `moks commit` / `moks push`, not `gh pr`

- **Status:** open
- **Outcome:** Recruit’s bash tool no longer recipes a GitHub PR.
- **Keep:** Bash. Restricted git read (`status` / `diff` / `log`). `moks *` allow. `git push` deny.
- **Change:** Replace `gh pr create` examples and “git/PR work” policy with `moks commit` / `moks status` / `moks push` recipes. Keep the “only when asked” guard, pointed at decision verbs.
- **Don't:** Remove bash. Add a native commit tool here (that is H18).
- **Touch:** `packages/moks/src/tool/shell/shell.txt`, `packages/moks/src/tool/shell/prompt.ts`
- **Verify:** `rg "gh pr" packages/moks/src/tool/shell` is empty or build-only.

### H06 — Grep / glob examples are packet-shaped

- **Status:** open
- **Outcome:** Search tools suggest `HIRING.md` and `candidates/*.md`, not `src/**/*.ts`.
- **Keep:** Grep and glob. They are how you search a packet.
- **Change:** Swap coding examples in the tool descriptions. One hiring example each is enough.
- **Don't:** Add a new search tool. Restrict grep to markdown.
- **Touch:** `packages/moks/src/tool/grep.txt`, `packages/moks/src/tool/glob.txt`
- **Verify:** Open those files. No `*.js` / `src/**` as the lead example.

### H07 — Session titles from hiring work, not tickets

- **Status:** open
- **Outcome:** “Score Jordan Lee” stays a hiring title. “debug 500 errors” no longer pulls the title model toward engineering.
- **Keep:** The title agent and the existing hiring examples.
- **Change:** Replace the coding examples in `title.txt`. Add 2–3 more hiring ones if needed (reject, outreach, onsite).
- **Don't:** Change how titles are generated or stored.
- **Touch:** `packages/moks/src/agent/prompt/title.txt`
- **Verify:** Prompt a score / outreach / reject. Titles read like a req thread.

### H08 — `moks agent create` designs hiring agents

- **Status:** open
- **Outcome:** Generated agents are sourcers, schedulers, packet reviewers — not `code-reviewer`.
- **Keep:** `moks agent create` and the generate flow.
- **Change:** Rewrite `generate.txt` examples and the CLAUDE.md / prime-number bits.
- **Don't:** Remove agent create. Auto-generate a cast of new built-ins.
- **Touch:** `packages/moks/src/agent/generate.txt`
- **Verify:** Read the prompt. No `code-reviewer` / `test-generator` / prime-number task.

---

## Wave 2 — isolate the coding OS to `build`

Recruit already replaces provider prompts. The leftover OS must not leak onto promptless or custom agents, and `default.txt` must stop being split-brain.

### H09 — Finish `default.txt` as a hiring fallback

- **Status:** open
- **Outcome:** Any agent that hits `default.txt` is told to hire, not to lint and write `AGENTS.md`.
- **Keep:** Provider-specific coding prompts for `build` (see H10). The recruit/plan/explore prompts as-is.
- **Change:** Rewrite the body of `default.txt` to match the lede: hiring/TA tasks, packet files, `moks commit`/`push`, no lint/typecheck/`AGENTS.md` loop. Drop “URLs are for programming” and the “write tests for new feature” example.
- **Don't:** Merge this into `recruit.txt`. Don’t touch anthropic/gpt/codex in the same PR.
- **Touch:** `packages/moks/src/session/prompt/default.txt`
- **Verify:** File never tells the model to run tests, lint, or write `AGENTS.md`.

### H10 — Provider coding prompts are build-only

- **Status:** open
- **Outcome:** `build` still gets “coding agent.” No other agent does.
- **Keep:** `SystemPrompt.provider()` for agents that *are* the coding hatch. `build` stays promptless so it inherits them — or give `build` an explicit coding prompt and stop using provider files as a silent default.
- **Change (pick one, not both):**
  1. Preferred: only call `SystemPrompt.provider()` when `agent.name === "build"` (or `hidden` coding hatch). Promptless custom agents get `default.txt` (H09).
  2. Or: give `build` an explicit prompt and point every other fallback at `default.txt`.
- **Don't:** Rewrite every `anthropic.txt` / `gpt.txt` into a recruiter. Don’t delete `build`.
- **Touch:** `packages/moks/src/session/llm/request.ts`, maybe `packages/moks/src/agent/agent.ts`
- **Verify:** Recruit unchanged. `--agent build` still codes. A promptless custom agent does not say “best coding agent on the planet.”

### H11 — Drop “fork of OpenCode / implement a hook” product answers

- **Status:** open
- **Outcome:** “What can moks do?” is answered as a hiring product, not a coding-agent fork.
- **Keep:** Lineage comments in repo docs. MIT / copyright. Upgrade warnings that tell people not to install `opencode-ai`.
- **Change:** After H09/H10, grep provider + default prompts for “fork of OpenCode”, “software engineering”, “implement a hook”, “write a slash command.” Remove from any prompt that can fire off `build`.
- **Don't:** Rewrite `docs/gtm.html` or AGENTS.md in this item.
- **Touch:** `packages/moks/src/session/prompt/*.txt` that still leak after H09/H10
- **Verify:** `rg "fork of OpenCode|software engineering tasks" packages/moks/src/session/prompt` only hits build-only files.

### H12 — Footer / comments stop saying the default is `build`

- **Status:** open
- **Outcome:** Headless and API copy name `recruit` as the default doer.
- **Keep:** Ability to pass `--agent build`.
- **Change:** `runtime.lifecycle.ts` fallback label `"build"` → `"recruit"`. Stale github.handler comment if that file still exists after H03.
- **Don't:** Change agent resolution logic (it already defaults to recruit).
- **Touch:** `packages/moks/src/cli/cmd/run/runtime.lifecycle.ts`
- **Verify:** `moks run` footer without `--agent` says Recruit.

---

## Wave 3 — TUI prominence (same chrome, right labels)

Do not add panes yet. Make the existing surfaces tell the truth.

### H13 — Empty home when this folder is not a req

- **Status:** open
- **Outcome:** Opening TUI in a folder without `HIRING.md` says this cwd is the req and points at `/init`. Not a random tip.
- **Keep:** Home splash, `/init` scaffold, one-cwd-one-req.
- **Change:** If `HIRING.md` is missing in cwd, show a single empty state: “This folder is the req. `/init` to open it.” Keep the current hiring tips for folders that already have `HIRING.md`.
- **Don't:** Auto-run `/init`. Walk up to a parent `HIRING.md` and treat that as “already a req” (that fight is H21). Don’t add a req picker.
- **Touch:** TUI home route / empty state (around home placeholders and tips)
- **Verify:** TUI in an empty tmp dir. Then TUI in the hiring fixture — tips, not the empty state.

### H14 — Session composer keeps the hiring placeholders

- **Status:** open
- **Outcome:** The three home placeholders (“Score this resume…”, “Draft outreach…”, “Open a req with /init”) also appear in a live session composer.
- **Keep:** Home placeholders. Composer behavior.
- **Change:** Reuse the same strings in-session. Session is where the work happens.
- **Don't:** Add a new onboarding wizard.
- **Touch:** `packages/tui/src/component/prompt/` (session composer placeholder)
- **Verify:** New session shows a hiring placeholder, not a blank input.

### H15 — Agent picker copy is the job, not “native”

- **Status:** open
- **Outcome:** Picker reads `Recruit — score, outreach, commit` and `Plan — strategy only`.
- **Keep:** Two visible primaries. `build` hidden.
- **Change:** Replace the `"native"` blurb with the hiring one-liners. Use existing agent descriptions if they are already good; don’t invent a third agent.
- **Don't:** Expose `build` in the picker.
- **Touch:** `packages/tui/src/component/dialog-agent.tsx`, maybe `packages/tui/src/context/local.tsx`
- **Verify:** Open the agent switcher. No “native.”

### H16 — Help is the loop

- **Status:** open
- **Outcome:** `/help` (or the first help screen) is `/init → score-candidate → draft-outreach → /review → /commit → /push`.
- **Keep:** Keymap help accessible. Command palette.
- **Change:** Lead with the hiring loop. Keybinds can sit below. One screen.
- **Don't:** Build a tutorial engine. Duplicate skill docs.
- **Touch:** TUI help surface
- **Verify:** `/help` states the loop in that order.

### H17 — Statusline is req-shaped; tokens are secondary

- **Status:** open
- **Outcome:** Default chrome looks like `Senior Backend · 3 cards · 1 unpushed · recruit`, not `tokens · $cost · git-branch`.
- **Keep:** Tokens, model, cost — behind `/status` or a click, not deleted.
- **Change:** Home footer: drop `:git-branch` as the primary suffix. Session prompt footer: lead with req title (from `HIRING.md` H1 or cwd name), card count, unpushed decision count, agent. Move token/cost to the existing `/status` or a compact toggle.
- **Don't:** Remove the context sidebar math in the same PR if that fights H19. Don’t invent a custom status protocol.
- **Depends:** Card count is easy (`candidates/*.md`). Unpushed count can call the same data as `moks status`; if that’s sticky, show card count + agent first and leave unpushed for a follow-up.
- **Touch:** `packages/tui/src/component/prompt/index.tsx`, `packages/tui/src/components` home footer
- **Verify:** In the hiring fixture, footer does not lead with a git branch. Tokens still available via `/status`.

### H18 — Rename TUI `/status` vs `moks status`

- **Status:** open
- **Outcome:** One “status” means unpushed hiring commits. System probes are not named the same thing.
- **Keep:** Both screens. MCP/LSP/formatter probe.
- **Change:** Pick one: TUI `/status` becomes decision status (`moks status`), and today’s system panel becomes `/system`. Or keep `/status` as system and make `/decisions` the obvious alias (already exists) — then stop telling people `/status` is “not decision commits.” The first option matches the analog (`git status` → working tree + unpushed).
- **Don't:** Merge the two screens into one kitchen sink.
- **Touch:** TUI command registration, tips that mention `/status`
- **Verify:** `/status` and `moks status` are not contradictory. Tips match.

---

## Wave 4 — the loop’s review / diff / push surfaces

Same machinery. Point it at the packet. One item per surface.

### H19 — Diff titles and default file set are the packet

- **Status:** open
- **Outcome:** `/diff` still opens the existing viewer. It is titled and filtered like hiring deltas, not a PR.
- **Keep:** Diff plumbing. Working-tree / last-turn modes. Hunk rendering. File tree toggle.
- **Change:**
  - Palette stays “Open local hiring diff.”
  - Viewer titles: “Packet changes” / “Last turn.” Drop “Diff main branch” from the default recruit path (keep the mode for `build` if cheap, otherwise hide it).
  - Default listed files: `HIRING.md` + `candidates/*`. Other dirty files stay reachable, not featured.
  - “Mark selected file reviewed” can stay — that analog is useful on a packet.
- **Don't:** Delete the viewer. Show only remote ATS. Rebuild a card widget inside the diff.
- **Touch:** `packages/tui` diff-viewer, sidebar/files, command palette label
- **Verify:** Dirty `candidates/jordan-lee.md` shows first. A random `src/` file does not lead the list.

### H20 — TUI `/push` can complete the write

- **Status:** open
- **Outcome:** A recruiter who stays in the TUI can dry-run *or* `--execute`. Adverse still needs confirm.
- **Keep:** CLI `moks push` dry-run default, `--execute`, `--confirm` for adverse. Mock ATS. No silent agent writes.
- **Change:** Decision dialog grows an explicit “Write to ATS” vs “Dry-run” (or a confirm that passes `--execute`). Toast must not say “Pushed” if it was dry-run only — today’s “Pushed — dry-run (no ATS write)” is honest; the missing piece is the execute path.
- **Don't:** Auto-execute. Let the agent call Ashby write tools. Skip adverse confirm.
- **Touch:** `packages/tui/src/component/dialog-decision.tsx`, TUI `/push` handler
- **Verify:** Dry-run unchanged. Execute updates `.moks/ats.json` and `refs/moks/ats`. Reject/offer/hire still confirm.

### H21 — `/review` stays a command; stop implying it is a PR surface

- **Status:** open
- **Outcome:** `/review` still uses the packet prompt. Escape-hatch copy cannot invite `gh` unless the user is on `build` *and* asked for code review. Review output still lands in the current session if that’s a one-line `subtask` flip; otherwise leave subtask and only fix copy.
- **Keep:** Review template, Fit / Evidence / Outreach / Disposition / Risks shape, `subtask` machinery.
- **Change (this item is copy + hatch only):** Tighten `review.txt` so a recruit session cannot be steered into git/gh. Do not build a review pane here.
- **Don't:** Spawn a `gh pr` path. Redesign review as a new TUI route in this item (that is H27, later, optional).
- **Touch:** `packages/moks/src/command/template/review.txt`
- **Verify:** `/review` on recruit never mentions `gh pr` as a next step.

---

## Wave 5 — working set first-class

This is the SWE analog of “the file tree is the repo.” Still files. Just visible and operable without Glob-first.

### H22 — `isReqMaterial` includes `candidates/`

- **Status:** open
- **Outcome:** Helpers that mean “this is the working set” name both `HIRING.md` and `candidates/`.
- **Keep:** Cards as markdown. No new format.
- **Change:** Extend `ReqWorkspace.isReqMaterial` (and any twin) to include `candidates/*`. Use it anywhere the code currently special-cases only `HIRING.md` for “is this a req file.”
- **Don't:** Change scaffold layout. Load every card into the system prompt in this item.
- **Touch:** `packages/moks/src/product/req-workspace.ts` and its test
- **Verify:** Existing scaffold test still asserts no `.moks/reqs/`. New assertion: a card path is req material.

### H23 — Slate in context: list candidate cards without a Glob

- **Status:** open
- **Outcome:** Every recruit turn can see the slate (id, stage, score) the way a coding agent sees the file tree — without opening every card.
- **Keep:** Cards on disk. `@jordan-lee` attach. Skills that write onto the card. No multi-req index.
- **Change (pick the smaller analog):** Inject a short slate block into system context (id / stage / score / path), generated from `CandidateCard` list. Cap it. Full card body still requires Read / `@`.
- **Don't:** Auto-load full resumes. Build a sidebar yet (H26). Add a new database.
- **Touch:** `packages/moks/src/session/system.ts` or instruction assembly; `packages/moks/src/product/candidate-card.ts`
- **Verify:** New session in the hiring fixture mentions Jordan Lee’s stage/score before any tool call. Card bodies are not dumped.

### H24 — Native `commit` / `status` / `push` tools

- **Status:** open
- **Outcome:** Recruit records a disposition without bash. Same verbs, same git audit, same mock ATS.
- **Keep:** `moks commit` / `status` / `push` CLI as the implementation. Trailers. Adverse confirm. Dry-run default on push.
- **Change:** Thin tools that call the same functions as the CLI (`decision/verbs.ts`). Recruit permission: allow these tools; keep `git commit` as ask and `git push` as deny. Update `commit-disposition` to prefer the tools.
- **Don't:** Reimplement git. Auto-push. Let the tool take arbitrary paths. Remove bash.
- **Depends:** H05 so the shell prompt doesn’t fight the tools.
- **Touch:** new tool module under `packages/moks/src/tool/`, `packages/moks/src/tool/registry.ts`, `packages/moks/src/agent/agent.ts`, `packages/moks/src/product/skills/commit-disposition/SKILL.md`
- **Verify:** Score → tool commit → `moks status` shows the commit. Push tool dry-runs unless execute+confirm.

### H25 — Env / workspace prompt says this directory is the req

- **Status:** open
- **Outcome:** The model is told “this directory is the requisition,” not “workspace root / is git repo.”
- **Keep:** cwd, platform, date. Git remains how `moks commit` audits.
- **Change:** Relabel the env block in `session/system.ts` (and core builtin twin if it still says “Workspace root folder”). Mention `HIRING.md` + `candidates/` as the working set when present.
- **Don't:** Change `Project.resolve` here (H28). Don’t hide git from `moks commit`.
- **Touch:** `packages/moks/src/session/system.ts`, `packages/core/src/system-context/builtins.ts`
- **Verify:** First turn system context in the fixture reads as a req, not a software workspace.

---

## Wave 6 — cwd is the req (runtime)

Structural. Smallest change that stops hiring work from attaching to a parent software repo.

### H26 — Packet sidebar (replace Context + Modified Files as the default)

- **Status:** open
- **Outcome:** A recruiter can *see* the req: `HIRING.md` summary + candidate rows (stage, score). Empty: “No candidates yet.”
- **Keep:** Session runner. Diff hunks (H19). Token math available, not featured. `@` attach.
- **Change:** Default sidebar list is the packet. Context tokens and “Modified Files” move down or behind a toggle. Reuse `CandidateCard` parsing. Do not build an ATS board.
- **Don't:** Name the list `reqs`. Add `@slug` focus. Fetch remote Ashby into the sidebar.
- **Depends:** H22, H23 (slate data). H17 if you want the same counts in the footer.
- **Touch:** `packages/tui` sidebar components, autocomplete list currently named `reqs`
- **Verify:** Hiring fixture sidebar shows Jordan Lee. Empty tmp+`/init` shows “No candidates yet.”

### H27 — Optional later: `/review` as a pane

- **Status:** open
- **Outcome:** Same review prompt, rendered against the packet, with Commit / Push actions. Not a child coding session.
- **Keep:** Review rubric. Diff plumbing. Decision dialogs.
- **Change:** Only after H19 + H20 + H26. Promote the subtask into an inline pane or keep chat and pin the packet beside it. Do not start this to “make review feel native” before the packet is visible.
- **Don't:** Call `gh pr`. Build a GitHub-style review UI.
- **Touch:** TUI session route, review command `subtask` flag
- **Verify:** `/review` shows Fit / Evidence / Outreach / Disposition next to the card, then `/commit` works.

### H28 — Project / worktree = cwd when this folder is a req

- **Status:** open
- **Outcome:** Opening moks in a req folder does not adopt a parent software git root as the workspace.
- **Keep:** Git as the audit log *inside* the req. `moks commit` still creates commits. Nested engineering checkouts still work for `--agent build`.
- **Change (tactical, not a Project rewrite):** If cwd contains `HIRING.md`, treat cwd as the project directory even when a parent git repo exists. `moks commit` must `git init` in that cwd rather than commit hiring files into the parent product repo. Do not change identity hashing for non-req directories in the same PR if that ripples through Instance/Session — split if so.
- **Don't:** Delete git. Make every folder a fake repo. Invent a parallel project store. Walk up for `HIRING.md` and then use *that* parent as cwd (that reintroduces multi-dir reqs).
- **Depends:** H25 so copy and runtime agree. Decision git: `packages/moks/src/decision/git.ts`, `decision/verbs.ts`.
- **Touch:** `packages/core/src/project.ts` *or* a req-aware wrapper used by Instance + DecisionGit — prefer the wrapper if `Project.resolve` is too load-bearing.
- **Verify:** `moks commit` inside `packages/moks/src/product/fixtures/hiring` does **not** create a commit on this monorepo. It inits or uses a git repo local to that folder. `moks` at repo root without treating the monorepo as a req still behaves as an engineering checkout.

### H29 — Stop walking up out of the req for `HIRING.md`

- **Status:** open
- **Outcome:** Constitution is cwd’s `HIRING.md` (plus global `~/.config/moks/HIRING.md`). A parent software repo’s `HIRING.md` does not attach.
- **Keep:** Global user `HIRING.md`. Nested instruction-on-read *inside* the req (a card folder local note is fine).
- **Change:** Instruction walk stops at the req cwd (the H28 project directory), not the parent git worktree. `ReqWorkspace.resolve` should not promote a parent `HIRING.md` when cwd is the workspace.
- **Don't:** Load `candidates/` as constitution. Remove global HIRING.md.
- **Depends:** H28.
- **Touch:** `packages/moks/src/session/instruction.ts`, `packages/core/src/instruction-context.ts`, `packages/moks/src/product/req-workspace.ts`
- **Verify:** Nested cwd under the fixture still uses the fixture `HIRING.md` only if you decide nested *inside a req* is allowed — document the choice in the PR. A tmp dir inside this monorepo does not load a parent hiring file that isn’t in cwd.

---

## Wave 7 — don’t regress on the next runtime

### H30 — Core V2 recruit overlay matches v1

- **Status:** open
- **Outcome:** If/when core Session V2 is the runtime, recruit still has path-scoped edit, bash policy, and `lsp: deny`.
- **Keep:** Dual stack until V2 is default. V1 overlay in `packages/moks/src/agent/agent.ts` as the spec.
- **Change:** Port the recruit permission overlay (and plan/explore) onto `packages/core/src/plugin/agent.ts`. Do not invent a new policy language.
- **Don't:** “Port LSP” because the core builtin TODO says so. Expand core builtins to apply_patch for recruit.
- **Touch:** `packages/core/src/plugin/agent.ts`, compare `packages/moks/src/agent/agent.ts`
- **Verify:** Side-by-side permission tables match for recruit/plan/explore. Tests if core has an agent-permission suite.

### H31 — Core V2 `/init` + recruit prompt stay in sync with v1

- **Status:** open
- **Outcome:** The 3-line V2 `RECRUIT_SYSTEM` cannot drift into a different product.
- **Keep:** Long-form v1 `product/agents/recruit.txt` as source of truth for TUI/CLI.
- **Change:** Either share the file or add a comment + test that V2 still names HIRING.md, cards, `moks commit`/`push`, and never-send. Align `/init` templates.
- **Don't:** Duplicate a second full recruit prompt that will rot.
- **Touch:** `packages/core/src/plugin/agent.ts`, `packages/core/src/plugin/command.ts`
- **Verify:** V2 recruit text cannot mention “coding agent.” `/init` still scaffolds a req.

### H32 — External coding skills do not show up in `/skills`

- **Status:** open
- **Outcome:** A recruiter machine with `~/.claude/skills` does not get a coding-skill menu.
- **Keep:** Project-local skills under the req if someone adds them. Built-in four + `customize-moks`.
- **Change:** Stop discovering `~/.claude/skills` and `~/.agents/skills` in the product skill loader, or namespace them behind `build`. Product should read moks skill paths.
- **Don't:** Delete the skill loader. Block MCP.
- **Touch:** `packages/moks/src/skill/index.ts`
- **Verify:** With a dummy `~/.claude/skills/foo`, `/skills` still only lists hiring skills (plus customize-moks).

---

## Parking lot — not now

Do not pull these forward to look busy.

- Remote Ashby/Greenhouse as system of record (mock ATS is the write path until then)
- Calendar, send-email, or any outbound that isn’t “never send”
- Typed score/outreach tools (skills + card files are the analog of edit; only add tools if skills fail in practice)
- Review pane (H27) before packet sidebar (H26)
- Deleting `build`, LSP subsystem, or formatter pipeline
- Renaming packages or npm scopes
- Multi-req book, cloud workspace, `@slug` focus
- Using product moks to implement this list

---

## Suggested first five PRs

1. **H03** — quarantine GitHub Action agent
2. **H05** — shell recipes are decision verbs
3. **H06 + H07** — can be one PR if both stay copy-only
4. **H09** — `default.txt` finished
5. **H13** — empty home is `/init`

After those, the default path no longer *teaches* coding. Then H17–H20 make the loop completable in the TUI. Then H23–H28 make the req the workspace.
