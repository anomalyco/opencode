# Voice input and model management in pusi

pusi adds voice input to the chat composer and model management for Ollama and transcription providers. See [the project overview](FORK.md) for the other desktop and UI changes.

## Development setup

Use the Bun version declared in the root `package.json` (currently 1.3.14) and install Node.js for the Electron installation script. From the repository root:

```sh
bun install
bun run dev:desktop
```

The development app is named pusi Dev. Main-process and preload changes require reopening the development app. See [CONTRIBUTING.md](CONTRIBUTING.md) for the web app and backend development commands.

Ollama and external transcription services must be installed or configured separately. The managed MLX option requires macOS on Apple Silicon and Python 3.10–3.13. Set `OPENCODE_VOICE_PYTHON` to a supported Python executable if it is not discoverable automatically.

## Settings → Models

The Chat and Voice tabs share an Ollama model manager. Existing Ollama model rows have a Manage button. The manager discovers configured Ollama connections and supports additional HTTP(S) Ollama servers.

The manager supports installed-model search, disk size and quantization, model downloads with progress and cancellation, display names, new model tags, saved context settings, Chat or Voice registration, and default-model selection. Model deletion requires an inline confirmation because it removes that tag from the Ollama server and affects other applications using it.

Display names are saved in OpenCode's provider configuration for Chat and the voice configuration for Voice. A different Ollama tag creates a copy/alias and keeps the original. Changing context updates `num_ctx` on the selected Ollama tag without generating a new name. This is a server-side model setting shared by other apps using that tag. Explicitly entering a different tag still creates a separate alias/model; another existing destination tag cannot be overwritten. Chat registration also saves context and output limits in OpenCode and refreshes the provider catalog.

For a newly registered Chat model, select an explicit context size. The manager cannot determine an unspecified Ollama server default without running the model. For an existing Chat model, leaving runtime context unchanged preserves its existing OpenCode context metadata. Changes to the configured default apply to new selections; existing chats can retain their chosen model.

## Qwen3-ASR through Ollama

1. Open Settings → Models → Voice, then Manage Ollama models.
2. Select the desired Ollama connection. The default local address is `http://127.0.0.1:11434`.
3. Click the Qwen3-ASR 0.6B shortcut to fill `frozenlab/qwen3-asr:0.6b`, then Download model.
4. In the downloaded model's editor, set a display name and choose Voice. Changing context updates the selected tag in place.
5. Choose an audio chunk length of 15, 30, or 60 seconds; the default is 30 seconds. Save, then Set as default.
6. Use Test recording in the Voice tab, or use the microphone in the chat composer.

