# Recruiting harness backlog

Work this list one item at a time. The fork is done. The coding product is gone. What remains is making the *working set* first-class the way a repo is first-class in a coding harness — not rebuilding the harness.

Strategy: `docs/gtm.html`. Ontology: `AGENTS.md`.

**Execute waves 1–5:** do every **open** item in wave order. Skip `done`, `deferred`, Cancelled, Parking lot, Wave 6, and H27. Do not pick up Deferred. If an item’s Keep would be deleted, stop and split.

## How to pick up an item

1. Take the next **open** item in the current wave. Do not skip ahead into a later wave unless the current wave is blocked.
2. Read **Keep** before you touch anything. If the change would delete that analog, stop and split the item.
3. Ship the **Change** only. Leave follow-ups as their own items.
4. Verify on the hiring fixture or a throwaway company workspace, not this monorepo root.
5. Mark the item `done` in this file in the same PR.

### Rules

- Mold prominence, defaults, copy, agent wiring, and workspace paths.
- Keep the session runner, permissions, MCP host, skill loader, multi-provider, plan-mode machinery, and diff plumbing.
- Company folder is the workspace. Reqs are subdirectories you focus. Do not invent `.moks/reqs/` or a cloud req picker.
- People are not files. Cards stay markdown working copies. Do not build a cloud ATS UI.
- There is no coding agent. Do not re-add `build`, `/init-code`, LSP, or GitHub Action.

### Analog map (do not break)

| Coding harness | moks |
|---|---|
| cwd is the repo | company folder is the workspace |
| package / focus | focused req subdirectory |
| `AGENTS.md` | company + req `HIRING.md` |
| working tree | focused req: `HIRING.md` + `candidates/` |
| `git commit` | `moks commit` |
| `git push` | `moks push` |
| PR review | `/review` packet |
| file tree | company → reqs → slate |
| diff | local hiring file deltas |
| plan → implement | plan → recruit |
| GitHub | ATS (mock now, Ashby later) |

---

## Already done — do not re-litigate

**Identity**
- Product paths: `moks.json` / `.moks/` / `MOKS_*` / `~/.config/moks`
- Workspace: `packages/moks`, npm `@moks/*`, CLI package `moks`, root `moks-monorepo`
- MIT + upstream copyright in `LICENSE`

**Cast**
- Default agent is `recruit`. Plan exits to recruit. `build` deleted. `/init-code` deleted.
- Skills: `req-context`, `score-candidate`, `draft-outreach`, `commit-disposition`
- Claude / Agents skill discovery stays **on** (same `SKILL.md` format)

**Loop verbs**
- `/init` today writes `HIRING.md` + `candidates/` in cwd (single-req workspace). Company `/init` (req subdirectory) is H33.
- Instruction loader reads `HIRING.md` only.
- `/review` is packet review, not `gh pr`. No build/gh escape hatch in the template.
- CLI `commit` / `push` / `status` / `activity` exist and are hiring-shaped.
- Recruit edit allowlist + bash policy + Ashby write deny.

**Coding product cut**
- **H01** — `moks pr` deleted
- **H02** — `moks uninstall` removes moks dirs / `~/.moks/bin` only
- **H03** — GitHub Action CLI deleted (`github.ts` / `github.handler.ts` / `@actions/*`)
- **H04** — `/init-code` deleted; `/init` no longer mentions AGENTS.md / build
- **H09** — `default.txt` is a hiring fallback
- **H10** — promptless agents get `SystemPrompt.fallback()` (`default.txt`), not provider coding prompts
- **H12** — `moks run` footer defaults to Recruit
- LSP subsystem deleted (not parked). Formatters still exist, off unless configured.
- TUI `/share` hidden. `moks web` / `acp` / `generate` unregistered from the product CLI.

---

## Wave 1 — copy the recruit agent still sees

These strings still go to the default doer. Small diffs. Do not rewrite `recruit.txt`.

### H05 — Shell tool teaches `moks commit` / `moks push`, not `gh pr`

- **Status:** done
- **Outcome:** Recruit’s bash tool no longer recipes a GitHub PR.
- **Keep:** Bash. Restricted git read (`status` / `diff` / `log`). `moks *` allow. `git push` deny.
- **Change:** Replace `gh pr create` examples and “git/PR work” policy with `moks commit` / `moks status` / `moks push` recipes. Keep the “only when asked” guard, pointed at decision verbs.
- **Don't:** Remove bash. Add a native commit tool here (that is H24).
- **Touch:** `packages/moks/src/tool/shell/shell.txt`, `packages/moks/src/tool/shell/prompt.ts`
- **Verify:** `rg "gh pr" packages/moks/src/tool/shell` is empty.

