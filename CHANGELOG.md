# Changelog

Release notes for OpenCode V2, newest first.

## v2.2.0 — 2026-10-27

### Highlights

- Create, install and share [Desktop plugins](https://opencode.ai/v2/docs/build/plugins/gui) (experimental) ([#55246](https://github.com/anomalyco/opencode/pull/55246), [#59469](https://github.com/anomalyco/opencode/pull/59469), [#59489](https://github.com/anomalyco/opencode/pull/59489))
- Refreshed the desktop app experience ([#56898](https://github.com/anomalyco/opencode/pull/56898), [#58865](https://github.com/anomalyco/opencode/pull/58865), [#55838](https://github.com/anomalyco/opencode/pull/55838), [#57962](https://github.com/anomalyco/opencode/pull/57962))
- Add experimental image and decision generation APIs to plugins and sdk, allowing image generation or decision model (think typesafe, clef, etc) workflows. ([#59190](https://github.com/anomalyco/opencode/pull/59190), [#59380](https://github.com/anomalyco/opencode/pull/59380), [#58758](https://github.com/anomalyco/opencode/pull/58758))
- Plugins can now attach and update keyed session instructions with ctx.session.instructions.entry.put/list/remove. Instead of editing the system prompt and busting the prompt cache, each change is added as a small update at the next step. The entries also survive compaction and reverts, and they don't start an extra model turn. ([#56550](https://github.com/anomalyco/opencode/pull/56550))
- Restored the Todo tool in desktop via opt-in ([#59092](https://github.com/anomalyco/opencode/pull/59092))
- Add configurable prompt cache TTLs per provider/model ([#59157](https://github.com/anomalyco/opencode/pull/59157))

### Breaking changes

#### `@opencode/ai` root is now the Promise API

`@opencode/ai` now works like `@opencode/sdk` and `@opencode/client`: the package root exports the Promise API, and the Effect API moved to `@opencode/ai/effect`. `@opencode/ai/promise` is removed, and the wildcard subpath export is replaced with an explicit list of provider and protocol entry points. ([#58847](https://github.com/anomalyco/opencode/pull/58847), [#59183](https://github.com/anomalyco/opencode/pull/59183))

```diff
-import { AI } from "@opencode/ai/promise"
-import { LLM } from "@opencode/ai"
+import { AI } from "@opencode/ai"
+import { LLM } from "@opencode/ai/effect"
```

#### The OpenCode GitHub Action is removed

The OpenCode GitHub Action is no longer published. Remove it from your workflows. ([#59032](https://github.com/anomalyco/opencode/pull/59032))

#### TUI plugins require OpenTUI 0.7

`@opencode/plugin` now requires `@opentui/core` and `@opentui/solid` 0.7.0, up from 0.6.8 or later. Plugins that depend on OpenTUI 0.6 fail to install until they upgrade. In OpenTUI 0.7, custom renderables read their hooks from their class at construction: assign `renderBefore`, `renderAfter`, and `onLifecyclePass` in the constructor instead of as class fields, call `refreshHooks()` after adding a hook by reflection, and replace `defineNativeIntegration()` with a `static nativeIntegration` declaration. See the [OpenTUI 0.7.0 release notes](https://opentui.com/docs/releases/0.7.0). ([#59295](https://github.com/anomalyco/opencode/pull/59295))

### Core

#### Improvements

- Add experimental image and decision generation API endpoints. ([#59190](https://github.com/anomalyco/opencode/pull/59190))
- Add image and decision entrypoints for catalog providers. ([#59380](https://github.com/anomalyco/opencode/pull/59380))
- Improve integration rebuild performance. ([#59402](https://github.com/anomalyco/opencode/pull/59402))
- Let custom model configuration set a model type. ([#59388](https://github.com/anomalyco/opencode/pull/59388))
- Let model-list API requests filter by type. ([#59355](https://github.com/anomalyco/opencode/pull/59355))
- Make external-directory permission checks use the project's filesystem. ([#59089](https://github.com/anomalyco/opencode/pull/59089))
- Reduce memory use when code search finds very large lines. ([#59205](https://github.com/anomalyco/opencode/pull/59205))
- Let plugins filter event subscriptions by type. ([#58864](https://github.com/anomalyco/opencode/pull/58864))
- Add configurable prompt-cache TTLs. ([#59157](https://github.com/anomalyco/opencode/pull/59157))
- Move image resizing off the main process and release idle image memory. ([#58820](https://github.com/anomalyco/opencode/pull/58820))
- Reduce repeated session-history loading during a step. ([#59091](https://github.com/anomalyco/opencode/pull/59091))
- Add an experimental API for session media and opt-in media URI support. ([#59103](https://github.com/anomalyco/opencode/pull/59103))
- Add the machine hostname to `/api/info`. ([#59090](https://github.com/anomalyco/opencode/pull/59090))
- Add experimental content-addressed blob storage for session media behind `experimental.media_blob`. ([#58656](https://github.com/anomalyco/opencode/pull/58656), [#58741](https://github.com/anomalyco/opencode/pull/58741))
- Start session history from the latest completed compaction. ([#59020](https://github.com/anomalyco/opencode/pull/59020))
- Reduce work encoding durable event payloads that are not persisted. ([#58923](https://github.com/anomalyco/opencode/pull/58923))
- Expose MCP server titles from `serverInfo`. ([#58950](https://github.com/anomalyco/opencode/pull/58950))
- Apply OpenCode Console workspace configuration as a configuration layer. ([#57703](https://github.com/anomalyco/opencode/pull/57703))
- Replace experimental evaluations with Decision APIs in the AI pkg, including OpenAI Decisions, System One, and Cloudflare Run models. ([#58758](https://github.com/anomalyco/opencode/pull/58758), [#58382](https://github.com/anomalyco/opencode/pull/58382), [#58379](https://github.com/anomalyco/opencode/pull/58379), [#58381](https://github.com/anomalyco/opencode/pull/58381))
- Convert tool schemas once to speed up tool execution. ([#58798](https://github.com/anomalyco/opencode/pull/58798), [#58848](https://github.com/anomalyco/opencode/pull/58848))
- Make Git project discovery faster while recognizing repository changes. ([#58616](https://github.com/anomalyco/opencode/pull/58616))
- Show OpenCode Console budget limits and Go usage where they block you. ([#58694](https://github.com/anomalyco/opencode/pull/58694), [#58714](https://github.com/anomalyco/opencode/pull/58714))
- Record provider-reported session costs. ([#58562](https://github.com/anomalyco/opencode/pull/58562))
- Find Git more reliably on macOS. ([#58602](https://github.com/anomalyco/opencode/pull/58602))
- Resolve model details once per prompt step. ([#58601](https://github.com/anomalyco/opencode/pull/58601))
- Let plugins manage session instruction entries for subsequent model requests. ([#56550](https://github.com/anomalyco/opencode/pull/56550))
- Add GPT-6.1 Terra and GPT-6.1 Terra Fast to Sign in with ChatGPT. ([#59359](https://github.com/anomalyco/opencode/pull/59359))

#### Bug fixes

- Wait for plugins to finish reloading before each session step and tool call. Thanks [@kernel-oops](https://github.com/kernel-oops) and [@Tarquinen](https://github.com/Tarquinen). ([#51133](https://github.com/anomalyco/opencode/pull/51133))
- Size session compaction from the provider's reported token count to preserve usable context. ([#59441](https://github.com/anomalyco/opencode/pull/59441))
- Skip unavailable models.dev API entrypoints instead of failing model catalog updates. ([#59475](https://github.com/anomalyco/opencode/pull/59475))
- Return a server error with a reference ID when the server cannot encode a response. ([#59459](https://github.com/anomalyco/opencode/pull/59459))
- Avoid warming a session while its model request is running. ([#59325](https://github.com/anomalyco/opencode/pull/59325))
- Preserve legacy MCP `codemode` settings during migration. Thanks [@tneemo](https://github.com/tneemo). ([#59126](https://github.com/anomalyco/opencode/pull/59126))
- Use the correct Vertex AI endpoints for the `eu` and `us` multi-regions. ([#59335](https://github.com/anomalyco/opencode/pull/59335))
- Accept Databricks hosts that include `http://` or `https://`. ([#59334](https://github.com/anomalyco/opencode/pull/59334))
- Keep files intact when patch edits move a file onto itself. ([#59197](https://github.com/anomalyco/opencode/pull/59197))
- Preserve literal `$0` and `$ARGUMENTS` text in custom command input. ([#59198](https://github.com/anomalyco/opencode/pull/59198))
- Close project locations concurrently during shutdown. ([#59326](https://github.com/anomalyco/opencode/pull/59326))
- Treat equivalent directory paths, including trailing slashes, as one location. ([#59327](https://github.com/anomalyco/opencode/pull/59327))
- Send valid tool schemas to Kimi for tuple, default, and keyword-like arguments. ([#59207](https://github.com/anomalyco/opencode/pull/59207))
- Expose Code Mode MCP tools directly when the `execute` permission is denied. ([#59315](https://github.com/anomalyco/opencode/pull/59315))
- Coordinate OAuth credential refreshes across locations and processes. ([#54023](https://github.com/anomalyco/opencode/pull/54023))
- List and search remote Git branches correctly without bare remote names. ([#58597](https://github.com/anomalyco/opencode/pull/58597))
- Detect AVIF, HEIC/HEIF, QuickTime, and M4A attachments correctly. ([#58480](https://github.com/anomalyco/opencode/pull/58480), [#58886](https://github.com/anomalyco/opencode/pull/58886), [#58887](https://github.com/anomalyco/opencode/pull/58887))
- Reduce memory retained by long-running tool calls and unchanged hooked model requests. ([#58448](https://github.com/anomalyco/opencode/pull/58448), [#58449](https://github.com/anomalyco/opencode/pull/58449))
- Load session diffs without reading every message, improving performance for large sessions. ([#57686](https://github.com/anomalyco/opencode/pull/57686))
- Keep active locations alive when session events use an equivalent directory path. ([#56259](https://github.com/anomalyco/opencode/pull/56259))
- Reload compatibility skills only when their own sources change. ([#59086](https://github.com/anomalyco/opencode/pull/59086))
- Avoid publishing redundant catalog updates when configuration is unchanged. ([#56267](https://github.com/anomalyco/opencode/pull/56267))
- Avoid booting idle or deleted project locations while polling session forms. ([#59083](https://github.com/anomalyco/opencode/pull/59083))
- Wait for plugins before returning agent and provider lists, preventing incomplete catalogs. ([#59082](https://github.com/anomalyco/opencode/pull/59082))
- Manage sessions and instruction entries after their project directory is deleted. ([#58997](https://github.com/anomalyco/opencode/pull/58997))
- Start fuzzy file search only on first use, reducing project startup work. ([#58959](https://github.com/anomalyco/opencode/pull/58959))
- Exit after 10 seconds when shutdown hangs and report pending work. ([#58817](https://github.com/anomalyco/opencode/pull/58817))
- Keep the models catalog fresh without redownloading it when unchanged. ([#58813](https://github.com/anomalyco/opencode/pull/58813))
- Send xAI Responses `top_k` settings and stop sending unsupported penalties. ([#58868](https://github.com/anomalyco/opencode/pull/58868))
- Honor shared parallel tool-call and service-tier settings for Groq. ([#58871](https://github.com/anomalyco/opencode/pull/58871))
- Retry throttled requests instead of misreporting them as context overflows. ([#58866](https://github.com/anomalyco/opencode/pull/58866))
- Preserve streamed text and reasoning that arrive after an OpenAI Chat finish reason. ([#58851](https://github.com/anomalyco/opencode/pull/58851))
- Classify AWS REST JSON errors consistently regardless of where the error type appears. ([#58770](https://github.com/anomalyco/opencode/pull/58770))
- Validate large base64 attachments without slowdowns or hangs. ([#58811](https://github.com/anomalyco/opencode/pull/58811))
- Retry Bedrock throttling errors as rate limits instead of context overflows. Thanks [@Irish-Joseph](https://github.com/Irish-Joseph). ([#58759](https://github.com/anomalyco/opencode/pull/58759))
- Keep working MCP tools available when a server returns malformed ones. ([#58350](https://github.com/anomalyco/opencode/pull/58350))
- Match absolute instruction-file globs across directories. Thanks [@heimoshuiyu](https://github.com/heimoshuiyu). ([#58749](https://github.com/anomalyco/opencode/pull/58749))
- Use configured provider regions in Bedrock endpoint URLs. ([#58538](https://github.com/anomalyco/opencode/pull/58538))
- Handle unknown OpenAI Chat finish reasons without failing the response. ([#58608](https://github.com/anomalyco/opencode/pull/58608))
- Avoid unnecessary Azure model updates when endpoint transforms make no change. ([#58600](https://github.com/anomalyco/opencode/pull/58600))
- Prefer JPEG for opaque browser screenshots, reducing attachment size. ([#56990](https://github.com/anomalyco/opencode/pull/56990))
- Detect generated image types from their bytes when compatible hosts omit the format. ([#58475](https://github.com/anomalyco/opencode/pull/58475))
- Keep project services alive while sessions run long tools or wait for input, with a 24-hour inactivity cap. ([#57274](https://github.com/anomalyco/opencode/pull/57274))
- Prevent unrelated configuration changes and compatibility-skill update bursts from repeatedly reloading skills. ([#56260](https://github.com/anomalyco/opencode/pull/56260))

### TUI

#### Improvements

- Reduce CPU use while animated session-tab pulses are visible. ([#59235](https://github.com/anomalyco/opencode/pull/59235))
- List OpenCode Console before OpenCode Go in the integration picker. ([#59107](https://github.com/anomalyco/opencode/pull/59107))
- Add `/usage`, model-picker, prompt, sidebar, warning, and error details for OpenCode Console usage limits. ([#58731](https://github.com/anomalyco/opencode/pull/58731))
- Make CLI service registration more reliable when concurrent processes update its files. ([#59105](https://github.com/anomalyco/opencode/pull/59105))

#### Bug fixes

- Return `opencode run --format json` server connection errors as JSON. Thanks [@andreivince](https://github.com/andreivince). ([#59366](https://github.com/anomalyco/opencode/pull/59366))
- Preserve pasted prompt text when copying it back out. ([#59209](https://github.com/anomalyco/opencode/pull/59209))
- Reliably update the background service on Windows when its files are briefly locked. ([#59105](https://github.com/anomalyco/opencode/pull/59105))
- Keep the background service state directory out of tool shells and identify processes blocking its port. ([#58815](https://github.com/anomalyco/opencode/pull/58815))
- Refresh Git branch details after switching branches. ([#58982](https://github.com/anomalyco/opencode/pull/58982))
- Keep the TUI running when a plugin slot or route renders bare text. Thanks [@anmol0b](https://github.com/anmol0b) and [@Tarquinen](https://github.com/Tarquinen). ([#58144](https://github.com/anomalyco/opencode/pull/58144))
- Accept `--server` and `--standalone` anywhere in supported CLI commands. ([#58505](https://github.com/anomalyco/opencode/pull/58505))
- Release closed and background session transcripts to prevent memory growth. ([#58434](https://github.com/anomalyco/opencode/pull/58434), [#57025](https://github.com/anomalyco/opencode/pull/57025))
- Connect remote access tunnels through HTTP proxies. ([#58464](https://github.com/anomalyco/opencode/pull/58464))
- Keep development builds on a separate server, database, and port from released builds. ([#58331](https://github.com/anomalyco/opencode/pull/58331))

### Desktop

#### Improvements

- Manage desktop plugins from Settings › Extensions › Plugins. ([#59489](https://github.com/anomalyco/opencode/pull/59489))
- Add a persistent desktop zoom setting. ([#59277](https://github.com/anomalyco/opencode/pull/59277))
- Capture heap snapshots in desktop debug builds on `SIGUSR2` when explicitly enabled. ([#58317](https://github.com/anomalyco/opencode/pull/58317))
- Show the open session title in the browser tab. ([#59131](https://github.com/anomalyco/opencode/pull/59131))
- Show todowrite tasks above the composer. ([#59092](https://github.com/anomalyco/opencode/pull/59092))
- Load session history once when returning to a session tab. ([#59166](https://github.com/anomalyco/opencode/pull/59166))
- Answer questions with number keys and show multi-select choices as checkboxes. ([#58595](https://github.com/anomalyco/opencode/pull/58595))
- Add an always-available Add project action to the location picker. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Let you rewind or fork from any message. ([#58865](https://github.com/anomalyco/opencode/pull/58865))
- Let you edit line comments and copy shell output. ([#58970](https://github.com/anomalyco/opencode/pull/58970), [#58974](https://github.com/anomalyco/opencode/pull/58974))
- Render Mermaid diagrams in messages much faster, sized to fit the column. ([#57483](https://github.com/anomalyco/opencode/pull/57483), [#57004](https://github.com/anomalyco/opencode/pull/57004))
- Add opt-in memory logging and remote debugging for desktop debug builds. ([#58315](https://github.com/anomalyco/opencode/pull/58315))
- Show web sources for a turn behind the experimental Sources setting. ([#58307](https://github.com/anomalyco/opencode/pull/58307))
- Jump from a completed shell notification to its shell output. ([#58663](https://github.com/anomalyco/opencode/pull/58663))
- Keep the composer usable while the voice-call panel floats. ([#58587](https://github.com/anomalyco/opencode/pull/58587))
- Use the Soft Radar activity spinner by default and provide experimental variations. ([#58010](https://github.com/anomalyco/opencode/pull/58010), [#57903](https://github.com/anomalyco/opencode/pull/57903))
- Add an experimental new model picker. ([#58413](https://github.com/anomalyco/opencode/pull/58413))
- Add experimental Console voice calls in Desktop beta. ([#58249](https://github.com/anomalyco/opencode/pull/58249))
- Add a timeline width setting. ([#58308](https://github.com/anomalyco/opencode/pull/58308))
- Improve command, session, and model search lists with sticky sections. ([#58222](https://github.com/anomalyco/opencode/pull/58222))
- Add search to recently closed sessions. ([#55721](https://github.com/anomalyco/opencode/pull/55721))
- Open extension configuration and skills in side tabs. ([#58023](https://github.com/anomalyco/opencode/pull/58023))
- Open session extension lists on hover and follow keyboard navigation. ([#58021](https://github.com/anomalyco/opencode/pull/58021))
- Add video previews with zoom controls. ([#57924](https://github.com/anomalyco/opencode/pull/57924))
- Add generated project avatars and an experimental avatar-style switcher. ([#57871](https://github.com/anomalyco/opencode/pull/57871), [#57930](https://github.com/anomalyco/opencode/pull/57930))
- Add recently closed side tabs to the new-tab view. ([#57863](https://github.com/anomalyco/opencode/pull/57863))
- Add a searchable prompt history picker. ([#57716](https://github.com/anomalyco/opencode/pull/57716))
- Find settings from the command palette. ([#57651](https://github.com/anomalyco/opencode/pull/57651))
- Group queued and steered messages, and group consecutive user messages under one metadata line. ([#57561](https://github.com/anomalyco/opencode/pull/57561), [#57552](https://github.com/anomalyco/opencode/pull/57552))
- Improve file-tree and folder-picker performance. ([#57573](https://github.com/anomalyco/opencode/pull/57573), [#57557](https://github.com/anomalyco/opencode/pull/57557))
- Keep branch search results visible while new results load. ([#57531](https://github.com/anomalyco/opencode/pull/57531))
- Add a session-details menu to the session header. ([#57528](https://github.com/anomalyco/opencode/pull/57528))
- Show a subagent's model, status, and elapsed time in its composer area. ([#57473](https://github.com/anomalyco/opencode/pull/57473))
- Let you delete sessions from tab menus and rename the current session with Ctrl+R. ([#57453](https://github.com/anomalyco/opencode/pull/57453), [#57423](https://github.com/anomalyco/opencode/pull/57423))
- Restore session summary and project menu actions. ([#57781](https://github.com/anomalyco/opencode/pull/57781))
- Let you place the background-activity capsule at the left, center, right, or hide it. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Show project and worktree details in the session header and location menu. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Add text-rendering controls to the debug bar. ([#57326](https://github.com/anomalyco/opencode/pull/57326))
- Show elapsed time for background work. ([#57218](https://github.com/anomalyco/opencode/pull/57218))
- Improve streamed Markdown rendering reliability and performance. ([#57016](https://github.com/anomalyco/opencode/pull/57016))
- Split the side pane and add a draggable bottom pane with tabs. ([#56960](https://github.com/anomalyco/opencode/pull/56960))
- Add consistent MCP sign-in and error-status links across connection, session, and Settings views. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Open multiple file tabs at once and open side-panel content in tabs. ([#57182](https://github.com/anomalyco/opencode/pull/57182), [#57094](https://github.com/anomalyco/opencode/pull/57094))
- Move running work to the background when you steer a session. ([#57142](https://github.com/anomalyco/opencode/pull/57142))
- Let the timeline scroll beneath the composer while keeping its content visible. ([#57141](https://github.com/anomalyco/opencode/pull/57141))
- Simplify Settings into a flat list with a per-server switcher. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Quote selected timeline or terminal text into the composer. ([#55664](https://github.com/anomalyco/opencode/pull/55664), [#58420](https://github.com/anomalyco/opencode/pull/58420))
- Search sessions across online servers from the title bar. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Add a Reduce motion appearance setting. ([#57103](https://github.com/anomalyco/opencode/pull/57103))
- Show projects from all servers in the new-session location picker. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Pick models from a searchable dialog with favorites and recent models. ([#55838](https://github.com/anomalyco/opencode/pull/55838))
- Attach the new-session location picker below the composer. ([#56952](https://github.com/anomalyco/opencode/pull/56952))
- Open image previews directly from message and composer thumbnails. ([#56896](https://github.com/anomalyco/opencode/pull/56896))
- Start new worktrees from the current branch in the simplified location picker. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Manage running subagents and shells from the composer activity capsule. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Sync projects from each server and prioritize projects you use on Home. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Choose between Focus and Pro interface layouts in Settings. ([#56898](https://github.com/anomalyco/opencode/pull/56898))
- Open terminals as side-panel tabs. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Choose a project and worktree from one new-session location dialog. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Show subagents as separate timeline rows by default. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Add a sidebar toggle for vertical tabs. ([#55646](https://github.com/anomalyco/opencode/pull/55646))
- Add ⌘1–9 and ⇧⌘[ / ⇧⌘] shortcuts for side-panel tabs. ([#57301](https://github.com/anomalyco/opencode/pull/57301))
- Let you choose a new directory or worktree when a session location is unavailable. ([#56087](https://github.com/anomalyco/opencode/pull/56087))
- Refresh the Manage models, MCP, and fork dialogs with compact searchable lists. ([#56029](https://github.com/anomalyco/opencode/pull/56029), [#56028](https://github.com/anomalyco/opencode/pull/56028))
- Install future Windows desktop updates in about a second. ([#55933](https://github.com/anomalyco/opencode/pull/55933))
- Show individual Code Mode tool calls in Execute rows. ([#55649](https://github.com/anomalyco/opencode/pull/55649))
- Add a Commentary timeline category and display setting. ([#55248](https://github.com/anomalyco/opencode/pull/55248))
- Support `@` links to other sessions in messages. ([#57480](https://github.com/anomalyco/opencode/pull/57480))
- Polish spacing, alignment, borders, and typography across the session header, titlebar, composer, file tree, browser pane, timeline, and Settings. ([#58195](https://github.com/anomalyco/opencode/pull/58195), [#57776](https://github.com/anomalyco/opencode/pull/57776), [#57570](https://github.com/anomalyco/opencode/pull/57570), [#57782](https://github.com/anomalyco/opencode/pull/57782), [#57336](https://github.com/anomalyco/opencode/pull/57336), [#57363](https://github.com/anomalyco/opencode/pull/57363), [#58100](https://github.com/anomalyco/opencode/pull/58100), [#58979](https://github.com/anomalyco/opencode/pull/58979))

#### Bug fixes

- Prevent duplicate tab shortcuts and remove uninstalled plugin commands from Shortcuts. ([#59499](https://github.com/anomalyco/opencode/pull/59499))
- Keep todo items from shrinking in the todo panel. ([#59430](https://github.com/anomalyco/opencode/pull/59430))
- Keep question-dock answers and controls positioned correctly when changing questions. ([#59383](https://github.com/anomalyco/opencode/pull/59383))
- Keep the @ menu open while it searches. ([#59425](https://github.com/anomalyco/opencode/pull/59425))
- Finish quitting after Cmd+Q on macOS. Thanks [@anmol0b](https://github.com/anmol0b). ([#59144](https://github.com/anomalyco/opencode/pull/59144))
- Toggle MCP servers for the current session location from Settings. ([#59132](https://github.com/anomalyco/opencode/pull/59132))
- Deliver steering messages when an earlier move was missed. ([#58984](https://github.com/anomalyco/opencode/pull/58984))
- Keep session and command-palette search results stable while searching. ([#58908](https://github.com/anomalyco/opencode/pull/58908), [#57479](https://github.com/anomalyco/opencode/pull/57479))
- Restrict Search projects to the project list. ([#58978](https://github.com/anomalyco/opencode/pull/58978))
- Let custom Close tab shortcuts close terminal and browser tabs. ([#58945](https://github.com/anomalyco/opencode/pull/58945))
- Prevent live status rows from jumping or leaving gaps above the composer. ([#58691](https://github.com/anomalyco/opencode/pull/58691), [#58697](https://github.com/anomalyco/opencode/pull/58697))
- Keep browser tabs still behind open dialogs. ([#58958](https://github.com/anomalyco/opencode/pull/58958))
- Keep side-panel content and browser pages visible while the sidebar or panel moves. ([#58202](https://github.com/anomalyco/opencode/pull/58202), [#58185](https://github.com/anomalyco/opencode/pull/58185))
- Render session diffs reliably.
- Keep keyboard focus in terminals, side panels, dialogs, and the composer when appropriate. ([#57980](https://github.com/anomalyco/opencode/pull/57980), [#57297](https://github.com/anomalyco/opencode/pull/57297), [#56273](https://github.com/anomalyco/opencode/pull/56273))
- Preserve empty browser and side-panel tabs instead of closing them automatically. ([#58440](https://github.com/anomalyco/opencode/pull/58440))
- Reduce desktop memory use by releasing closed transcripts, discarded tool-result images, retained UI batches, and aborted timeline work. ([#57025](https://github.com/anomalyco/opencode/pull/57025), [#58434](https://github.com/anomalyco/opencode/pull/58434), [#58427](https://github.com/anomalyco/opencode/pull/58427), [#58560](https://github.com/anomalyco/opencode/pull/58560), [#58447](https://github.com/anomalyco/opencode/pull/58447), [#58439](https://github.com/anomalyco/opencode/pull/58439), [#58432](https://github.com/anomalyco/opencode/pull/58432))
- Restore horizontal scrolling and sticky change badges in the file tree. ([#58117](https://github.com/anomalyco/opencode/pull/58117))
- Show live Thinking for reasoning-only turns. ([#58299](https://github.com/anomalyco/opencode/pull/58299))
- Stop loading older history after completing the initially visible turn and prioritize the first transcript page. ([#57700](https://github.com/anomalyco/opencode/pull/57700), [#57741](https://github.com/anomalyco/opencode/pull/57741))
- Keep Home project and session lists reliable during refreshes.
- Keep deleted sessions from reappearing on Home. ([#55349](https://github.com/anomalyco/opencode/pull/55349))
- Find sessions immediately in @ mentions, including multi-word titles. ([#57683](https://github.com/anomalyco/opencode/pull/57683))
- Keep queued messages editable while changes sync with the server. ([#57569](https://github.com/anomalyco/opencode/pull/57569))
- Open image and video URLs in the browser pane. ([#57562](https://github.com/anomalyco/opencode/pull/57562))
- Mark submitted generated forms as complete and send each response only once. ([#57537](https://github.com/anomalyco/opencode/pull/57537))
- Improve file-view performance with reused views, virtualized medium files, and cached diffs. ([#57551](https://github.com/anomalyco/opencode/pull/57551))
- Group untracked folders into one expandable review row. ([#57527](https://github.com/anomalyco/opencode/pull/57527))
- Let you paste into the composer from the session view. ([#57545](https://github.com/anomalyco/opencode/pull/57545))
- Recover failed beta background servers and preserve their required CLI versions. ([#57321](https://github.com/anomalyco/opencode/pull/57321))
- Restore branch selection when starting a new worktree session. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Keep the running server available while beta updates install. ([#57309](https://github.com/anomalyco/opencode/pull/57309))
- Make links in user messages, shell output, and Code Mode output clickable. ([#57211](https://github.com/anomalyco/opencode/pull/57211), [#57303](https://github.com/anomalyco/opencode/pull/57303))
- Make Check for Updates always report its result. ([#57296](https://github.com/anomalyco/opencode/pull/57296))
- Reopen the last closed side-panel tab with ⇧⌘T and open a browser tab with ⌘T. ([#57269](https://github.com/anomalyco/opencode/pull/57269), [#57156](https://github.com/anomalyco/opencode/pull/57156))
- Keep OpenCode keyboard shortcuts working in the browser pane. ([#56697](https://github.com/anomalyco/opencode/pull/56697), [#55240](https://github.com/anomalyco/opencode/pull/55240))
- Preview image attachments supplied by file path. ([#57249](https://github.com/anomalyco/opencode/pull/57249))
- Apply configured code and UI fonts consistently. ([#57242](https://github.com/anomalyco/opencode/pull/57242))
- Keep activity and busy indicators steady while switching sessions. ([#57196](https://github.com/anomalyco/opencode/pull/57196))
- Reserve ⇧⌘W for closing the window so ⌘W does not. ([#57150](https://github.com/anomalyco/opencode/pull/57150))
- Make image preview transitions resize smoothly without clipping or blocking clicks. ([#56997](https://github.com/anomalyco/opencode/pull/56997), [#57324](https://github.com/anomalyco/opencode/pull/57324))
- Keep in-session search reliable alongside titlebar session search. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Return focus to the prompt after keyboard model selection.
- Open searchable pickers at the top with search focused. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Keep tables visible beneath sticky headers. ([#57050](https://github.com/anomalyco/opencode/pull/57050))
- Fit provider connection steps without shifting a dialog's top edge. ([#57006](https://github.com/anomalyco/opencode/pull/57006))
- Give unavailable-server panels clear error styling. ([#57003](https://github.com/anomalyco/opencode/pull/57003))
- Make mouse-wheel and keyboard scrolling respond immediately on Linux. ([#57962](https://github.com/anomalyco/opencode/pull/57962))
- Keep long Execute tool code contained and show successful Code Mode output. ([#56915](https://github.com/anomalyco/opencode/pull/56915))
- Focus the most useful control when dialogs open, including Cancel in delete confirmations. ([#57453](https://github.com/anomalyco/opencode/pull/57453))
- Install Windows beta, stable, and nightly builds into separate directories. ([#56904](https://github.com/anomalyco/opencode/pull/56904))
- Keep session tabs recoverable when their server becomes unreachable. ([#56248](https://github.com/anomalyco/opencode/pull/56248))
- Keep the composer model's provider and session-model resolution consistent with the TUI. ([#56225](https://github.com/anomalyco/opencode/pull/56225))
- Reread open files without resetting their scroll position. ([#55899](https://github.com/anomalyco/opencode/pull/55899))
- Hide agent names when agents are disabled. ([#57525](https://github.com/anomalyco/opencode/pull/57525))
- Polish sidebar, panel, composer, activity, question-dock, loading, and motion behavior across light and dark themes. ([#57449](https://github.com/anomalyco/opencode/pull/57449), [#58013](https://github.com/anomalyco/opencode/pull/58013), [#58577](https://github.com/anomalyco/opencode/pull/58577), [#57944](https://github.com/anomalyco/opencode/pull/57944), [#58052](https://github.com/anomalyco/opencode/pull/58052), [#58494](https://github.com/anomalyco/opencode/pull/58494), [#58073](https://github.com/anomalyco/opencode/pull/58073), [#58114](https://github.com/anomalyco/opencode/pull/58114))
- Polish hover states, cursors, tooltips, focus rings, scrollbars, and transitions across desktop controls. ([#57653](https://github.com/anomalyco/opencode/pull/57653), [#57787](https://github.com/anomalyco/opencode/pull/57787), [#57304](https://github.com/anomalyco/opencode/pull/57304), [#58971](https://github.com/anomalyco/opencode/pull/58971), [#57221](https://github.com/anomalyco/opencode/pull/57221), [#57192](https://github.com/anomalyco/opencode/pull/57192), [#58575](https://github.com/anomalyco/opencode/pull/58575), [#58580](https://github.com/anomalyco/opencode/pull/58580))

### SDK

#### Improvements

- Add GUI plugin APIs for toasts, dialogs, notifications, tabs, composer controls, and custom UI. ([#59469](https://github.com/anomalyco/opencode/pull/59469))

#### Bug fixes

- Fix generated Promise client input types for TypeScript consumers. ([#58875](https://github.com/anomalyco/opencode/pull/58875))
- Let SDK clients discard inline tool-result file payloads to reduce memory use. ([#59101](https://github.com/anomalyco/opencode/pull/59101))
- Avoid unnecessary catalog refreshes for locations an SDK client has not loaded. ([#55237](https://github.com/anomalyco/opencode/pull/55237), [#59099](https://github.com/anomalyco/opencode/pull/59099))
- Restore running sessions created while an SDK client was disconnected. ([#53012](https://github.com/anomalyco/opencode/pull/53012))
- Release omitted tool-image payloads from memory instead of retaining their base64 data. ([#58560](https://github.com/anomalyco/opencode/pull/58560))

## v2.1.4 — 2026-10-23

### Highlights

- **MCP Input Forms Now Appear**: When an MCP server asks for input during a tool call, the form now shows up instead of the call waiting until it times out. Desktop and web can now show these forms too, including text, number, choice, multiselect, boolean, and URL requests. ([#58184](https://github.com/anomalyco/opencode/pull/58184), [#58305](https://github.com/anomalyco/opencode/pull/58305))
- **Background Compaction**: Set `experimental.background_compaction` to `true` to prepare a summary in the background as a session nears its compaction threshold, so automatic compaction does not wait for it. Summaries that are never used still cost tokens. ([#57444](https://github.com/anomalyco/opencode/pull/57444), [#58294](https://github.com/anomalyco/opencode/pull/58294))

### Core

#### Improvements

- Added experimental background compaction through `experimental.background_compaction`. ([#57444](https://github.com/anomalyco/opencode/pull/57444), [#58294](https://github.com/anomalyco/opencode/pull/58294))
- When a compaction request exceeds the provider limit, older tool output and exchanges are now shortened first, so more useful history survives. ([#58015](https://github.com/anomalyco/opencode/pull/58015))
- ChatGPT sign-in context caps are now a documented built-in plugin. Add `"-opencode.provider.openai-context-caps"` to `plugins` to turn them off. ([#58194](https://github.com/anomalyco/opencode/pull/58194))
- Added `opencode debug heap-dump [--server <url>]` to capture a running server's heap without restarting it. ([#58252](https://github.com/anomalyco/opencode/pull/58252))

#### Bug fixes

- Sessions without their own model now use the selected agent's model. ([#58355](https://github.com/anomalyco/opencode/pull/58355))
- Compaction buffers that leave the model no room are now ignored, and more provider context-overflow errors are recognized. ([#58313](https://github.com/anomalyco/opencode/pull/58313), [#57982](https://github.com/anomalyco/opencode/pull/57982))
- Agent files that use V2-only fields are now read as V2 agents. ([#58218](https://github.com/anomalyco/opencode/pull/58218))
- Codex models that ChatGPT accounts reject are now hidden. ([#58180](https://github.com/anomalyco/opencode/pull/58180))
- Imported V1 global sessions are now attributed to the correct project. ([#56322](https://github.com/anomalyco/opencode/pull/56322))

### TUI

#### Improvements

- Added an experimental **TUI tools** option in the experiments dialog, which lets agents open and type into the session terminal through `tui_open_terminal` and `tui_write_terminal` without taking keyboard focus. ([#57506](https://github.com/anomalyco/opencode/pull/57506))
- After an update restart, the TUI now tells you to start OpenCode again. ([#58139](https://github.com/anomalyco/opencode/pull/58139))

#### Bug fixes

- Rows that contain Unicode direction marks, common in Hebrew and Arabic text, no longer shift one column when part of the row redraws. ([#58380](https://github.com/anomalyco/opencode/pull/58380))

### Desktop

#### Improvements

- MCP elicitation forms now appear in desktop and web sessions, with controls for structured and URL requests. ([#58305](https://github.com/anomalyco/opencode/pull/58305))
- Added **Capture heap snapshots** to the command palette. It saves app-window, main-process, and server snapshots together in Downloads, with native-memory, GPU, and page diagnostics. ([#58259](https://github.com/anomalyco/opencode/pull/58259), [#58311](https://github.com/anomalyco/opencode/pull/58311))

#### Bug fixes

- File change counts now appear before their labels in review and file summaries. ([#58353](https://github.com/anomalyco/opencode/pull/58353))
- Linux AppImage executable names no longer end in `.desktop`. Thanks [@ImBIOS](https://github.com/ImBIOS). ([#58263](https://github.com/anomalyco/opencode/pull/58263))

### SDK

#### Improvements

- Added `connectClientMcp()` for hosting MCP tools in a client over the experimental client MCP WebSocket transport. ([#57504](https://github.com/anomalyco/opencode/pull/57504), [#57505](https://github.com/anomalyco/opencode/pull/57505))

### Extensions

#### Bug fixes

- MCP elicitation forms now appear during tool calls instead of the call waiting until it times out. Thanks [@dimitriskourg](https://github.com/dimitriskourg) and [@chrischall](https://github.com/chrischall). ([#58184](https://github.com/anomalyco/opencode/pull/58184))
- MCP OAuth login now keeps waiting after unrelated requests reach its callback. Thanks [@reynold-hu](https://github.com/reynold-hu). ([#58342](https://github.com/anomalyco/opencode/pull/58342))
- Remote MCP requests now stay open past Bun's fetch idle timeout. ([#58341](https://github.com/anomalyco/opencode/pull/58341))
- MCP servers started during initial reconciliation are no longer duplicated, and MCP servers now stop in parallel on shutdown. ([#58349](https://github.com/anomalyco/opencode/pull/58349), [#58351](https://github.com/anomalyco/opencode/pull/58351))
- MCP tools whose output schema is not a root object are now accepted. ([#58224](https://github.com/anomalyco/opencode/pull/58224))

## v2.1.3 — 2026-10-22

### Highlights

- **Bun 1.4.4 Security Fixes**: OpenCode now runs on Bun 1.4.4, which includes security fixes for Brotli, TLS, HTTP/3, WebSocket, and more, along with updated root certificates. ([#58087](https://github.com/anomalyco/opencode/pull/58087))
- **Faster Code Display**: Code blocks, file views, and review diffs in Desktop now use Pierre Highlights, reducing highlighting time and memory use for large files and diffs. ([#57937](https://github.com/anomalyco/opencode/pull/57937))
- **Discover and Start Voice Models**: SDK clients can call `client.voice.models()` to find available experimental voice models and supported transports. Connected OpenCode Console workspaces can also host GPT-Live sessions through `client.voice.session()`. ([#57194](https://github.com/anomalyco/opencode/pull/57194), [#57735](https://github.com/anomalyco/opencode/pull/57735))

### Core

#### Improvements

- Upgraded the bundled Bun runtime to 1.4.4, which includes [security fixes](https://bun.com/blog/bun-v1.4.4#security) for Brotli, TLS, HTTP/1.1, HTTP/2, HTTP/3, WebSocket, and `fetch`, and updates root certificates to NSS 3.131.1. ([#58087](https://github.com/anomalyco/opencode/pull/58087))
- Generated session titles now use the lowest suitable model variant and more focused naming instructions. ([#51939](https://github.com/anomalyco/opencode/pull/51939), [#57648](https://github.com/anomalyco/opencode/pull/57648))
- Windows managed services now use port `28894`, avoiding ranges reserved by Windows and WSL mirrored networking. ([#57428](https://github.com/anomalyco/opencode/pull/57428))

#### Bug fixes

- Custom provider `baseURL` settings now override catalog model endpoints as expected. Thanks [@Tarquinen](https://github.com/Tarquinen) and [@bercedev](https://github.com/bercedev). ([#57810](https://github.com/anomalyco/opencode/pull/57810))
- Compaction summaries can use the same model output limit as normal responses, preventing incomplete summaries. ([#57564](https://github.com/anomalyco/opencode/pull/57564))
- Legacy `apply_patch` permissions now migrate to the `edit` permission. ([#57900](https://github.com/anomalyco/opencode/pull/57900))
- V1 sessions with relative working directories now migrate using their project worktree. Thanks [@MohammadAlMasalmeh](https://github.com/MohammadAlMasalmeh). ([#57618](https://github.com/anomalyco/opencode/pull/57618))
- Unsupported legacy agent colors no longer prevent agents from loading. Thanks [@4sDriven](https://github.com/4sDriven). ([#57910](https://github.com/anomalyco/opencode/pull/57910))

### TUI

#### Bug fixes

- The TUI no longer crashes when file watchers are unavailable or system watch limits are exhausted. Thanks [@ANSHSINGH050404](https://github.com/ANSHSINGH050404). ([#51536](https://github.com/anomalyco/opencode/pull/51536))

### Desktop

#### Improvements

- Code blocks, streaming output, file views, and review diffs now use Pierre Highlights for faster highlighting and lower memory use on large inputs. ([#57937](https://github.com/anomalyco/opencode/pull/57937))

#### Bug fixes

- Renaming a session tab now pastes plain text instead of formatted content. ([#58036](https://github.com/anomalyco/opencode/pull/58036))
- Dragging the session scrollbar no longer forces the timeline back to its end. ([#57831](https://github.com/anomalyco/opencode/pull/57831))
- RPM packages no longer conflict with build-ID links installed by other Electron applications. ([#58093](https://github.com/anomalyco/opencode/pull/58093))

### SDK

#### Improvements

- Added `client.voice.models()` to list experimental voice models, availability, and supported WebRTC or WebSocket transports. ([#57194](https://github.com/anomalyco/opencode/pull/57194))
- Voice sessions can now use GPT-Live hosted by a connected OpenCode Console workspace. Hosted sessions expose an ID and support instruction updates through `client.voice.instructions()`. ([#57735](https://github.com/anomalyco/opencode/pull/57735))

### Extensions

#### Bug fixes

- MCP results now keep supported media inline, decode textual resources, and save unsupported binary resources to files instead of creating invalid model attachments. ([#57640](https://github.com/anomalyco/opencode/pull/57640))
- Updates to MCP instructions, skills, and project references now send only changed entries instead of repeating the full list. ([#57626](https://github.com/anomalyco/opencode/pull/57626))

## v2.1.2 — 2026-10-21

### Highlights

- **Clear Free-Limit Recovery**: When your free messages run out, Desktop and the TUI now show the reset time, restore your submitted prompt, and offer direct upgrade or model-switching actions instead of a generic error. ([#57466](https://github.com/anomalyco/opencode/pull/57466), [#57467](https://github.com/anomalyco/opencode/pull/57467), [#57471](https://github.com/anomalyco/opencode/pull/57471))
- **Hide Free Models**: Set `OPENCODE_DISABLE_FREE_MODELS=1` or `true` to remove zero-cost models from OpenCode and OpenCode Go catalogs, defaults, and fallbacks. ([#57478](https://github.com/anomalyco/opencode/pull/57478))
- **Configurable Location Unloading**: Set `experimental.location_idle_timeout` to a duration such as `"4 hours"`, or to `false`, to control when inactive location services unload. ([#57476](https://github.com/anomalyco/opencode/pull/57476))
- **Reliable Fresh Installs**: The installer now creates `~/.zshrc` or Fish’s `config.fish` when missing, adds OpenCode to `PATH`, and tells you to run `exec $SHELL`. ([#57348](https://github.com/anomalyco/opencode/pull/57348))

### Core

#### Improvements

- Added `OPENCODE_DISABLE_FREE_MODELS` for hiding free OpenCode and OpenCode Go models. ([#57478](https://github.com/anomalyco/opencode/pull/57478))
- Added `experimental.location_idle_timeout`, accepting a duration string or `false`. ([#57476](https://github.com/anomalyco/opencode/pull/57476))

#### Bug fixes

- Fixed fresh zsh and Fish installations not adding OpenCode to `PATH` when their configuration file did not exist. ([#57348](https://github.com/anomalyco/opencode/pull/57348))
- Kept locations loaded while sessions are waiting for input, running long tools, or owning background jobs. ([#57416](https://github.com/anomalyco/opencode/pull/57416))
- Fixed legacy `console.opencode.ai` credentials not being forwarded to `opencode.ai/console`. ([#57588](https://github.com/anomalyco/opencode/pull/57588))
- Reused recent Console configuration checks when inference is rejected, avoiding unnecessary repeated checks. ([#57465](https://github.com/anomalyco/opencode/pull/57465))

### TUI

#### Improvements

- Added an inline free-limit notice with the reset time and `/connect` and `/models` actions, while restoring the submitted prompt when the composer is empty. ([#57467](https://github.com/anomalyco/opencode/pull/57467))
- Restored the animated “Free limit reached” OpenCode Go dialog with **Subscribe**, **Dismiss**, and **Don’t show again** actions. ([#57471](https://github.com/anomalyco/opencode/pull/57471))

#### Bug fixes

- Stopped showing redundant failure notifications when the free-message limit is reached. ([#57467](https://github.com/anomalyco/opencode/pull/57467))
- Only shows “location unavailable” when the server explicitly reports the location as missing. ([#57594](https://github.com/anomalyco/opencode/pull/57594))

### Desktop

#### Bug fixes

- Restored the free-limit dialog, reset-time timeline notice, and submitted prompt after free usage is exhausted. Subscribing to OpenCode Go now updates the current session’s model instead of opening another draft. ([#57466](https://github.com/anomalyco/opencode/pull/57466))

### SDK

#### Improvements

- Added `retryAfterMs` to structured session errors so clients can display provider-supplied retry timing. ([#57146](https://github.com/anomalyco/opencode/pull/57146))

#### Bug fixes

- Fixed retry timing being dropped from quota, rate-limit, and provider-internal session errors. ([#57589](https://github.com/anomalyco/opencode/pull/57589))
- Fixed OpenAI realtime client-secret requests by supplying the required `expires_after.anchor`.

### Extensions

#### Bug fixes

- Fixed Code Mode async jobs interleaving in the middle of statements and losing writes, while preserving concurrent tool calls. Thanks [@RhysSullivan](https://github.com/RhysSullivan)! ([#54276](https://github.com/anomalyco/opencode/pull/54276))

## v2.1.0 — 2026-10-20

### Highlights

- **Persistent Terminals on Windows**: Windows users now get persistent PTYs through the same terminal workflow available on macOS and Linux. ([#56245](https://github.com/anomalyco/opencode/pull/56245))
- **Todo Lists in the TUI**: Enable `{ "experimental": { "todo": true } }` to give models the `todowrite` tool and display their task list in the session and sidebar. ([#56947](https://github.com/anomalyco/opencode/pull/56947))
- **Reliable Long-Running TUI Commands**: Plugin commands, shell calls, and other TUI requests can now run beyond Bun’s five-minute fetch deadline without losing their connection. ([#55149](https://github.com/anomalyco/opencode/pull/55149))

### Breaking changes

Version 2.1 makes intentional changes to public SDK, HTTP message/event, and plugin contracts so provider replay data and compaction use consistent names and shapes. Integrations must adopt the new fields. Existing stored sessions, credentials, and older session imports remain readable through compatibility decoders; no database migration is required. ([#57260](https://github.com/anomalyco/opencode/pull/57260))

#### Provider replay data is now `native`

Provider-owned replay data previously used different names on different surfaces. Read and write `native` instead; a tool's execution `state` and UI `metadata` are separate and are not renamed.

| Surface | Before | After |
| --- | --- | --- |
| Text and reasoning parts | `state` | `native` |
| Assistant and compaction messages | `providerState` | `native` |
| Text/reasoning lifecycle events and `session.tool.called` | `state` | `native` |
| `session.step.ended`, `session.step.failed`, and `session.compaction.ended` | `providerState` | `native` |
| `session.tool.success` and `session.tool.failed` | `resultState` | `native` |
| Exported replay-data schema | `SessionMessage.ProviderState` | `SessionMessage.Native` |
| Plugin compaction hook result | `SessionCompactionResult.providerState` | `SessionCompactionResult.native` |

#### Tool call and result data share `tool.native`

Tool parts no longer have separate `providerState` and `providerResultState` fields:

```diff
 tool
-  providerState?
-  providerResultState?
+  native?
   state
```

Success and failure events shallow-merge their `native` into the call's existing `native`. Missing result data preserves call data; result values win on duplicate keys. Provider/protocol implementations must use distinct keys when call and result values differ. There is no `state.native`, `resultNative`, or nested `{ call, result }` envelope.

Replay passes the merged blob to the protocol, which reads the fields it needs. Tool calls receive it only for the same provider and model. Provider-run results receive it for the same provider, including after a model switch. Local results receive it only for the same provider and model when the step did not fail. Legacy stored or imported `providerResultState` is merged into `tool.native` when read. Execution status and readable output remain in `tool.state`.

#### Key credential setup answers move to `metadata`

`Credential.Key.configuration` is removed. Public credential writes must put setup-form answers in the existing `metadata` field:

```diff
 { type: "key", key: "...",
-  configuration: { account: "example" }
+  metadata: { account: "example" }
 }
```

Existing stored credentials and `opencode auth import` still accept the old shape. Legacy `configuration` is merged into `metadata`; the legacy configuration value wins when both contain the same key. This compatibility is for storage/import, not a reason to keep sending `configuration` in public writes.

#### Summary compactions reference kept messages

Compaction messages and `session.compaction.started` / `session.compaction.ended` no longer expose `recent`. New summary compactions reference the first message retained verbatim through `metadata.keepID` instead of storing a second, flattened copy:

```diff
 summary compaction
-  recent: "[User]: ... [Assistant]: ..."
+  metadata: { keepID: "msg_..." }
```

History reconstructs the kept text from that message up to the compaction boundary. Forks remap the reference to their copied messages, and compaction hooks can override `keepID` through metadata. Kept text from pre-2.1 compactions and V1 imports remains available as `metadata.recent`. New compactions store the reference, not the duplicated text.

#### Provider compaction windows move to `native.messages`

Completed compactions and `session.compaction.ended` no longer have `providerContext`. The replacement message window now lives in `native.messages`:

```diff
-  providerContext: { version, provenance, messages }
+  native: { messages }
```

Native compaction replay now matches the compaction's provider ID and model ID, rather than route/protocol/endpoint provenance. If they do not match, history uses the original messages. Endpoint changes alone no longer block replay, and request hooks that rewrite the base URL no longer block native compaction or replay.

Summary compactions no longer save the summary call's unused provider data in `native`. A compaction hook's `result.native` is still stored; if it contains `messages`, that window is replayed **instead of** the summary. Old `providerContext` rows and events are converted when read, including the media format used before 2.0.15.

#### Remove the unused `session.compacted` event

The transitional `session.compacted` event is removed from the public event surface. Update event subscriptions and schema imports to use the current compaction lifecycle events, including `session.compaction.started` and `session.compaction.ended`.

### Core

#### Improvements

- Added persistent PTY support for Windows x64 and ARM64. ([#56245](https://github.com/anomalyco/opencode/pull/56245))
- Restored the `todowrite` tool behind `{ "experimental": { "todo": true } }`; it accepts the complete list as `{ todos: [{ content, status }] }`. ([#56947](https://github.com/anomalyco/opencode/pull/56947))
- Restored session archiving, including archive-state filtering and restoring archived sessions. ([#53759](https://github.com/anomalyco/opencode/pull/53759))
- Added support for editing saved permission actions and resource patterns. ([#56659](https://github.com/anomalyco/opencode/pull/56659))
- Summary compaction now covers the whole conversation while retaining recent text verbatim, and begins earlier by default to leave more response room. ([#57091](https://github.com/anomalyco/opencode/pull/57091))
- Added the `streamUsage` model compatibility option for providers that reject `stream_options`. ([#57255](https://github.com/anomalyco/opencode/pull/57255))

#### Bug fixes

- Prevented long-running TUI, `run`, and `mini` requests from hitting Bun’s default fetch deadline. Thanks @Finn763. ([#55149](https://github.com/anomalyco/opencode/pull/55149))
- Retried broken-pipe transport failures. Thanks @sdivyanshu90. ([#56307](https://github.com/anomalyco/opencode/pull/56307))
- Retried transient failures from buffered model generations instead of immediately failing. ([#56497](https://github.com/anomalyco/opencode/pull/56497))
- Ignored provider keep-alives and unknown stream events while continuing to reject malformed known events. ([#56286](https://github.com/anomalyco/opencode/pull/56286), [#56669](https://github.com/anomalyco/opencode/pull/56669))
- Limited the OpenAI-compatible `store` field to OpenAI, Azure, and providers that explicitly opt in. ([#57239](https://github.com/anomalyco/opencode/pull/57239))
- Preserved more complete context during compaction and stabilized image trimming and instruction baselines to improve prompt-cache reuse. Thanks @rrauenza for the revert fix. ([#56983](https://github.com/anomalyco/opencode/pull/56983), [#54410](https://github.com/anomalyco/opencode/pull/54410))
- Ensured shell completion is reported only after output capture finishes, and reported removed running shells as killed. ([#56321](https://github.com/anomalyco/opencode/pull/56321), [#56982](https://github.com/anomalyco/opencode/pull/56982))
- Prevented undefined permission metadata from breaking pending-request responses. ([#54090](https://github.com/anomalyco/opencode/pull/54090))
- Bounded skill discovery and file watches, and tolerated filesystem permission denials during sandboxed startup. ([#55597](https://github.com/anomalyco/opencode/pull/55597), [#55817](https://github.com/anomalyco/opencode/pull/55817))
- Included the root `script/` directory in Nix CLI builds. ([#55494](https://github.com/anomalyco/opencode/pull/55494))

### TUI

#### Improvements

- Added todo lists to session output, compact cards, and the sidebar when experimental todo support is enabled. ([#56947](https://github.com/anomalyco/opencode/pull/56947))
- `/models` now opens on the current model and preserves the server’s preferred model order. ([#57151](https://github.com/anomalyco/opencode/pull/57151))
- Added visible keyboard focus and reverse `Shift+Tab` navigation to export options. ([#57154](https://github.com/anomalyco/opencode/pull/57154))

#### Bug fixes

- Kept long-running commands connected beyond Bun’s fetch deadline and restored the composer with an error toast when an existing-session shell command fails. Thanks @Finn763. ([#55149](https://github.com/anomalyco/opencode/pull/55149))
- Retried `session.wait` after transport interruptions in `mini`. ([#57062](https://github.com/anomalyco/opencode/pull/57062))
- Highlighted the selected file in the diff tree. Thanks @Tarquinen. ([#57227](https://github.com/anomalyco/opencode/pull/57227))
- Removed per-row resize listeners from selection dialogs. Thanks @tobwen. ([#56234](https://github.com/anomalyco/opencode/pull/56234))
- Corrected spacing above simple-dialog footers. ([#56092](https://github.com/anomalyco/opencode/pull/56092))
- Fixed Mermaid flowchart rendering in the TUI when labels contain apostrophes. ([#57060](https://github.com/anomalyco/opencode/pull/57060))

### Desktop

#### Bug fixes

- Show free OpenCode models alongside their paid counterparts by default instead of hiding them when they share the same model family and release date. ([#55712](https://github.com/anomalyco/opencode/pull/55712))

### SDK

#### Improvements

- Extended the existing experimental server voice API, `client.voice.session(...)`, with Gemini Live support for `gemini-3.8-live*` models over WebSocket. The server uses a stored Google key or `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or `GOOGLE_API_KEY`. ([#56888](https://github.com/anomalyco/opencode/pull/56888))
- Added `client.permission.saved.update(...)` for changing a saved permission’s action or resource. ([#56659](https://github.com/anomalyco/opencode/pull/56659))
- Added archive filtering to `client.session.list(...)` and archive updates to `client.session.update(...)`. ([#53759](https://github.com/anomalyco/opencode/pull/53759))
- Added `idle` to the supported `client.message.list(...)` type filter. ([#56504](https://github.com/anomalyco/opencode/pull/56504))

### Extensions

#### Improvements

- Added paginated `ctx.session.list(...)` to both Effect and Promise plugin APIs. ([#56264](https://github.com/anomalyco/opencode/pull/56264))

## v2.0.32 — 2026-10-16

### Highlights

- **Copy the Latest Reply**: Run `/copy` in the TUI to copy the latest assistant message or completed compaction summary instead of the full transcript. ([#56053](https://github.com/anomalyco/opencode/pull/56053), [#56055](https://github.com/anomalyco/opencode/pull/56055))
- **Auth Login in Headless Environments**: `opencode auth login` no longer crashes in a container or other headless environment that cannot open a browser; use the URL already printed in the terminal to continue. ([#56082](https://github.com/anomalyco/opencode/pull/56082))

### Core

#### Bug fixes

- Prevented `opencode auth login` from crashing when no browser opener such as `xdg-open` is available. ([#56082](https://github.com/anomalyco/opencode/pull/56082))
- Gemini sessions now retry or continue after intermittent `MALFORMED_RESPONSE` finishes instead of immediately failing. ([#56232](https://github.com/anomalyco/opencode/pull/56232))
- Made snapshot capture resilient to concurrent Git object writes on Windows. ([#56190](https://github.com/anomalyco/opencode/pull/56190))

### TUI

#### Improvements

- Changed `/copy` to copy the latest assistant message; the full transcript remains available from the command palette or `/export`. ([#56053](https://github.com/anomalyco/opencode/pull/56053))

#### Bug fixes

- `/copy` now copies a completed compaction summary when it is the latest response. ([#56055](https://github.com/anomalyco/opencode/pull/56055))

### SDK

#### Improvements

- Added the experimental `client.voice.session(...)` API for server-brokered OpenAI GPT-Live and Realtime WebRTC sessions, OpenAI Realtime WebSocket sessions, and xAI Grok Voice WebSocket sessions. It uses an API key stored on the server or `OPENAI_API_KEY`/`XAI_API_KEY`; ChatGPT sign-in credentials are not used. ([#55951](https://github.com/anomalyco/opencode/pull/55951))

## v2.0.30 — 2026-10-15

### Highlights

- **Changed Files by Turn**: Enable **Settings → Preferences → Timeline → Changed files** to see each completed turn’s changed files, line counts, and expandable diffs. ([#55064](https://github.com/anomalyco/opencode/pull/55064))
- **Docked TUI Diffs**: Run `/diff` inside a session to open the diff viewer beside your work. Press `f` to switch between the side panel and full screen; the layout adapts automatically to narrower terminals. ([#47152](https://github.com/anomalyco/opencode/pull/47152), [#55574](https://github.com/anomalyco/opencode/pull/55574), [#55780](https://github.com/anomalyco/opencode/pull/55780))
- **Keyboard Tab Navigation**: Use **Option+↑/↓** to move between session tabs, or add **Shift** to jump between unread tabs. ([#54277](https://github.com/anomalyco/opencode/pull/54277))

### Core

#### Improvements

- Load local glob patterns and remote URLs configured through `instructions`, and refresh them when configuration changes. ([#55539](https://github.com/anomalyco/opencode/pull/55539))
- Honor `OPENCODE_DISABLE_CLAUDE_CODE` and `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` when discovering `.claude` skills. ([#55774](https://github.com/anomalyco/opencode/pull/55774))
- Publish a configuration schema that accepts both V1 and V2 configuration shapes during migration. ([#55524](https://github.com/anomalyco/opencode/pull/55524))
- Remove the retired session-sharing backend and unavailable `/share` command. ([#55716](https://github.com/anomalyco/opencode/pull/55716))

#### Bug fixes

- Use protocol-specific inference endpoints for OpenCode providers and accept `null` namespaces in Responses API function calls. ([#55680](https://github.com/anomalyco/opencode/pull/55680), [#55631](https://github.com/anomalyco/opencode/pull/55631))
- Fit compaction output limits to the request actually sent. ([#55613](https://github.com/anomalyco/opencode/pull/55613))
- Restore authenticated TinyFish web search by initializing its MCP session. Thanks [@terry-an-investor](https://github.com/terry-an-investor). ([#54730](https://github.com/anomalyco/opencode/pull/54730))
- Improve MCP compatibility by skipping unsupported catalog and codemode calls, advertising spec-compliant elicitation capabilities, and accepting `*.localhost` OAuth token endpoints. Thanks [@tsehla42](https://github.com/tsehla42) and [@donbowman](https://github.com/donbowman). ([#55474](https://github.com/anomalyco/opencode/pull/55474), [#55618](https://github.com/anomalyco/opencode/pull/55618), [#53196](https://github.com/anomalyco/opencode/pull/53196), [#55627](https://github.com/anomalyco/opencode/pull/55627))
- Treat empty provider and model names as omitted, and substitute an empty value for missing configuration-file references. ([#55465](https://github.com/anomalyco/opencode/pull/55465), [#55388](https://github.com/anomalyco/opencode/pull/55388))
- Default the Windows background service to port `45278`. ([#55547](https://github.com/anomalyco/opencode/pull/55547))

### TUI

#### Improvements

- Open `/diff` beside the current session by default, retain state when toggling full screen with `f`, and adapt the file tree and patch layout to terminal width. ([#47152](https://github.com/anomalyco/opencode/pull/47152), [#55574](https://github.com/anomalyco/opencode/pull/55574), [#55780](https://github.com/anomalyco/opencode/pull/55780))

#### Bug fixes

- Show `/fork`’s pending view reliably and keep it aligned with the file list. ([#55746](https://github.com/anomalyco/opencode/pull/55746), [#55751](https://github.com/anomalyco/opencode/pull/55751))
- Correct spacing and inactive key-hint styling in the docked diff panel. ([#55452](https://github.com/anomalyco/opencode/pull/55452), [#55467](https://github.com/anomalyco/opencode/pull/55467))

### Desktop

#### Improvements

- Show each completed turn’s changed files, line counts, and expandable diffs when **Settings → Preferences → Timeline → Changed files** is enabled. ([#55064](https://github.com/anomalyco/opencode/pull/55064))
- Navigate session tabs with **Option+↑/↓**, or add **Shift** to jump to the previous or next unread tab. ([#54277](https://github.com/anomalyco/opencode/pull/54277))
- Display delegations from the iOS app as **Voice** messages. ([#54426](https://github.com/anomalyco/opencode/pull/54426))

#### Bug fixes

- Open PowerShell in the selected project directory on Windows. ([#55710](https://github.com/anomalyco/opencode/pull/55710))
- Keep project settings accessible when the project folder is missing. ([#55553](https://github.com/anomalyco/opencode/pull/55553))
- Show the requested URL while `webfetch` is running. ([#55590](https://github.com/anomalyco/opencode/pull/55590))

### Extensions

#### Bug fixes

- Include MCP tool input as `metadata.input` in permission requests, allowing permission hooks to inspect the proposed call. Thanks [@lu-zero](https://github.com/lu-zero). ([#51062](https://github.com/anomalyco/opencode/pull/51062))

## v2.0.29 — 2026-10-14

### Highlights

- **Remote Device Pairing**: In **Settings → Pairing**, select **Pair device** to enable OpenTunnel remote access and get a QR code or copyable link. ([#55306](https://github.com/anomalyco/opencode/pull/55306))
- **Provider Account Management**: Use the connect dialog or **Settings → Providers** to switch, rename, remove, or add provider accounts. ([#54101](https://github.com/anomalyco/opencode/pull/54101))
- **Automatic Response Continuation**: Responses that reach their output-token limit now continue automatically, preserving partial output instead of stopping abruptly. ([#53876](https://github.com/anomalyco/opencode/pull/53876))
- **Trackpad Image Navigation**: Pinch to zoom and use two-finger scrolling to pan image and SVG previews. Select **Fit** to reset the view. ([#54590](https://github.com/anomalyco/opencode/pull/54590))

### Core

#### Improvements

- Automatically continue responses after an output-token limit, with bounded retries and clearer recovery for truncated tool calls. ([#53876](https://github.com/anomalyco/opencode/pull/53876))
- Stabilize access policies under the top-level `policies` configuration key while retaining compatibility with `experimental.policies`. ([#55297](https://github.com/anomalyco/opencode/pull/55297))

#### Bug fixes

- Give centrally managed configuration precedence over local and user configuration. ([#55267](https://github.com/anomalyco/opencode/pull/55267))
- Allow migrated V1 npm provider configuration to target built-in provider routes. ([#55254](https://github.com/anomalyco/opencode/pull/55254))

### TUI

#### Improvements

- Report working sessions and sessions awaiting permission or input through terminal program-status notifications. ([#55172](https://github.com/anomalyco/opencode/pull/55172))

### Desktop

#### Improvements

- Pair devices from **Settings → Pairing** through OpenTunnel remote access, with a QR code and copyable link. ([#55306](https://github.com/anomalyco/opencode/pull/55306))
- Manage provider accounts from the connect dialog and **Settings → Providers**, including switching, renaming, removal, and adding another account. ([#54101](https://github.com/anomalyco/opencode/pull/54101))
- Show session context tokens and accumulated family cost in the session view. ([#53785](https://github.com/anomalyco/opencode/pull/53785))
- Pinch to zoom and use two-finger scrolling to pan image and SVG previews; select **Fit** to reset. ([#54590](https://github.com/anomalyco/opencode/pull/54590))
- Cycle side-panel tabs with the configured previous-tab and next-tab shortcuts while the side panel is focused. ([#54899](https://github.com/anomalyco/opencode/pull/54899))
- Refresh the question composer and clarify timeline notices that apply only to a model variant. ([#54822](https://github.com/anomalyco/opencode/pull/54822), [#54880](https://github.com/anomalyco/opencode/pull/54880))
- Refine diff colors and move unread indicators into session tabs. ([#52551](https://github.com/anomalyco/opencode/pull/52551), [#53570](https://github.com/anomalyco/opencode/pull/53570))

#### Bug fixes

- Show steered messages as pending immediately and render inline attachments before their server echo arrives. ([#55251](https://github.com/anomalyco/opencode/pull/55251), [#54650](https://github.com/anomalyco/opencode/pull/54650))
- Preserve raw media data up to 256 MiB so artifact previews remain available. ([#55018](https://github.com/anomalyco/opencode/pull/55018))
- Retain session model selections when the model catalog refreshes. ([#54481](https://github.com/anomalyco/opencode/pull/54481))
- Close browser tabs from the address field and suppress incorrect missing-file notices for restored or already-open tabs. ([#54501](https://github.com/anomalyco/opencode/pull/54501), [#55022](https://github.com/anomalyco/opencode/pull/55022))
- Prevent a project-store eviction loop during launch and remove hover gaps between vertical tabs. ([#55078](https://github.com/anomalyco/opencode/pull/55078), [#54866](https://github.com/anomalyco/opencode/pull/54866))

### SDK

#### Improvements

- Export `lastAssistantWithUsage` from the Solid client to consistently locate the assistant step that determines current context usage. ([#53785](https://github.com/anomalyco/opencode/pull/53785))

#### Bug fixes

- Include all paginated child sessions when loading a session family for usage totals. ([#53785](https://github.com/anomalyco/opencode/pull/53785))
- Admit inline data-URL files into optimistic pending messages so attachments render immediately. ([#54650](https://github.com/anomalyco/opencode/pull/54650))

### Extensions

#### Improvements

- Add `ctx.permission.assert` for Effect and Promise plugins, allowing plugins to use configured permission rules and the native approval prompt. ([#54930](https://github.com/anomalyco/opencode/pull/54930))

#### Bug fixes

- Use Figma's public endpoint and default OAuth configuration, and support Git installations and development releases. ([#55252](https://github.com/anomalyco/opencode/pull/55252), [#55304](https://github.com/anomalyco/opencode/pull/55304))
- Resolve the Figma plugin peer dependency from its workspace. ([#55269](https://github.com/anomalyco/opencode/pull/55269))
- Associate each rejected Promise hook with its own tool call. Thanks [@1052326311](https://github.com/1052326311). ([#55263](https://github.com/anomalyco/opencode/pull/55263))

## v2.0.28 — 2026-10-13

### Highlights

- **Per-Project Auto-Accept**: Set **Settings → Projects → Auto-accept permissions** to override the default for one project. You can also press `mod+shift+a` in a session. ([#54839](https://github.com/anomalyco/opencode/pull/54839))
- **Release Highlights in the TUI**: After updating, the home screen shows the release highlights once. Run `/highlights` to reopen them, or disable automatic display with `highlights: false` in `cli.json`. ([#54969](https://github.com/anomalyco/opencode/pull/54969))
- **Native Windows ARM64 Support**: Windows ARM64 downloads, CLI installs, and desktop updates now use native ARM64 builds instead of x64 emulation. ([#54689](https://github.com/anomalyco/opencode/pull/54689), [#54971](https://github.com/anomalyco/opencode/pull/54971))
- **Continuous Gemini Responses**: Long Gemini and Vertex Gemini responses split by the provider now continue automatically as one response, including recovery from a dropped stream after a continuation checkpoint. ([#55056](https://github.com/anomalyco/opencode/pull/55056))
- **Official WinGet Packages**: Install V2 with `winget install --id Anomaly.OpenCode -e` or `winget install --id Anomaly.OpenCode.Desktop -e`. OpenCode upgrades WinGet installations through WinGet. ([#54808](https://github.com/anomalyco/opencode/pull/54808))

### Core

#### Improvements

- Continued split Gemini and Vertex Gemini responses automatically using provider continuation tokens. ([#55056](https://github.com/anomalyco/opencode/pull/55056))
- Added `settings.encoding` with `zstd`, `gzip`, and `none` values for provider, model, and variant HTTP request bodies. ChatGPT authentication defaults to Zstandard compression when no custom `baseURL` is set. Thanks [@esafak](https://github.com/esafak). ([#54932](https://github.com/anomalyco/opencode/pull/54932))
- Added provider-level compatibility defaults and `compatibility.cacheFormat` for Anthropic- and Alibaba-style prompt-cache markers. ([#54911](https://github.com/anomalyco/opencode/pull/54911), [#54945](https://github.com/anomalyco/opencode/pull/54945))
- Added official WinGet packages and WinGet-aware upgrade and uninstall support. ([#54808](https://github.com/anomalyco/opencode/pull/54808))
- Raised the default streamed-chunk timeout from 5 to 15 minutes for models that pause while reasoning. ([#55032](https://github.com/anomalyco/opencode/pull/55032))

#### Bug fixes

- Disabled Bun’s fetch idle timeout for provider requests, preventing long-running streams from ending early. ([#55007](https://github.com/anomalyco/opencode/pull/55007))
- Preserved mixed CRLF and LF line endings when the edit tool changes files. ([#53166](https://github.com/anomalyco/opencode/pull/53166))
- Preserved unknown V1 OpenAI-compatible model options in migrated request bodies. ([#54694](https://github.com/anomalyco/opencode/pull/54694))
- Stopped querying Azure resources during startup; Azure connections now ask for the resource name directly. ([#54870](https://github.com/anomalyco/opencode/pull/54870))
- Loaded the system configuration directory at the lowest precedence. Thanks [@rntdrts](https://github.com/rntdrts). ([#54921](https://github.com/anomalyco/opencode/pull/54921))
- Installed the native CLI and extracted ripgrep without PowerShell on Windows ARM64. ([#54955](https://github.com/anomalyco/opencode/pull/54955), [#54981](https://github.com/anomalyco/opencode/pull/54981))

### TUI

#### Improvements

- Added the post-update highlights dialog, `/highlights`, and the `highlights` alert setting. ([#54969](https://github.com/anomalyco/opencode/pull/54969))

#### Bug fixes

- Restricted slash-command autocomplete to the start of the prompt. Thanks [@OpeOginni](https://github.com/OpeOginni). ([#54857](https://github.com/anomalyco/opencode/pull/54857))
- Reported x64 emulation correctly when the TUI runs on Windows ARM64. ([#54984](https://github.com/anomalyco/opencode/pull/54984))
- Removed the stale `todowrite` label from tool output. ([#53966](https://github.com/anomalyco/opencode/pull/53966))

### Desktop

#### Improvements

- Added per-project auto-accept permission overrides under **Settings → Projects**, with `mod+shift+a` controlling the current project. ([#54839](https://github.com/anomalyco/opencode/pull/54839))
- Added a native **Windows (ARM64)** option to the download page. ([#54971](https://github.com/anomalyco/opencode/pull/54971))

#### Bug fixes

- Bundled native ARM64 terminal and CLI binaries in Windows ARM64 desktop builds, and moved emulated x64 installations to native ARM64 updates. Thanks [@mweinbach](https://github.com/mweinbach). ([#54689](https://github.com/anomalyco/opencode/pull/54689), [#54983](https://github.com/anomalyco/opencode/pull/54983))
- Included subagent sessions in displayed session costs. ([#55052](https://github.com/anomalyco/opencode/pull/55052))
- Loaded image and audio attachments in the review panel and opened video previews in an in-window theatre view. ([#55015](https://github.com/anomalyco/opencode/pull/55015), [#54696](https://github.com/anomalyco/opencode/pull/54696))
- Showed submitted prompts immediately and kept the **Working** marker above undelivered steers. ([#54047](https://github.com/anomalyco/opencode/pull/54047), [#55023](https://github.com/anomalyco/opencode/pull/55023))
- Fixed tab closing when collapsed side-panel tabs exist and restored focus correctly after stacked dialogs close. ([#54695](https://github.com/anomalyco/opencode/pull/54695), [#55038](https://github.com/anomalyco/opencode/pull/55038))

### SDK

#### Improvements

- Added request-body encoding and model/provider cache-format fields to generated client types. ([#54932](https://github.com/anomalyco/opencode/pull/54932), [#54945](https://github.com/anomalyco/opencode/pull/54945))
- Exported `CredentialApi` from the Promise client API. ([#52797](https://github.com/anomalyco/opencode/pull/52797))

### Extensions

#### Improvements

- Added an optional official Figma plugin with its MCP connection and six bundled Figma skills. ([#55049](https://github.com/anomalyco/opencode/pull/55049), [#55061](https://github.com/anomalyco/opencode/pull/55061))
- Exposed `credential.activate` to Effect and Promise server plugins. Thanks [@remorses](https://github.com/remorses). ([#52797](https://github.com/anomalyco/opencode/pull/52797))

#### Bug fixes

- Converted rejected Promise-based plugin tools into normal tool failures instead of crashing their execution path. ([#54913](https://github.com/anomalyco/opencode/pull/54913))
- Fixed the VS Code extension launching the V2 CLI with the removed `--port` argument. Thanks [@uyencss](https://github.com/uyencss). ([#49084](https://github.com/anomalyco/opencode/pull/49084))

## v2.0.27 — 2026-10-12

### Highlights

- **Built-In Worktree Tools**: Ask OpenCode to use `worktree_create`, `worktree_list`, and `worktree_remove` in Code Mode. You can create isolated worktrees, move sessions into them, and remove them with normal edit approval. ([#53981](https://github.com/anomalyco/opencode/pull/53981))
- **Safer Remote Pairing**: The first `opencode pair --remote` now warns that it will expose your server and asks for confirmation. For non-interactive use, pass `opencode pair --remote --yes`. ([#54561](https://github.com/anomalyco/opencode/pull/54561))
- **Installable Web App**: Use Chrome or Edge’s **Install** button to install the OpenCode web app, including when it runs behind an authenticating proxy. ([#53905](https://github.com/anomalyco/opencode/pull/53905))
- **Clear Session Failures**: Desktop and TUI timelines now show execution errors that happen before or between model steps instead of ending without an explanation. ([#53826](https://github.com/anomalyco/opencode/pull/53826))
- **Automatic Project Cleanup**: Projects whose directories no longer exist are automatically hidden from the project list. Opening the directory again restores the project. ([#54354](https://github.com/anomalyco/opencode/pull/54354))

### Core

#### Improvements

- Added the built-in Code Mode tools `opencode.worktree_create`, `opencode.worktree_list`, and `opencode.worktree_remove`. Removing a worktree requires edit approval, and `force: true` can discard modified or untracked files. ([#53981](https://github.com/anomalyco/opencode/pull/53981))
- Added confirmation before `opencode pair --remote` first enables internet access, plus `--yes`/`-y` for scripts and other non-interactive use. ([#54561](https://github.com/anomalyco/opencode/pull/54561))
- Automatically archived projects when all known directories disappear. Reopening a project restores it, while surviving clones and linked worktrees keep it active. ([#54354](https://github.com/anomalyco/opencode/pull/54354))
- Raised the ChatGPT OAuth input limit for `gpt-6.1-sol` and `gpt-6.1-sol-fast` to 500,000 tokens. ([#54668](https://github.com/anomalyco/opencode/pull/54668))
- Added Vertex AI routes for Interactions and Mistral models. ([#54175](https://github.com/anomalyco/opencode/pull/54175), [#54058](https://github.com/anomalyco/opencode/pull/54058))

#### Bug fixes

- Fixed updater detection for symlinked home directories and package-manager installations, increased probe timeouts, and now report unavailable updates clearly when the installation method cannot be detected. ([#54609](https://github.com/anomalyco/opencode/pull/54609), [#54622](https://github.com/anomalyco/opencode/pull/54622), [#54672](https://github.com/anomalyco/opencode/pull/54672))
- Fixed GitHub Copilot routing for Gemini, Anthropic, and Responses models when live model metadata is unavailable, and accepted interleaved Claude reasoning values. ([#54208](https://github.com/anomalyco/opencode/pull/54208), [#54210](https://github.com/anomalyco/opencode/pull/54210), [#54201](https://github.com/anomalyco/opencode/pull/54201))
- Fixed Google Vertex Application Default Credentials when `CLOUDSDK_CONFIG` points to a custom gcloud configuration directory. Thanks [@H-Max](https://github.com/H-Max). ([#54164](https://github.com/anomalyco/opencode/pull/54164))
- Prevented ChatGPT token-sharing sessions from sending unsupported mid-session reasoning-effort updates. ([#54085](https://github.com/anomalyco/opencode/pull/54085))
- Blocked `file://` access through Code Mode’s `fetch`, which now returns a clear filesystem-access error. Thanks [@ferdinandyb](https://github.com/ferdinandyb). ([#54510](https://github.com/anomalyco/opencode/pull/54510))
- Fixed remote workspace file operations so driver-provided filesystem overrides are used correctly.
- Preserved subagent notifications when location services are evicted, and propagated well-known configuration updates across locations with bounded HTTP timeouts. ([#54072](https://github.com/anomalyco/opencode/pull/54072), [#53821](https://github.com/anomalyco/opencode/pull/53821))

### TUI

#### Bug fixes

- Displayed session execution failures that occur before or between model steps directly in the timeline. ([#53826](https://github.com/anomalyco/opencode/pull/53826))
- Preserved a saved session’s unavailable model selection instead of silently replacing it with a fallback. ([#53822](https://github.com/anomalyco/opencode/pull/53822))
- Added syntax highlighting for C++ module interface files such as `.cppm`, `.ixx`, and `.cxxm`. ([#53853](https://github.com/anomalyco/opencode/pull/53853))
- Summarized integrations with multiple credentials as a connection count, preventing long labels from crowding the integration name. ([#54054](https://github.com/anomalyco/opencode/pull/54054))

### Desktop

#### Improvements

- Made the web app installable from Chrome and Edge, including deployments behind cookie-based authenticating proxies. ([#53905](https://github.com/anomalyco/opencode/pull/53905))
- Updated the session column layout and text wrapping for clearer long content. ([#54020](https://github.com/anomalyco/opencode/pull/54020))

#### Bug fixes

- Displayed session execution failures that occur before or between model steps directly in the timeline. ([#53826](https://github.com/anomalyco/opencode/pull/53826))
- Fixed command-palette selection so newly arriving higher-ranked results become active until you explicitly choose a result. ([#54275](https://github.com/anomalyco/opencode/pull/54275))
- Preserved bold, code, emphasis, and strike-through formatting inside Markdown link labels. ([#54451](https://github.com/anomalyco/opencode/pull/54451))
- Fixed timeline file links and complete patch rendering, including unusual filenames and patches whose original alignment can be reused. ([#53641](https://github.com/anomalyco/opencode/pull/53641), [#54017](https://github.com/anomalyco/opencode/pull/54017))
- Showed complete tool error text when an error is expanded. ([#53816](https://github.com/anomalyco/opencode/pull/53816))
- Fixed browser-panel controls, page visibility, corner masks, and closed side-region overlays. ([#53907](https://github.com/anomalyco/opencode/pull/53907), [#54038](https://github.com/anomalyco/opencode/pull/54038), [#52461](https://github.com/anomalyco/opencode/pull/52461), [#54052](https://github.com/anomalyco/opencode/pull/54052))
- Made the third-party notices dialog scrollable. ([#53911](https://github.com/anomalyco/opencode/pull/53911))

### SDK

#### Improvements

- Added startup plugin seeding to Effect embedded hosts and workerd through `OpenCode.create({ plugins })` and `OpenCodeWorkerd.create({ plugins })`.
- Re-exported `WorkspaceDriver`, `EnvironmentDriver`, and `EnvironmentFiles` from `@opencode/sdk/effect`.

#### Bug fixes

- Ensured embedded hosts activate supplied plugins before model discovery, generation, and recovery begin. ([#54219](https://github.com/anomalyco/opencode/pull/54219))

### Extensions

#### Improvements

- Extended `BridgeLayout` with viewport dimensions and optional border information so native extension surfaces can track window resizing and preserve rounded card borders.

#### Bug fixes

- Kept desktop browser-panel corner masks and borders aligned while resizing or using custom themes. ([#52461](https://github.com/anomalyco/opencode/pull/52461))
- Kept the browser site button clickable after the embedded page takes focus. ([#53907](https://github.com/anomalyco/opencode/pull/53907))

## v2.0.26 — 2026-10-08

### Highlights

- **Google Cloud Credentials for Vertex**: Run `/connect`, choose **Vertex**, then select **Google Cloud credentials (gcloud auth or environment)** to use Application Default Credentials. You can choose or enter the Google Cloud project and location. ([#53798](https://github.com/anomalyco/opencode/pull/53798))
- **Faster, Safer Session Snapshots**: Session snapshots now add less overhead, recover from interrupted or concurrent captures, restore large selections faster, and pack stored objects to reduce disk usage. ([#51996](https://github.com/anomalyco/opencode/pull/51996))
- **Working Transcript Links**: You can click links anywhere in a transcript, including any row of a wrapped URL. Hyperlinks also work in more terminals, and `FORCE_HYPERLINK=1` can enable them when automatic detection does not. ([#53903](https://github.com/anomalyco/opencode/pull/53903), [#53904](https://github.com/anomalyco/opencode/pull/53904))
- **Step 5 Preview Free**: You can now select **Step 5 Preview Free** from OpenCode’s free model lineup for a limited time.

### Core

#### Improvements

- Added **Google Cloud credentials (gcloud auth or environment)** to the Vertex connection flow, with project and location choices discovered from environment variables, gcloud configurations, and Application Default Credentials. ([#53798](https://github.com/anomalyco/opencode/pull/53798))
- Reduced session snapshot overhead, accelerated multi-file restores, made capture resilient to crashes and concurrent processes, and added lossless background packing of snapshot objects. ([#51996](https://github.com/anomalyco/opencode/pull/51996))
- Added **Step 5 Preview Free** to OpenCode’s free models for a limited time and removed the retired **Fledge Alpha Free** listing.

#### Bug fixes

- Prevented working-tree diffs from timing out or stalling the server in repositories with many untracked files by batching Git operations. ([#53449](https://github.com/anomalyco/opencode/pull/53449))
- Fixed large revert selections failing when their paths exceeded the operating system’s command-line limit. ([#53956](https://github.com/anomalyco/opencode/pull/53956))
- Fixed snapshot and undo handling for literal filenames containing Git pathspec characters, corrupted or locked snapshot indexes, concurrent captures, and project directories whose names begin with `..`. ([#51996](https://github.com/anomalyco/opencode/pull/51996))
- Changed `opencode service` remote-access URLs to use a persistent random subdomain rather than a predictable route. Disabling and re-enabling remote access generates a new address. ([#53962](https://github.com/anomalyco/opencode/pull/53962))

### TUI

#### Improvements

- Enabled OSC 8 hyperlinks in more terminals, including VS Code and other xterm.js terminals, Zed, mintty, and newer VTE terminals; `FORCE_HYPERLINK=1` now overrides terminal detection. ([#53904](https://github.com/anomalyco/opencode/pull/53904))

#### Bug fixes

- Fixed transcript links not opening when clicked, including URLs wrapped across multiple rows. ([#53903](https://github.com/anomalyco/opencode/pull/53903))
- Kept activity summaries in place when expanding or collapsing details with `session.verbosity: "low"`. ([#52357](https://github.com/anomalyco/opencode/pull/52357))
- Prevented the home-screen version footer from overlapping keyboard hints in short terminals. Thanks [@fihaaade](https://github.com/fihaaade). ([#53891](https://github.com/anomalyco/opencode/pull/53891))