The shortcut points to the community-maintained [frozenlab/qwen3-asr model](https://ollama.com/frozenlab/qwen3-asr). Use an Ollama runtime that supports the model’s audio projector, and check transcription with Test recording before using it in a chat. An installed tag or successful connection check does not establish audio compatibility or recognition accuracy.

Audio is normalized to 16 kHz mono PCM WAV and split into the configured chunks. Both test recordings and chat voice input use the recognition language in General. Automatic detection sends each chunk through `/api/chat` with an empty prompt and extracts text after `<asr_text>`. A selected language uses `/api/generate` with `raw: true`, audio in `images`, and Qwen’s `language {Language}<asr_text>` assistant prefix. Raw generation preserves this prefix even with legacy Ollama templates. The returned text can be plain transcription or include the ASR marker. It does not use the OpenAI-compatible `/audio/transcriptions` endpoint.

## Other voice providers

Settings → Providers has one Connected providers list for Chat and speech services. Choose Connect provider → OpenAI-compatible transcription API to add a speech service, then enter the provider ID, display name, base URL, model IDs, and optional API key. The form also supports Ollama. OpenAI-compatible services use a root such as `https://example.com/v1`; Ollama uses its native root such as `http://127.0.0.1:11434`. An Ollama connection registered for both Chat and Voice appears once when its provider ID and endpoint match.

Select the default speech model and manage model installations in Settings → Models → Voice. Recognition language is in Settings → General → Voice, including automatic detection and the languages supported by the Ollama Qwen3-ASR adapter.

Desktop API keys are stored using Electron's system-backed encryption and stay out of renderer persistence. Saved Ollama voice credentials are reused by the desktop model manager only for the same configured endpoint. Browser keys are held in memory until the page is closed. Other model/provider settings are persisted.

Connection checks verify endpoint reachability, not transcription accuracy. Test recording sends audio to the chosen provider and shows its result in Settings without submitting a chat message.

The separate local MLX option for `mlx-community/Qwen3-ASR-0.6B-8bit` is in Settings → Models → Voice on Apple Silicon. Its Download action installs a private Python environment and pinned model files; it requires Python 3.10–3.13. That installation is independent of Ollama model storage.

## Composer behavior

The composer supports microphone capture, a waveform based on measured input amplitude, elapsed time, stop, playback, and cancellation. The original send arrow remains to the right of stop. Clicking the arrow during recording finishes capture, transcribes with the selected Voice model, appends the result to the existing draft, and submits through the existing chat path. A transcription failure preserves the recording for another attempt.

X, Escape, and session navigation cancel capture or pending transcription. A late response from a cancelled request is not inserted into the composer.

## Manual checks

Run these checks with the actual microphone and provider you intend to use. Automated tests exercise synthetic audio and controlled endpoints; they do not certify microphone hardware, recognition accuracy, or packaged-app behavior on each operating system.

- Download a model, cancel mid-download, and retry.
- Change only its display name and check the corresponding model selector.
- Create a new tag and confirm the original is still listed.
- Change context to a supported size and confirm that the selected tag keeps its name and uses the new setting.
- Save a Qwen3-ASR model as Voice, set it as default, and transcribe a recording in Settings.
- Record from the composer, click the arrow while recording, and check that the transcription is submitted with the draft.
- Cancel during transcription and confirm no late text is inserted.
- Delete an unused tag and check that the original and other models remain available.

## Localization review

New controls use the shared typed i18n API with English and Korean dictionaries. Other app languages use English fallback. Product names, model IDs, API paths, and acronyms remain unchanged.

Review translations in their actual settings and recording flows, particularly the model-tag, audio-projector, and endpoint-language descriptions.

## Voice adapter compatibility

Voice settings resolve an adapter contract before rendering language controls or sending audio. Existing configurations without an `adapter` field keep their original behavior: `protocol: "ollama"` resolves to `ollama-qwen`, and omitted/openai protocols resolve to `transcription-api`.

| Adapter             | Execution                                                                | Language control                                                      | Installation                                                                            |
| ------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `mlx-qwen`          | Managed desktop worker, macOS ARM64                                      | Auto, Korean, English supported by the current worker                 | App-managed model and Python virtual environment; requires an existing supported Python |
| `ollama-qwen`       | User-configured HTTP(S) server, independent of client OS                 | Automatic detection or selection from Qwen3-ASR’s supported languages | Existing Ollama manager                                                                 |
| `transcription-api` | User-configured HTTP(S) transcription endpoint, independent of client OS | Unknown by default; optional model-specific language list             | Managed outside the app                                                                 |

Client OS does not determine remote inference compatibility. Browser use also depends on microphone permissions, secure context, CORS and endpoint reachability. This table describes implementation routing, not real-device certification on Windows/Linux or a guarantee that every Ollama model or chat-compatible endpoint supports audio.

Providers can declare `location: "device" | "remote" | "cloud"` in their editor. Omitted location is displayed as not specified; hostname and provider name are not used to guess where audio is processed. Changing this label does not change routing or enable failover.

For compatible transcription APIs, the model's Manage form can declare language support. Omitted `languages` means unknown, `[]` means automatic only, and a nonempty array lists accepted language codes. Unknown endpoints accept a language-code hint, with an empty setting meaning automatic detection. These are configured capabilities, not automatically verified claims. Test connection checks endpoint access; Test recording checks an actual transcription. A stored language preference remains intact when temporarily selecting an automatic-only model, but unsupported hints are omitted from requests.

The shared adapter registry owns language policy, request size and timeout policy, and whether the runtime is app-managed. The current 25 MiB request ceiling is an app limit, not a discovered provider limit. Transport adapters keep multipart transcription and Qwen audio-chat parsing separate. There is no automatic fallback to another provider.

Additional native runtimes (including a cross-platform packaged engine), provider-specific authentication/streaming adapters, runtime version negotiation and automatic capability discovery remain future work. Add an explicit adapter and its contract tests before advertising support for a new route.

## Automated checks

Run each command from the indicated package directory. The desktop integration tests open temporary loopback HTTP servers. Browser tests use a synthetic microphone and controlled provider responses; they do not download or run a speech model.

```sh
# From packages/app
bun typecheck
bun run typecheck:e2e
bun test --conditions=solid --preload ./happydom.ts ./src/voice/types.test.ts ./src/i18n/voice.test.ts
bun run test:e2e e2e/voice-input.spec.ts e2e/voice-recovery.spec.ts e2e/regression/voice-settings-organisation.spec.ts e2e/regression/ollama-model-settings.spec.ts --workers=1

# From packages/desktop
bun typecheck
bun test ./src/main/media-permissions.test.ts ./src/main/voice-service.test.ts ./src/main/ollama-transport.test.ts
```

Install Playwright’s Chromium browser if it is not already available (`bunx playwright install chromium` from `packages/app`). Use `PLAYWRIGHT_PORT` to select a separate test-server port when needed. Run `bun typecheck` from `packages/ui` and `packages/session-ui` to check the shared components as well.

OS/architecture policy tests do not substitute for packaged-app tests on the corresponding devices.