### H06 — Grep / glob examples are packet-shaped

- **Status:** done
- **Outcome:** Search tools suggest `HIRING.md` and `candidates/*.md`, not `src/**/*.ts`.
- **Keep:** Grep and glob. They are how you search a packet.
- **Change:** Swap coding examples in the tool descriptions. One hiring example each is enough.
- **Don't:** Add a new search tool. Restrict grep to markdown.
- **Touch:** `packages/moks/src/tool/grep.txt`, `packages/moks/src/tool/glob.txt`
- **Verify:** Open those files. No `*.js` / `src/**` as the lead example.

### H07 — Session titles from hiring work, not tickets

- **Status:** done
- **Outcome:** “Score Jordan Lee” stays a hiring title. “debug 500 errors” no longer pulls the title model toward engineering.
- **Keep:** The title agent and the existing hiring examples.
- **Change:** Replace the coding examples in `title.txt`. Add 2–3 more hiring ones if needed (reject, outreach, onsite).
- **Don't:** Change how titles are generated or stored.
- **Touch:** `packages/moks/src/agent/prompt/title.txt`
- **Verify:** Prompt a score / outreach / reject. Titles read like a req thread.

### H08 — `moks agent create` designs hiring agents

- **Status:** done
- **Outcome:** Generated agents are sourcers, schedulers, packet reviewers — not `code-reviewer`.
- **Keep:** `moks agent create` and the generate flow.
- **Change:** Rewrite `generate.txt` examples and the CLAUDE.md / prime-number bits.
- **Don't:** Remove agent create. Auto-generate a cast of new built-ins.
- **Touch:** `packages/moks/src/agent/generate.txt`
- **Verify:** Read the prompt. No `code-reviewer` / `test-generator` / prime-number task.

### H11 — Dead provider prompt files

- **Status:** done
- **Outcome:** Unused coding `session/prompt/{anthropic,gpt,codex,…}.txt` are not sitting next to the live hiring fallback. One job prompt for all models.
- **Keep:** `default.txt` (live fallback). `recruit.txt` / `plan.txt` / explore prompts.
- **Change:** Delete provider `*.txt` that nothing calls after H10, plus `SystemPrompt.provider()` if it is only used by those files’ unit tests.
- **Don't:** Rewrite them into 8 recruiter novels. Touch `docs/gtm.html`. Tiny per-provider steering deltas only if a real model failure shows up later.
- **Touch:** `packages/moks/src/session/prompt/`, `packages/moks/src/session/system.ts`
- **Verify:** `rg "best coding agent|software engineering tasks" packages/moks/src/session/prompt` is empty or only in deleted-path history.

---

## Wave 2 — TUI prominence (same chrome, right labels)

Do not add panes yet. Make the existing surfaces tell the truth.

### H13 — Empty home when this folder is not a company

- **Status:** done
- **Outcome:** Opening TUI in a folder without a company `HIRING.md` says this folder is the company and points at `/init`. Not a random tip.
- **Keep:** Home splash, `/init` scaffold.
- **Change:** If `HIRING.md` is missing in the opened folder, show a single empty state: “This folder is the company. `/init` to start.” Keep today’s hiring tips when `HIRING.md` is present (fixture / company / single-req). Do not implement focus or req-list empty states here (H33 / H34 / H26).
- **Don't:** Auto-run `/init`. Treat a parent *software* repo as the company. Don’t build a cloud req picker.
- **Touch:** TUI home route / empty state (around home placeholders and tips)
- **Verify:** TUI in an empty tmp dir. Then TUI in the hiring fixture — tips, not the empty state.

### H14 — Session composer keeps the hiring placeholders

- **Status:** done
- **Outcome:** The three home placeholders (“Score this resume…”, “Draft outreach…”, “Open a req with /init”) also appear in a live session composer.
- **Keep:** Home placeholders. Composer behavior.
- **Change:** Reuse the same strings in-session. Session is where the work happens.
- **Don't:** Add a new onboarding wizard.
- **Touch:** `packages/tui/src/component/prompt/` (session composer placeholder)
- **Verify:** New session shows a hiring placeholder, not “Ask anything...”

### H15 — Agent picker copy is the job, not “native”

