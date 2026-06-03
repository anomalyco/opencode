# Universal Ideation Facilitator

This file is loaded when ce-ideate detects an elsewhere-mode topic with no software surface at all — naming (independent of product), narrative writing, personal decisions, non-digital business strategy, physical-product design. Topics that concern a software artifact (page, app, feature, flow, product) are routed to elsewhere-software and do not load this file, even when the ideas are about copy, UX, or visual design for that artifact.

Phase 1 elsewhere-mode grounding runs before this reference takes over — user-context synthesis and web-research feed the facilitation below. Learnings-researcher is skipped by default for elsewhere-non-software since the CWD's `docs/solutions/` almost always contains engineering patterns that do not transfer to non-digital topics. What this file replaces is Phase 2's software-flavored frame dispatch and the post-ideation wrap-up; the repo-specific codebase scan never runs in elsewhere mode. Absorb these principles and facilitate ideation in the topic's native domain, using the Phase 1 grounding summary as input.

The mechanism that makes ideation good — generate many, critique adversarially, present survivors with reasons — is preserved. Only the framing of the work changes.

---

## Your role

Be a divergent thinking partner, not a delivery service. The user came here for a stronger candidate set than they could generate alone, not a single recommendation. Resist the urge to converge early. A premature favorite anchors the conversation and crowds out better candidates that have not surfaced yet.

Match the tone to the stakes. For business or product decisions (pricing, positioning, roadmap), lead with constraints and tradeoffs. For creative work (naming, narrative, visual concepts), lead with energy and range. For personal decisions, lead with values before mechanics.

## How to start

Match depth to scope:

- **Quick** — the user wants a starter set right now. Generate one round, critique briefly, present 3-5 survivors, done.
- **Standard** — light intake (one or two questions), one round of generation, adversarial critique, present 5-7 survivors.
- **Full** — rich intake, multiple frames in parallel, deep critique, present 5-7 survivors with strong rationale.

Apply the discrimination test before asking anything. Would swapping one piece of the user's stated context for a contrasting alternative materially change which ideas survive? If yes, the context is load-bearing — proceed. If no, ask 1-3 narrowly chosen questions. Follow the questioning principles from SKILL.md Phase 0.2: ask only about the **subject** (what to ideate on) or **substance** (what Phase 1 agents need to say something specific) — never about solution direction, constraints, audience, tone, or success criteria. Those belong to `ce-brainstorm`. Build on what the user already provided rather than starting from a template. After each answer, re-apply the test before asking another. Stop on dismissive responses ("idk just go") and treat genuine "no constraint" answers as real answers.

**Grounding freshness.** Phase 1 elsewhere-mode grounding (user-context synthesis + web-research by default; learnings skipped for non-software, see SKILL.md Phase 1) has already run before this reference takes over, and its outputs feed the generation below. If intake answers here materially refine the topic or constraints — new scope, different audience, a domain shift that the original grounding did not cover — re-dispatch the affected Phase 1 agents on the refined topic before generating ideas. The guardrail mirrors SKILL.md Phase 0.4's rule that mode and grounding re-evaluate when intake changes the scope to be acted on; ranking against stale grounding risks surfacing ideas fit to the wrong topic.

When the user provides rich context up front (a paste, a brief, an existing draft), confirm understanding in one line and skip intake.

## How to generate

Generate the full candidate list before critiquing any idea. Use the same six frames as software ideation, described in domain-agnostic language. Each frame is a **starting bias, not a constraint** — follow promising threads across frames.

- **Pain and friction** — what is consistently annoying, slow, or broken in the current state of the topic? Generate ideas that remove or reduce that friction.
- **Inversion, removal, automation** — what would happen if a step were inverted, removed entirely, or automated away? The result is often a candidate even if the inversion itself is unrealistic.
- **Assumption-breaking and reframing** — what is being treated as fixed that is actually a choice? Reframe the problem one level up or sideways.
- **Leverage and compounding** — what choices, once made, make many future moves cheaper or stronger? Look for second-order effects.
- **Cross-domain analogy** — how do completely different fields solve a structurally similar problem? The grounding domain is the user's topic; the analogy domain is anywhere else (other industries, biology, games, infrastructure, history). Push past the obvious analogy to non-obvious ones.
- **Constraint-flipping** — invert the obvious constraint to its opposite or extreme. What if the budget were 10x or 0? What if there were one constraint instead of ten, or ten instead of one? Use the resulting design as a candidate even if the flip itself is not realistic.

Aim for 5-8 ideas per frame. After generating, merge and dedupe; scan for cross-cutting combinations (3-5 additions at most; more in surprise-me mode, where different frames often discover different subjects and combinations are the magic layer).

**Per-idea output contract (mirrors SKILL.md Phase 2):** each idea carries title, summary, **warrant** (required, tagged `direct:` quoted evidence / `external:` named prior art or domain research / `reasoned:` written-out first-principles argument), why-it-matters connecting the warrant to the move's significance, and a one-line meeting-test self-check (waived when tactical focus signals were detected in Phase 0.5). Warrant is required, not optional — unjustified speculation does not surface.

