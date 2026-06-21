# PRD: Hands-Free Voice Conversations for opencode (Web)

**Status:** Draft
**Last updated:** 2026-06-21
**Surface (v1):** hosted opencode web app (`@opencode-ai/app`)
**Architecture:** [`voice-architecture.md`](./voice-architecture.md) · [`voice-roadmap.md`](./voice-roadmap.md)

**v1 launch:** users on the **hosted web app** speak in the browser; cloud **STT and TTS**
run in a **Python voice sidecar**; the sidecar drives the **hosted opencode server**.
LiveKit is a later media upgrade — not required for first launch.

---

## 1. Summary

Let people have a **two-way voice conversation** with opencode. A user speaks a
command out loud, opencode hears it, acts on it, and **speaks back** a concise,
useful response — all **without the user pressing a single key**. The user keeps
talking, opencode keeps responding. It feels like talking to a capable pair-programmer,
not operating a tool.

This PRD describes the experience and the user flows — both **voice in** (commands)
and **voice out** (how opencode talks back, especially when answers get long). It
intentionally leaves out implementation details.

---

## 2. Background & Motivation

Today opencode is driven entirely by typing, and it only answers in text. That's
great when your hands and eyes are on the screen, but it breaks down when:

- You're thinking out loud and want a natural back-and-forth.
- Your hands are busy (whiteboarding, reading docs, accessibility needs).
- You want to stay in flow without reading walls of output.

Voice removes the keyboard *and* the screen as the only ways to interact. The north
star is **zero-keypress, eyes-optional operation**: open opencode, start talking,
listen to what it says, keep going.

---

## 5. Key Decisions (settled)

- **Activation** — **Continuous listening** (auto-detect speech). Seamless; no keys, no trigger phrase.
- **Sending** — **Auto-submit** when the user stops speaking. Fully hands-free.
- **Listening start** — **Mic toggle, off by default**. Privacy-first opt-in.
- **Speech-to-text** — **Cloud transcription**. Best accuracy, least setup for v1.
- **Talk-back default** — **Spoken summary** (not verbatim). Hands-free, eyes-optional, no walls of audio.
- **Long answers** — **Summarize, then offer to continue**. User chooses when to hear detail.
- **Code / lists** — **Describe, don't read**. Code aloud is tedious and error-prone.
- **Interruption** — **Mid-turn intent decider** when a turn is in progress (**Working** or
  **Speaking**). Speech is classified — not blindly ignored or sent as a new command.
- **Composer UI** — **Mic and status live inside the prompt text area**, woven into the typing flow (not a separate toolbar control).

---

## 6. User Experience

### 6.1 Entering voice mode
- The **mic control and voice status** live **inside the prompt text area** — the same
  surface where the user types — not in the composer toolbar.
- When voice is **off**, a subtle mic affordance sits in that area (e.g. trailing
  inside the input or as part of the empty placeholder). Listening is **off by default.**
- The user clicks the mic once (and grants browser mic permission the first time).
  On first enable, a **brief inline note** in the text area explains that audio is
  transcribed and responses are spoken in the cloud; it dismisses once acknowledged
  or when voice is turned off.
- Once on, the text area becomes the **voice surface**: the status line and mic toggle
  stay visible there through every state. Typing still works — voice and keyboard
  share the same input without fighting for focus.
- From then on, **no clicks or keys are needed** — opencode listens and speaks
  continuously until the user turns it off from the in-area mic control.

### 6.2 Mid-turn speech (the decider)

While opencode is **Working** or **Speaking** on an ongoing turn, the user may still
talk. opencode **classifies** what they mean before acting — there is no single
"barge-in = new command" rule.

- **Stop** — *"Stop."* / *"Stop it."* / *"Cancel."* / *"That's enough."* (while being read to). Stops the current turn — playback, in-flight work, or both as appropriate. Returns to **Listening.**
- **Status** — *"What's going on?"* / *"Where are you?"* / *"What are you doing?"* Speaks a brief progress update since the last spoken response. The turn **continues** afterward.
- **Redirect** — *"Actually, run the tests instead."* / *"Never mind — delete the temp folder."* Stops the current turn and treats the utterance as a **new command.**
- **Reply** — *"Yes."* / *"Squash them."* / *"Approve."* Answers a question or permission opencode already asked; not a new task.

Classification is **intent-based**, not phrase-matching — the examples above are
illustrative. When intent is unclear, opencode asks a short clarifying question by
voice rather than guessing.