- **Status:** done
- **Outcome:** Picker reads `Recruit — score, outreach, commit` and `Plan — strategy only`.
- **Keep:** Two visible primaries. No third agent.
- **Change:** Replace the `"native"` blurb with the hiring one-liners. Use existing agent descriptions if they are already good.
- **Don't:** Re-add `build` to the picker.
- **Touch:** `packages/tui/src/component/dialog-agent.tsx`, maybe `packages/tui/src/context/local.tsx`
- **Verify:** Open the agent switcher. No “native.”

### H17 — Statusline is req-shaped; tokens are secondary

- **Status:** done
- **Outcome:** Default chrome looks like `Senior Backend · 3 cards · 1 unpushed · recruit`, not `tokens · $cost · git-branch`.
- **Keep:** Tokens, model, cost — behind `/status` or a click, not deleted.
- **Change:** Home footer: drop `:git-branch` as the primary suffix. Session prompt footer: lead with req title (from `HIRING.md` H1 or cwd name), card count, unpushed decision count, agent. Move token/cost to the existing `/status` or a compact toggle.
- **Don't:** Remove the context sidebar math in the same PR if that fights H19. Don’t invent a custom status protocol.
- **Depends:** Card count is easy (`candidates/*.md`). Unpushed count can call the same data as `moks status`; if that’s sticky, show card count + agent first and leave unpushed for a follow-up.
- **Touch:** `packages/tui/src/component/prompt/index.tsx`, home footer
- **Verify:** In the hiring fixture, footer does not lead with a git branch. Tokens still available via `/status`.

### H18 — Rename TUI `/status` vs `moks status`

- **Status:** done
- **Outcome:** One “status” means unpushed hiring commits. System probes are not named the same thing.
- **Keep:** Both screens. MCP probe. Formatter probe can stay behind the system screen (formatters still exist, off by default).
- **Change:** Prefer: TUI `/status` becomes decision status (`moks status`), and today’s system panel becomes `/system`. That matches the analog (`git status` → working tree + unpushed).
- **Don't:** Merge the two screens. Re-add an LSP block.
- **Touch:** TUI command registration, tips that mention `/status`
- **Verify:** `/status` and `moks status` are not contradictory. Tips match.

---

## Wave 3 — the loop’s review / diff / push surfaces

Same machinery. Point it at the packet. H19 / H20 are deferred.

### H21 — `/review` copy is already packet-shaped

- **Status:** done
- **Outcome:** `/review` is packet review. Template does not invite `gh pr` or a coding hatch.
- **Note:** A review *pane* is H27, later, optional.

---

## Wave 4 — working set first-class

This is the SWE analog of “the file tree is the repo.” Still files. Just visible and operable without Glob-first.

### H22 — `isReqMaterial` includes `candidates/`

- **Status:** done
- **Outcome:** Helpers that mean “this is the working set” name both `HIRING.md` and `candidates/`.
- **Keep:** Cards as markdown. No new format.
- **Change:** Extend `ReqWorkspace.isReqMaterial` (and any twin) to include `candidates/*.md` at a req path (`<req>/candidates/<id>.md` or cwd `candidates/` in a single-req workspace). Use it anywhere the code currently special-cases only `HIRING.md` for “is this a req file.”
- **Don't:** Change scaffold layout. Load every card into the system prompt in this item. Invent `.moks/reqs/`.
- **Touch:** `packages/moks/src/product/req-workspace.ts` and its test
- **Verify:** Existing scaffold test still asserts no `.moks/reqs/`. New assertion: a card path is req material.

### H23 — Slate in context: list candidate cards without a Glob

- **Status:** done
- **Outcome:** Every recruit turn can see the slate (id, stage, score) the way a coding agent sees the file tree — without opening every card.
- **Keep:** Cards on disk. `@jordan-lee` attach. Skills that write onto the card. Filesystem is the book.
- **Change (pick the smaller analog):** Inject a short slate block into system context (id / stage / score / path) for the **focused req only** (cwd packet if single-req). Generated from `CandidateCard` list. Cap it. Full card body still requires Read / `@`. If no req is focused, list req directory names — not every card in the company.
- **Don't:** Auto-load full resumes. Build a sidebar yet (H26). Add a new database.
- **Touch:** `packages/moks/src/session/system.ts` or instruction assembly; `packages/moks/src/product/candidate-card.ts`
- **Verify:** New session in the hiring fixture mentions Jordan Lee’s stage/score before any tool call. Card bodies are not dumped.

### H24 — Native `commit` / `status` / `push` tools

