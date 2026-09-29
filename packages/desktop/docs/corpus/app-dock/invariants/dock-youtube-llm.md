# Invariant: `dock-youtube-llm` - Dock YouTube LLM Drive

> Clauses: 3 | Unwanted: 2 | Witnesses: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)

## Clauses
- dock session drives dock_open, dock_read and dock_click against YouTube results via live model call *(measured: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model))*
- live model turn produces final text answering with a video title *(measured: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model))*
- dock_* tools are visible in the session tool list for the live model *(measured: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model))*

## Unwanted
- dock session completes without invoking any dock_* tool *(measured: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model))*
- session tool list omits dock_* tools for the live model *(measured: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model))*