During **Working**, status checks must still work — speech is not dropped entirely.
During **Speaking**, playback pauses or stops as needed so the user can be heard and
answered, then the turn resumes or ends according to the classified intent.

### 6.3 Leaving voice mode
- Clicking the in-area mic **turns listening off immediately**; any in-progress speech
  stops. The text area returns to its normal typing appearance; the indicator clearly
  shows **Off**.

---

## 7. Voice Output (Talk-Back)

opencode's spoken reply is a **purpose-built summary**, not a read-aloud of the
on-screen text. The user can ask anything, phrased however they like, and opencode
answers in natural speech and interprets intent. This section describes what a *good*
spoken reply sounds like — as principles and examples, **not a fixed script or
command set**.

### 7.1 Principles for a good spoken reply

These guide opencode's judgment; they are not a formula to execute step by step.

- **Lead with what matters most to the user right now.** If opencode needs something
  from the user (a decision, a permission, an answer to a question it's asking back),
  say that first. If the user asked a question, lead with the answer. If something
  failed, say what failed and why.
- **Report outcomes, not transcripts.** Summarize what happened in plain language and
  counts ("created two files, tests pass") rather than narrating every step.
- **Short by default, depth on request.** Say the gist, then offer to go deeper —
  rather than reading everything.
- **Describe, don't dictate.** Code, commands, file contents, paths, long lists, and
  logs are *described or counted* and left on screen — never spelled out aloud.
- **Be honest.** Surface failures, caveats, and "I couldn't do X" plainly.

> The voice tells you *what happened and what's needed from you*; the screen holds
> *the exact details*.

### 7.2 Long answers

When a result is long, opencode speaks the gist plus anything needing the user's
attention, then offers to continue — elaborating only if the user wants more, and
reading detail in chunks that can be stopped at any time. The user signals all of this
in their own words; opencode interprets intent, with no special command phrases.

### 7.3 Talk-back examples

- **UC-1** — User: *"What does this function do?"* → Speaks a 1–2 sentence plain answer. *(Direct Q&A — the answer is the value.)*
- **UC-2** — User: *"Add a dark-mode toggle."* → *"Done. Added a toggle and wired it into settings — three files changed, shown on screen. Want the details?"* *(Outcome + counts; defers diff to screen; offers more.)*
- **UC-3** — User: *"Run the tests."* → *"Tests failed — 2 of 40, both in the auth module. Want me to read the errors, or try a fix?"* *(Failure first; offers next action by voice.)*
- **UC-4** — User: *"Explain how auth works here."* → Speaks a 2-sentence overview, then: *"That's the gist — want the full walkthrough?"* *(Long explanation → gist + offer to continue.)*
- **UC-5** — User: *"List all the API routes."* → *"There are 23 routes across 4 groups — they're on screen. Want me to read them?"* *(Long list → count + grouping, not read aloud.)*
- **UC-6** — User: *"Show me the contents of config.ts."* → *"It's a 60-line config, now on screen. Want a summary of what it sets?"* *(File contents are never read; described instead.)*
- **UC-7** — User: *"Refactor and commit."* (opencode needs a choice) → *"Before I commit — squash into one commit, or keep them separate?"* *(Blocker/decision spoken first; waits for the user.)*
- **UC-8** — A tool needs permission → *"I need permission to run `git push`. Approve?"* *(Permission request spoken; yes/no by voice.)*
- **UC-9** — User: *"Delete the temp folder."* (trivial success) → *"Done."* *(Nothing notable to report → minimal confirmation.)*
- **UC-10** — Something went wrong mid-task (error/abort) → *"I hit an error connecting to the server and stopped. Want me to retry?"* *(Honest failure + recovery offer.)*
- **UC-11** — User, mid-turn: *"Stop it."* → Stops immediately; short confirmation (*"Stopped."*). *(Stop intent — cancel, don't start something new.)*
- **UC-12** — User, while opencode is **Working**: *"What's going on?"* → *"Still on the README — drafted setup and usage, working on the scripts section now."* *(Status intent — progress since last response; turn continues.)*

> These rows are **examples to illustrate the principles** above — not a fixed
> mapping of phrases to responses. The user can say the same thing many ways, and
> opencode responds in kind.

---

## 8. Detailed User Flows

### Flow A — First-time setup
1. User opens the web app; the text area shows its normal placeholder and a subtle
   in-area mic affordance (voice off).
2. User clicks the mic in the text area → browser asks for mic permission → user allows.
3. A brief inline cloud note appears in the text area; user dismisses or continues.
4. The in-area indicator switches to **Listening**. Hands-free from here.

> If permission is denied, opencode explains voice needs mic access and stays in
> typing/text mode. No dead ends.

### Flow B — Command → spoken summary
1. State: **Listening.** User: *"Create a README for this project."*
2. **Hearing you** → **Transcribing** → text fills the prompt and sends.
3. **Working** → opencode generates the README. (User may ask *"What's going on?"* here —
   see Flow E — without starting a new command.)
4. **Speaking:** "Done — created a README with sections for setup, usage, and scripts.
   It's on screen. Want me to read it?"
5. Returns to **Listening.**

### Flow C — Long answer with "offer to continue"
1. User: *"Explain the data flow in this app."*
2. opencode **Speaking:** a 2-sentence overview, then "…want the full walkthrough?"
3. User: *"Yes."* → opencode reads the detail in chunks, pausing between parts.
4. User (mid-read): *"That's enough."* → **Stop** intent — speaking stops, turn ends,
   back to **Listening.**

### Flow D — Redirect mid-turn
1. opencode is **Speaking** or **Working** on one task.
2. User: *"Actually, just run the tests."*
3. Current turn **stops**; the utterance is classified as a **Redirect** and becomes
   the next command.

### Flow E — Stop vs. status during an ongoing turn
1. opencode is **Working** on a long task (or **Speaking** a long summary).
2. User: *"Stop it."* → **Stop** intent — turn cancels; opencode confirms briefly;
   returns to **Listening.**
3. Same situation, user: *"What's going on?"* → **Status** intent — opencode speaks
   progress since the last spoken response (e.g. files touched, step it's on, whether
   it's waiting on a tool); the turn **continues** when the update is done.
4. Same situation, user: *"Actually, run the tests instead."* → **Redirect** — see
   Flow D.

### Flow F — Don't send mid-turn speech as a blind new command
- While a turn is **Working** or **Speaking**, captured speech goes through the
  **mid-turn decider** (§6.2) — it is not auto-submitted as a fresh prompt unless
  classified as **Redirect** (or **Reply** when opencode asked something).
- Ambiguous utterances get a short spoken clarification (*"Stop this, or keep going?"*)
  rather than the wrong action.

### Flow G — Nothing meaningful was said
- Empty, too-short, or unintelligible turns send **nothing**; opencode quietly returns
  to **Listening**, with a subtle "didn't catch that" cue so the user isn't left guessing.

### Flow H — Decision / permission requested by voice
1. opencode needs input: **Speaking** "…squash or keep separate?" / "Approve `git push`?"
2. User answers by voice (**Reply** intent); opencode proceeds. (Falls back to on-screen controls too.)

### Flow I — Turning it off
1. User clicks the in-area mic. Capture and any speech **stop immediately.**
2. The text area returns to normal typing mode. Indicator: **Off.** opencode behaves
   exactly as it does today.

---

## 10. Edge Cases (user-facing behavior)

- **Mic permission denied** — Friendly explanation; stays in text mode.
- **No mic / mic unplugged** — Voice control disabled with a clear reason.
- **Background noise / silence** — Treated as "nothing said"; nothing sent.
- **Very long monologue** — Captured as one command when the user pauses.
- **Transcription failure** — Clear, non-blocking error; retry or type.
- **Speech-synthesis failure** — Falls back to on-screen text; tells the user it couldn't speak.
- **Response is *only* code/commands** — Spoken as a short description ("added a 12-line function, on screen").
- **User types while listening** — Typing always works; voice and keyboard coexist.
- **Mid-turn speech** — Routed through the decider (§6.2): stop, status, redirect, or reply — not auto-submitted as a new command.
- **Barge-in during speech** — Playback stops so the user can be heard; action follows classified intent (stop, status, redirect, or reply).
- **Tab loses focus / backgrounded** — Listening and speaking pause (behavior TBD with design).

---

## 12. Open Questions

1. **Backgrounded tab** — pause vs. keep going.
2. **Preference persistence** — voice on/off remembered across sessions or per-session?
3. **Language/locale** — English-only v1, or expose a language choice (affects both
   transcription and the spoken voice)?
4. **Mid-turn classification accuracy** — how to reliably separate stop, status, redirect,
   and reply without false stops or accidental cancels (especially vs. background chatter).