- **Status:** done
- **Outcome:** Recruit records a disposition without bash. Same verbs, same git audit, same mock ATS.
- **Keep:** `moks commit` / `status` / `push` CLI as the implementation. Trailers. Adverse confirm. Dry-run default on push.
- **Change:** Thin tools that call the same functions as the CLI (`decision/verbs.ts`). Recruit permission: allow these tools; keep `git commit` as ask and `git push` as deny. Update `commit-disposition` to prefer the tools.
- **Don't:** Reimplement git. Auto-push. Let the tool take arbitrary paths. Remove bash.
- **Depends:** H05 so the shell prompt doesn’t fight the tools.
- **Touch:** new tool module under `packages/moks/src/tool/`, `packages/moks/src/tool/registry.ts`, `packages/moks/src/agent/agent.ts`, `packages/moks/src/product/skills/commit-disposition/SKILL.md`
- **Verify:** Score → tool commit → `moks status` shows the commit. Push tool dry-runs unless execute+confirm.

### H25 — Env / workspace prompt says this is the company

- **Status:** done
- **Outcome:** The model is told this folder is the company workspace and which req is focused, not “workspace root / is git repo.”
- **Keep:** cwd, platform, date. Git remains how `moks commit` audits.
- **Change:** Relabel the env block in `session/system.ts` (and core builtin twin if it still says “Workspace root folder”). Mention company `HIRING.md`, focused req when present, and that req’s `candidates/`. Single-req fixture: company and req are the same folder.
- **Don't:** Change `Project.resolve` here (H28). Don’t hide git from `moks commit`.
- **Touch:** `packages/moks/src/session/system.ts`, `packages/core/src/system-context/builtins.ts`
- **Verify:** First turn system context in a company workspace reads as hiring, not a software workspace.

---

## Wave 5 — company is the workspace (runtime)

Structural. Do H33 → H34 before H26 / H29. H27 is deferred. Verify H33–H29 on a **throwaway company** with two req dirs, not this monorepo. The hiring fixture stays a valid single-req workspace.

### H33 — `/init` at company root scaffolds a req directory

- **Status:** done
- **Outcome:** `/init` matches the ontology. Empty folder becomes a company. Company root gains a req subdirectory. Single-req fixture layout still works.
- **Keep:** `HIRING.md` stub + `candidates/`. No `.moks/reqs/`. Hidden `/init-code` stays gone.
- **Change:**
  - No `HIRING.md` in the opened folder: write company `HIRING.md` (constitution stub). Folder is now a company.
  - Company `HIRING.md` present, no `candidates/` at root: `/init [title]` creates `<slug>/HIRING.md` + `<slug>/candidates/`.
  - Root already has `HIRING.md` + `candidates/`: single-req workspace; do not nest a second req; skip or refresh empty stubs only.
- **Don't:** Auto-focus a picker UI. Walk up to a parent software `HIRING.md` and init there. Turn this monorepo into a company.
- **Touch:** `/init` templates and scaffold (`packages/moks/src/product/req-workspace.ts`, command initialize templates)
- **Verify:** Empty tmp → company `HIRING.md`. Second `/init Senior Backend` → `senior-backend/HIRING.md` + `candidates/`. Fixture `/init` does not nest.

### H34 — Focus a req (`@<req>` or last-focused)

- **Status:** done
- **Outcome:** The working set this turn is one req packet. Recruit does not dump every slate in the company.
- **Keep:** Filesystem is the book. `@` attach. `.moks/` is cache only.
- **Change:** Focus = `@<req-dir>` or last-focused req (persist in `.moks/`, not a book). Single-req workspace: that folder is focused. Packet = focused `HIRING.md` + `candidates/`. Company `HIRING.md` still loads (H29).
- **Don't:** Cloud req picker. `@slug` as a virtual id with no directory. Focus all reqs at once. Store reqs under `.moks/reqs/`.
- **Depends:** H33 so there are real req directories to focus.
- **Touch:** attach/mention, session or instance cache, whatever already lists `@` files
- **Verify:** Company with two reqs: `@staff-platform` then slate/edits hit only that packet. Restart uses last-focused. Fixture needs no extra mention.

### H26 — Packet sidebar (replace Context + Modified Files as the default)

