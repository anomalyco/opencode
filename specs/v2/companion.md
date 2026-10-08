# V2 Companion

Status: **Experimental.** The TUI gates the feature behind the `companion` experiment. Protocol routes live under `/api/experimental/`.

A companion is a persistent side conversation about one session, called the main session. The user talks to the companion in text or by voice. The companion reads what the main session is doing and can steer it. `/btw` stays a one-shot, tool-less question; a companion is a full session.

## Companion Sessions

A companion is a child session of the main session with `kind: "companion"`. The kind is an irreducible fact recorded on `session.created`; it cannot change later. The companion runs through the normal Session runner, so history, tools, compaction, interruption, and persistence behave as they do for every other session.

Each main session has at most one companion. `Session.companion(sessionID)` returns the existing companion or creates one. It creates the companion with:

- the built-in hidden `companion` agent,
- the `companion` agent's configured model, or the main session's model when none is configured,
- no inherited session permissions, so main-session approvals do not widen what the companion may do.

The model is chosen once, when the companion is created. To give companions a faster model than the main session, configure the agent like any other:

```json
{
  "agents": {
    "companion": { "model": "google/gemini-3.8-flash" }
  }
}
```

Rules that depend on the kind:

- The `subagent` tool refuses to continue a companion session.
- Clients do not treat companions as subagents. They leave them out of subagent pickers, subagent counts, and completion notifications.
- Removing the main session removes its companion like any other child.

## Agent and Tools

The `companion` agent is `primary` and `hidden`. It denies every action, then allows read-only file access (`read`, `grep`, `glob`), web lookups, read-only git commands, and the `main_*` tools. The companion does not edit files or run other shell commands; that would make two agents write to one worktree.

The companion may run these shell commands:

- `git status`, `git diff`, `git log`, and `git show`, with any arguments;
- `git branch` alone, or with exactly one of `--show-current`, `-a`, `-r`, `-v`, or `-vv`. Other forms are denied because `git branch <name>` creates a branch, even after `-v`.

Git commands that contain `>` or `--output` are denied, because both write files.

Configured permission rules apply after the companion's own rules, so they can allow more within the capped actions, for example an external directory or `.env` reads. Rules such as `git *` or `edit` have no effect, because two hooks cap the companion regardless of configuration:

- A tool hook runs a companion shell command only when it is exactly one of the git commands above and contains no `;`, `&`, `|`, `<`, `>`, `$`, backtick, newline, or `--output`. This also covers redirects after `&&` or `||`, which the shell parser leaves out of permission resources.
- A permission hook denies every action except `read`, `grep`, `glob`, `webfetch`, `websearch`, `shell`, `external_directory`, and the `main_*` tools. It also turns every `ask` result into `deny`: the companion never asks for permission, because clients do not show permission prompts for companions.

The `main_*` tools act only on the calling companion's parent. They never accept a session ID from the model, and they fail when the caller is not a companion. Other agents do not see them.

| Tool             | Effect                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main_status`    | Report whether the main session is running, its pending inbox items, and its pending permission requests.                                                                           |
| `main_read`      | Return recent main-session messages as compact text, including the in-flight step.                                                                                                  |
| `main_send`      | Admit a prompt into the main session. `steer` delivers at the next safe boundary; `queue` waits until the main session is idle. The prompt carries `metadata.source = "companion"`. |
| `main_cancel`    | Cancel a pending main-session inbox item.                                                                                                                                           |
| `main_interrupt` | Interrupt the main session, optionally resuming pending steers.                                                                                                                     |

Steers are sent without confirmation. They appear in the main timeline like any prompt, so the user can see what the companion sent. The TUI marks user messages whose `metadata.source` is `"companion"` with a muted `via companion` label, so they do not look like the user typed them.

Before each companion request whose tail is a user message, a context hook inserts a short, unpersisted digest of the main session before the newest prompt: the `main_status` report and the six most recent main-session messages in `main_read` form. Most questions then need no tool call, which keeps voice replies fast.

## Voice

Voice is two stateless server operations backed by `@opencode/ai` speech and transcription models. The server owns provider credentials; clients own capture, playback, and turn-taking.

| Operation  | Contract                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transcribe | The client uploads one recorded utterance as the binary request body with its media type. The server returns the transcript text.                                       |
| Speak      | The client sends text. The server streams server-sent events: one `format` event that describes the audio encoding, then base64 `audio` chunks, then `done` or `error`. |

The `voice` configuration comes from the base (global) configuration, like one-shot generation. It names the models as `provider/model`, because the model catalog has no speech or transcription entries:

```json
{
  "voice": {
    "transcription": { "model": "xai/grok-voice-transcribe-2.0" },
    "speech": { "model": "google/gemini-3.8-flash-lite-tts", "voice": "Kore" }
  }
}
```

The server resolves the provider's stored API key the same way it does for language models, then builds the provider package's media model directly. Custom providers work when their `package` is a supported provider package. OAuth logins are ignored because they target chat backends; those providers fall back to their API-key environment variable. Supported packages are OpenAI, Google, xAI, ElevenLabs, and Deepgram for speech, and OpenAI, Google, xAI, Deepgram, and AssemblyAI for transcription. Speech requests MP3, except Gemini, which only returns 24 kHz PCM.

## TUI

The TUI builtin companion plugin opens the companion in the `session.panel` slot for the current session with `/companion` or `session.companion`. The panel shows the companion transcript and a text input. The plugin keeps voice state, audio playback, and the main-to-companion mapping outside the panel component, so speech continues when the panel closes.

The voice loop is a cascade:

1. The talk key (`companion.talk`) starts microphone capture. Pressing it again stops capture.
2. The client downsamples the capture to 16 kHz mono PCM, wraps it as WAV, and transcribes it.
3. The transcript is sent to the companion as a prompt.
4. As companion text streams in, the client splits it into sentences outside code blocks and speaks them in order.
5. Pressing talk while the companion is thinking or speaking stops playback, interrupts the companion, and starts listening again.

The stop key (`companion.stop`) stops playback, capture, and the companion's reply. Stopping, or sending a typed message, also discards an utterance that is still being transcribed.

By default the microphone is closed while the companion speaks, so speaker output does not feed back into the transcript.

### Barge-in

The `companion_barge_in` experiment keeps the microphone open while the companion speaks, and for a short grace period after each clip, so the user can talk over a reply. There is no echo cancellation. Instead:

1. For each microphone chunk, the client reads the last third of a second of mixed playback from the OpenTUI tap. The loudest block of that window is the playback level.
2. A chunk counts as speech when it is louder than both a noise floor and the playback level times a learned echo coupling, with a margin. The coupling follows the echo the microphone hears between words.
3. After 150 ms of speech, the client stops playback at once and holds back the unfinished sentences and any that stream in later. It records the utterance, including the 400 ms before the onset, until 700 ms without speech. Pressing talk ends the utterance early.
4. The client transcribes the utterance. When most of its words repeat the two clips spoken last, the utterance is echo: the coupling rises, and the reply resumes from the start of the interrupted sentence. An empty transcript also resumes the reply.
5. Otherwise the client drops the held sentences, interrupts the companion, waits for the interrupt, and then sends the transcript as the next voice prompt. A prompt sent before the interrupt would wait in the stopped reply's inbox.

This works well with headphones and reasonably with laptop speakers. Loud speakers can still cause false interruptions until there is real echo cancellation.