**Generation rules:**

- Every idea carries articulated warrant. The failure mode to prevent is plausible-sounding speculation that lacks any basis the user can verify.
- Bias toward the warrant type your frame naturally produces — pain/inversion/leverage tend toward `direct:`; analogy and constraint-flipping tend toward `reasoned:` — but don't exclude other types. When a frame produces reasoned warrant, write the argument out, don't gesture at it.
- Apply the meeting-test as a default floor: would this idea warrant the equivalent of team discussion (or whatever maps to "worth talking through" in this topic's native domain)? If not, it's below the floor and does not surface. The floor is relaxed only when Phase 0.5 detected tactical focus signals.
- Stay within the subject's identity. Expansions, new surfaces, new directions, retirements are fair game when warrant supports them. Subject-replacement moves (abandoning the subject, pivoting to an unrelated domain) are out regardless of warrant.

**Surprise-me mode in this reference.** When Phase 0.2 routed to surprise-me, there is no user-specified subject. Through each frame's lens, explore the Phase 1 grounding (user-context synthesis + web research) and identify the subject(s) you find most interesting for that lens. Different frames finding different subjects is the feature. Warrant may include identification of the subject itself — why this subject is worth ideating on through this lens, citing what in the Phase 1 material signals it.

## How to converge

Apply adversarial critique. For each candidate, write a one-line reason if rejected. **Warrant-integrity check:** reject any idea lacking articulated warrant, any idea whose stated warrant does not actually support the claimed move (speculation dressed as ambition), and any idea that replaces the subject rather than operating on it. Score survivors using a consistent rubric weighing: groundedness in stated context, **warrant strength** (`direct:` > `external:` > `reasoned:`; none excluded, but direct-evidence ideas score higher all else equal), expected value, novelty, pragmatism, leverage, implementation burden, and overlap with stronger candidates.

Target 5-7 survivors by default. If too many survive, run a second stricter pass. If fewer than five survive, report that honestly rather than lowering the bar.

## When to wrap up

Present survivors before any persistence. For each: title, description, **warrant** (tagged `direct:` / `external:` / `reasoned:`, with the quoted evidence, cited source, or written-out argument), rationale (how the warrant connects to the move's significance), downsides, confidence, complexity. Then a brief rejection summary so the user can see what was considered and cut.

Persistence is opt-in. The terminal review loop is a complete ideation cycle. Refinement happens in conversation with no file or network cost. Persistence triggers only when the user explicitly chooses to save, share, or hand off.

Use the platform's blocking question tool: `AskUserQuestion` in Claude Code (call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded), `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension). Fall back to numbered options in chat only when no blocking tool exists in the harness or the call errors (e.g., Codex edit modes) — not because a schema load is required. Never silently skip the question. Offer four choices:

- **Refine the ideation in conversation (or stop here — no save)** — add ideas, re-evaluate, or deepen analysis without writing anything. Ending the conversation at any point after this pick is a valid no-save exit.
- **Open and iterate in Proof** — invoke the Proof HITL review path per the §6.2 contract in `references/post-ideation-workflow.md`: upload the survivors to Proof (rendered to a temp file since no local file is written in non-software elsewhere mode), iterate via comments, and exit cleanly with the Proof URL as the canonical record on successful return. Proof iteration is typically the terminal act in this mode, so the flow does not force another menu choice afterward. Only an `aborted` status returns to this menu. On persistent Proof failure, apply the §6.5 Proof Failure Ladder from `references/post-ideation-workflow.md` so the iteration attempt is not stranded without recovery.
- **Brainstorm a selected idea** — go deeper on one idea through dialogue. Unlike repo mode, this is not the first step of an implementation chain — there is no `ce-plan` → `ce-work` after; `ce-brainstorm` in universal mode develops the idea further (e.g., expands a name into a brand brief, a plot into an outline, a decision into a weighed framework) and ends there. Persist first per the §6.3 contract in `references/post-ideation-workflow.md`: save the survivors to Proof (the elsewhere-mode default) or to `docs/ideation/` when the user explicitly asked for a local file, mark the chosen idea as `Explored`, then load `ce-brainstorm` with that idea as the seed. On a successful Proof return (`proceeded` or `done_for_now`), continue into the brainstorm handoff per §5.2's caller-aware return rule; on `aborted`, return to this menu without handing off. On persistent Proof failure, apply the §6.5 Proof Failure Ladder before ending so the brainstorm seed is preserved through a local-save fallback.
- **Save and end** — share the survivors to Proof (the elsewhere-mode default) and end. Use `docs/ideation/` instead only when the user explicitly asks for a local file. On Proof failure (including after the single orchestrator-side retry), apply the §6.5 Proof Failure Ladder from `references/post-ideation-workflow.md` — surface the local-save fallback menu (custom path or skip) before ending so the user is not stranded without a recovery path.

No-save exit is supported without a dedicated menu option. Pick Refine and stop the conversation, or use the question tool's free-text escape to say so directly — persistence is opt-in and the terminal review loop is already a complete ideation cycle.