- **Status:** done
- **Outcome:** A recruiter can *see* the company: req list, then the focused req’s `HIRING.md` + candidate rows (stage, score). Empty req: “No candidates yet.”
- **Keep:** Session runner. Diff hunks (H19). Token math available, not featured. `@` attach.
- **Change:** Default sidebar is company → focused req packet. Context tokens and “Modified Files” move down or behind a toggle. Reuse `CandidateCard` parsing. Do not build an ATS board.
- **Don't:** Hide reqs in `.moks/reqs/`. Fetch remote Ashby into the sidebar.
- **Depends:** H22, H23 (slate data), H34 (focus). H17 if you want the same counts in the footer.
- **Touch:** `packages/tui` sidebar components, autocomplete list currently named `reqs`
- **Verify:** Company with two reqs lists both. Focused hiring fixture shows Jordan Lee. Empty new req shows “No candidates yet.”

### H28 — Project / worktree = company folder, not a parent software repo

- **Status:** done
- **Outcome:** Opening moks in a company (or focused req inside it) does not adopt a parent software git root as the workspace.
- **Keep:** Git as the audit log for the company workspace. `moks commit` still creates commits. Engineering checkouts without a company `HIRING.md` still resolve as a git project.
- **Change (tactical, not a Project rewrite):** If the opened folder is a company workspace, treat that folder as the project directory even when a parent git repo exists. `moks commit` must not write hiring commits into this monorepo. Do not change identity hashing for non-hiring directories in the same PR if that ripples through Instance/Session — split if so.
- **Don't:** Delete git. Make every folder a fake repo. Invent a parallel project store. One git remote per req.
- **Depends:** H25 so copy and runtime agree. Decision git: `packages/moks/src/decision/git.ts`, `decision/verbs.ts`.
- **Touch:** `packages/core/src/project.ts` *or* a company-aware wrapper used by Instance + DecisionGit — prefer the wrapper if `Project.resolve` is too load-bearing.
- **Verify:** `moks commit` inside a throwaway company workspace does **not** create a commit on this monorepo. `moks` at this repo root still behaves as an engineering checkout.

### H29 — Load company + focused req `HIRING.md`, not a software parent

- **Status:** done
- **Outcome:** Constitution is `~/.config/moks/HIRING.md` + company `HIRING.md` + focused req `HIRING.md`. A parent software repo’s `HIRING.md` does not attach.
- **Keep:** Global user `HIRING.md`. Nested instruction-on-read inside the focused req.
- **Change:** Instruction walk is company root → focused req, then stop. Do not walk out of the company into a parent software worktree.
- **Don't:** Load `candidates/` as constitution. Remove global HIRING.md. Flatten all req constitutions into every turn.
- **Depends:** H28, H34.
- **Touch:** `packages/moks/src/session/instruction.ts`, `packages/core/src/instruction-context.ts`, `packages/moks/src/product/req-workspace.ts`
- **Verify:** Nested req loads company + that req’s `HIRING.md`. A tmp dir inside this monorepo does not load an unrelated parent hiring file.

---

## Wave 6 — don’t regress on the next runtime

### H30 — Core V2 recruit overlay matches v1

- **Status:** open
- **Outcome:** If/when core Session V2 is the runtime, recruit still has path-scoped edit and bash policy. No LSP.
- **Keep:** Dual stack until V2 is default. V1 overlay in `packages/moks/src/agent/agent.ts` as the spec.
- **Change:** Port the recruit permission overlay (and plan/explore) onto `packages/core/src/plugin/agent.ts`. Do not invent a new policy language. Do not port LSP.
- **Don't:** Expand core builtins to apply_patch for recruit.
- **Touch:** `packages/core/src/plugin/agent.ts`, compare `packages/moks/src/agent/agent.ts`
- **Verify:** Side-by-side permission tables match for recruit/plan/explore (minus deleted `lsp` / `plan_enter` / `build`).

### H31 — Core V2 `/init` + recruit prompt stay in sync with v1

- **Status:** open
- **Outcome:** The 3-line V2 `RECRUIT_SYSTEM` cannot drift into a different product.
- **Keep:** Long-form v1 `product/agents/recruit.txt` as source of truth for TUI/CLI.
- **Change:** Either share the file or add a test that V2 still names HIRING.md, cards, `moks commit`/`push`, and never-send. Align `/init` templates.
- **Don't:** Duplicate a second full recruit prompt that will rot.
- **Touch:** `packages/core/src/plugin/agent.ts`, `packages/core/src/plugin/command.ts`
- **Verify:** V2 recruit text cannot mention “coding agent.” `/init` still matches H33 (company + req dir, or single-req fixture).

---

## Cancelled — do not reopen

