# Changes in this fork

This fork extends OpenCode's desktop and web interface. Upstream installation commands and release downloads do not include these source changes. To run them locally, follow the [development setup](VOICE_INPUT.md#development-setup).

## Voice input and model management

The chat composer can record audio, show input volume and elapsed time, play recordings, and submit a transcript with the existing draft. Failed transcription keeps the recording available for retry. Cancelling capture or navigating away prevents late results from being inserted.

Settings includes Chat and Voice model lists, a shared Ollama manager, and transcription-provider configuration. The Ollama manager supports downloads, cancellation, display names, aliases, context settings, registration, and deletion with confirmation. Context changes affect the selected Ollama tag and can also affect other applications using it.

Voice routes include a managed MLX worker on macOS ARM64, Qwen3-ASR through a compatible Ollama server, and compatible transcription APIs. The [voice guide](VOICE_INPUT.md) describes setup, credential handling, language support, and the limits of each route.

## Project and session navigation

A collapsible sidebar lists projects and their sessions alongside the current chat. The titlebar button and `Mod+B` toggle the sidebar without navigating away. Projects retain their existing menus and new-session actions. The sidebar includes Settings and Help, and working sessions use the shared loading indicator.

## Reasoning and panel behavior

Reasoning is enabled by default for settings that do not already contain a saved preference. Reasoning content opens while it streams and collapses when an answer or tool execution starts; it can still be expanded manually. Labels show elapsed reasoning time, while the response footer identifies total duration separately.

Session-panel sizing applies split-diff constraints only while the Review tab is active. The resize handle is hidden when there is no available resize range. The composer footer adapts its controls to the available width and the recording state.

## Shared UI and desktop development

Shared controls use Tabler icons and a common loading indicator. The Tabler MIT license is included in [packages/ui/TABLER-LICENSE](packages/ui/TABLER-LICENSE). The desktop predev script invokes Electron's installation script directly.

## Validation

Run `bun typecheck` from each affected package: `packages/app`, `packages/desktop`, `packages/session-ui`, and `packages/ui`. Run `bun run typecheck:e2e` from `packages/app` for the browser tests. The [voice guide](VOICE_INPUT.md#automated-checks) lists focused unit and integration commands.

From `packages/app`, run the browser coverage for these changes:

```sh
bun run test:e2e \
  e2e/project-sidebar.spec.ts \
  e2e/voice-input.spec.ts \
  e2e/voice-recovery.spec.ts \
  e2e/regression/ollama-model-settings.spec.ts \
  e2e/regression/voice-settings-organisation.spec.ts \
  e2e/regression/session-composer-resize.spec.ts \
  e2e/regression/session-timeline-reasoning-projection.spec.ts \
  --workers=1
```

These browser tests use controlled server responses and synthetic microphone input. Actual transcription quality, native microphone permission prompts, managed-model installation, and packaged behavior require checks on the target device. No cross-platform certification or performance improvement is claimed by this overview.