- **H32** — “Stop loading `~/.claude/skills`.” Reversed: those are useful `SKILL.md` skills. Opt-out remains `MOKS_DISABLE_CLAUDE_CODE_SKILLS`.
- Isolate a coding OS to `build`. `build` is deleted.
- Keep LSP dormant for dogfood. LSP is deleted.
- Rename `packages/opencode` / `@opencode-ai/*`. Done.

---

## Deferred — do not pick up

Still wanted. Not in the current wave order. Bring back only after a conversation.

### H16 — Help is the loop

- **Status:** deferred
- **Outcome:** `/help` (or the first help screen) is `/init → score-candidate → draft-outreach → /review → /commit → /push`.
- **Keep:** Keymap help accessible. Command palette.
- **Change:** Lead with the hiring loop. Keybinds can sit below. One screen.
- **Don't:** Build a tutorial engine. Duplicate skill docs.
- **Touch:** TUI help surface
- **Verify:** `/help` states the loop in that order.

### H19 — Diff titles and default file set are the packet

- **Status:** deferred
- **Outcome:** `/diff` still opens the existing viewer. It is titled and filtered like hiring deltas, not a PR.
- **Keep:** Diff plumbing. Working-tree / last-turn modes. Hunk rendering. File tree toggle.
- **Change:**
  - Palette stays “Open local hiring diff.”
  - Viewer titles: “Packet changes” / “Last turn.” Hide “Diff main branch” (no coding hatch to keep it for).
  - Default listed files: `HIRING.md` + `candidates/*`. Other dirty files stay reachable, not featured.
  - “Mark selected file reviewed” can stay — that analog is useful on a packet.
- **Don't:** Delete the viewer. Show only remote ATS. Rebuild a card widget inside the diff.
- **Touch:** `packages/tui` diff-viewer, sidebar/files, command palette label
- **Verify:** Dirty `candidates/jordan-lee.md` shows first. A random `src/` file does not lead the list.

### H20 — TUI `/push` can complete the write

- **Status:** deferred
- **Outcome:** A recruiter who stays in the TUI can dry-run *or* `--execute`. Adverse still needs confirm.
- **Keep:** CLI `moks push` dry-run default, `--execute`, `--confirm` for adverse. Mock ATS. No silent agent writes.
- **Change:** Decision dialog grows an explicit “Write to ATS” vs “Dry-run” (or a confirm that passes `--execute`). Toast must not say “Pushed” if it was dry-run only.
- **Don't:** Auto-execute. Let the agent call Ashby write tools. Skip adverse confirm.
- **Touch:** `packages/tui/src/component/dialog-decision.tsx`, TUI `/push` handler
- **Verify:** Dry-run unchanged. Execute updates `.moks/ats.json` and `refs/moks/ats`. Reject/offer/hire still confirm.

### H27 — Optional later: `/review` as a pane

- **Status:** deferred
- **Outcome:** Same review prompt, rendered against the packet, with Commit / Push actions. Not a child coding session.
- **Keep:** Review rubric. Diff plumbing. Decision dialogs.
- **Change:** Only after H19 + H20 + H26. Promote the subtask into an inline pane or keep chat and pin the packet beside it. Do not start this to “make review feel native” before the packet is visible.
- **Don't:** Call `gh pr`. Build a GitHub-style review UI.
- **Touch:** TUI session route, review command `subtask` flag
- **Verify:** `/review` shows Fit / Evidence / Outreach / Disposition next to the card, then `/commit` works.

---

## Parking lot — not now

- Remote Ashby/Greenhouse as system of record (mock ATS is the write path until then)
- Calendar, send-email, or any outbound that isn’t “never send”
- Typed score/outreach tools (skills + card files are the analog of edit)
- Review pane (H27) before packet sidebar (H26)
- Delete the formatter pipeline (off by default; not LSP)
- Rename `createOpencodeClient` / generated SDK types
- Theme id `opencode` (picker already shows “moks”)
- Cloud workspace / cloud req picker
- Hidden `.moks/reqs/` index (filesystem is the book)
- Using product moks to implement this list

---

## Suggested first five PRs

1. **H05** — shell recipes are decision verbs
2. **H06 + H07** — copy-only, can be one PR
3. **H08** — `agent create` factory
4. **H13** — empty home is `/init`
5. **H14** — in-session hiring placeholders

After those, the default path no longer *teaches* coding. Then H17–H18 make chrome req-shaped. Then H22–H25 make the focused packet first-class. Then H33 → H34 → H26 / H28 / H29 make the company the workspace. H16 / H19 / H20 / H27 stay deferred.
