# OpenCode Feature Roadmap (Claude Code Parity)

This roadmap outlines the 11 major features required to bring OpenCode up to parity with the leaked Claude Code capabilities. Features will be implemented in order.

## Phase 1: Core Agentic Capabilities

- [x] **1. Native Desktop Control (Computer Use Tool)**
      Integrate `@nut-tree/nut-js` to replicate Anthropic's private `@ant/computer-use-swift`. Enables native OS control: mouse movement, keystrokes, and screen capture outside the terminal.
- [x] **2. Headless Browser Automation (WebBrowserTool)**
      Integrate Playwright to allow OpenCode to navigate SPAs, execute JavaScript, click buttons, and read post-rendered DOM (closing the gap with `webfetch`/`websearch`).
- [x] **3. Dynamic Agent Swarms (SpawnMultiAgentTool)**
      Implement Bun's native background workers to allow the main thread to spawn independent sub-agents for parallel task execution across multiple files or directories.
- [x] **4. Long-Term Semantic Memory (SessionMemory)**
      Implement a local SQLite vector store/database to persist user preferences, project architecture rules, and API keys across different terminal sessions.
- [x] **5. Strict Zod-Based Permission Gates (PermissionRouter)**
      Implement a strict Zod schema layer for tool validation and a permission router with flags (`isReadOnly`, `isDestructive`). Add a secondary LLM classifier for automated risk assessment.

## Phase 2: Experimental & Background Systems

- [ ] **6. Buddy (Virtual Pet)**
      Add a React/Ink component for an ASCII companion (duck, dragon, axolotl) that sits beside input and reacts dynamically to LLM confidence scores or bash success/failure rates.
- [ ] **7. Auto-Dream & AFK Mode**
      Add an idle timer that spawns a background worker to consolidate session memory and review past context without burning active tokens while the user is away.
- [ ] **8. KAIROS & Daemon Mode (Proactive Agent)**
      Extend the existing `--serve` headless mode into a true daemon that uses `cron` to wake up, fetch GitHub PRs, and proactively open review sessions.
- [ ] **9. Voice Mode**
      Integrate local Whisper (or API) for speech-to-text input, and TTS for terminal audio output.
- [ ] **10. Bridge / Remote Control & Peer Discovery**
      Enhance the existing `opencode attach` with mDNS broadcasting to allow Unix domain socket peer discovery and remote desktop environment sharing.
- [ ] **11. Specialized Modes (/advisor, /bughunter, /teleport)**
      Add new slash commands. Implement `/advisor` by wrapping LLM diff outputs in an evaluation loop with a secondary model for QA grading.

## Phase 3: Advanced Workflows & Context Management

- [x] **12. Safe Git Sandboxing (EnterWorktreeTool / ExitWorktreeTool)**
      Allow the agent to autonomously spawn a temporary Git Worktree (an isolated clone of the repo), do experimental coding there, test it, and only merge it back if it works.
- [x] **13. Background Task Orchestration (TaskCreateTool, TaskUpdateTool, TaskOutputTool)**
      Allow the agent to kick off long-running terminal commands (like `npm run build` or `pytest`), push them to the background, and periodically check their status without blocking the chat UI.
- [ ] **14. Context Window Management (SnipTool & BriefTool)**
      Implement `SnipTool` to autonomously permanently delete useless messages from the middle of the context window, and `BriefTool` to replace debugging loops with a 2-sentence summary.
- [ ] **15. Scheduled & Remote Triggers (ScheduleCronTool & RemoteTriggerTool)**
      Allow the agent to create cron jobs to wake itself up, or expose a local webhook so external services can ping it to start working.
- [ ] **16. System Monitoring (MonitorTool)**
      Allow the agent to read CPU, memory usage, and active processes to diagnose system crashes or performance issues.

## Phase 4: Missing Tools from Claude Code (High Priority)

Based on analysis of free-code (54 working flags, 34 failed), these tools need implementation:

### Core Tools
- [ ] **17. BriefTool (SendUserMessage)**
      A tool for the agent to send messages directly to the user with optional file attachments. Supports proactive notifications when the user is away. Different from SendMessageTool - this is for brief UI mode.
- [ ] **18. SnipTool (HistorySnip)**
      Tool to permanently remove specific messages from the context window to manage token budget. Different from compaction - this is surgical deletion of useless messages from the middle of context.
- [ ] **19. WorkflowTool**
      Allow users to define reusable workflow scripts that combine multiple tool calls into a single command. Support bundled workflows and user-defined ones.
- [ ] **20. TerminalCaptureTool**
      Capture and analyze terminal output for debugging and context understanding. Part of terminal panel feature.

### System & Monitoring Tools
- [ ] **21. MonitorTool**
      Read system metrics (CPU, memory, disk usage, active processes) to help diagnose performance issues or system crashes.
- [ ] **22. CtxInspectTool (ContextCollapse)**
      Inspect and analyze the current context window state, helping users understand what's taking up tokens.

### Agent Team Management
- [ ] **23. TeamCreateTool / TeamDeleteTool**
      Create and manage named agent teams for swarming. Allows coordinated multi-agent workflows with shared context. Part of agent swarms feature.

### Windows Support
- [ ] **24. PowerShellTool**
      Full PowerShell support on Windows with proper permission handling, read-only validation, and security controls equivalent to BashTool.

### Scheduling & Triggers
- [ ] **25. ScheduleCronTool (CronCreate/CronDelete/CronList)**
      Create, delete, and list cron jobs that can trigger agent actions at scheduled times.
- [ ] **26. RemoteTriggerTool**
      Expose a local webhook endpoint that external services (GitHub, Slack, etc.) can call to trigger agent actions.

## Phase 5: Missing Slash Commands

### Review & Analysis Commands
- [ ] **27. /advisor**
      Configure a secondary "advisor" model that reviews the primary model's outputs for quality and suggests improvements. Wraps LLM diff outputs in an evaluation loop.
- [ ] **28. /bughunter**
      Dedicated bug hunting mode that uses specialized prompts and tools to find security vulnerabilities and bugs.
- [ ] **29. /teleport**
      Transfer the current session to Claude Code on the web (CCR) for continued work in a browser environment. Includes remote session management.
- [ ] **30. /ultraplan**
      Advanced multi-agent planning mode that uses the most powerful model (Opus) to create detailed execution plans. ~10-30 min planning session in CCR.

### Utility Commands
- [ ] **31. /voice**
      Toggle voice mode for speech-to-text input and text-to-speech output. Requires audio backend (native module or SoX fallback).
- [ ] **32. /brief**
      Toggle brief mode - changes the UI to show only brief messages from the agent instead of full tool outputs. Changes default view to 'chat'.
- [ ] **33. /proactive**
      Enable proactive agent behavior - the agent will wake up on schedule to check for work (PRs, issues, etc). Requires AGENT_TRIGGERS flag.
- [ ] **34. /torch**
      Performance profiling and debugging command for analyzing slow operations.
- [ ] **35. /buddy**
      Configure the ASCII companion/virtual pet (duck, dragon, axolotl) that reacts to session events. BUDDY flag.

### Assistant & KAIROS Modes
- [ ] **36. /assistant**
      Enter full KAIROS assistant mode - a different interaction model optimized for long-running background tasks with proactive behavior.
- [ ] **37. /brief command (KAIROS_BRIEF)**
      Enable brief-only transcript layout without the full assistant stack.

## Phase 6: Advanced Features & Infrastructure

- [ ] **38. Context7 Integration for Libraries**
      Deep documentation integration using Context7-compatible library IDs for major frameworks with up-to-date API references.
- [ ] **39. AST-Grep Integration**
      Native AST-based code search and refactoring using ast-grep for pattern matching across 25+ languages.
- [ ] **40. MCP Rich Output**
      Enhanced MCP tool result rendering with support for images, formatted data, and interactive elements.
- [ ] **41. Team Memory (TeamMem)**
      Shared memory files for teams working on the same project, with automatic synchronization via watcher hooks.
- [ ] **42. Background Sessions (BG Sessions)**
      Allow sessions to run fully in the background without a TUI, managed via CLI commands. BG_SESSIONS flag.
- [ ] **43. Commit Attribution**
      Track and attribute which AI agent made specific changes in git history. COMMIT_ATTRIBUTION flag.
- [ ] **44. SSH Remote Support**
      Connect to and work on remote machines via SSH with full tool support. SSH_REMOTE flag.
- [ ] **45. Direct Connect**
      Peer-to-peer connection support for remote collaboration without going through cloud services. DIRECT_CONNECT flag.
- [ ] **46. Mobile Companion Support**
      QR code generation and integration with mobile apps for remote control. CCR_MIRROR, CCR_AUTO_CONNECT support.
- [ ] **47. Chrome Extension Integration**
      `claude-in-chrome` support for browser-based interactions and DOM manipulation.
- [ ] **48. Sandboxed Execution Mode**
      Enhanced sandboxing with optional VM/isolation for untrusted code execution.
- [ ] **49. Self-Hosted Runner Support**
      Deploy agents to self-hosted infrastructure for enterprise use. SELF_HOSTED_RUNNER flag.
- [ ] **50. Template System**
      Project scaffolding and template system for quick project initialization. TEMPLATES flag.
- [ ] **51. Coordinator Mode**
      Advanced multi-agent coordination with worker agent registry. COORDINATOR_MODE flag.
- [ ] **52. Reactive Compact**
      Real-time context compaction based on usage patterns. REACTIVE_COMPACT flag.
- [ ] **53. Web Browser Tool**
      Full browser automation tool distinct from the headless browser - allows user-guided browsing.
- [ ] **54. Verification Agent**
      Built-in verification agent guidance in prompts for task/todo tooling. VERIFICATION_AGENT flag.
- [ ] **55. Extract Memories**
      Post-query memory extraction hooks for automatic learning. EXTRACT_MEMORIES flag.
- [ ] **56. Cached Microcompact**
      Cached microcompact state through query and API flows. CACHED_MICROCOMPACT flag.

## Feature Implementation Notes

### From free-code FEATURES.md Analysis
- **54 flags bundle cleanly** - these are user-facing or behavior-changing features
- **34 flags still fail to bundle** - these require more work to implement
- **Default build includes**: VOICE_MODE (bundles but needs OAuth + audio backend)

### Priority Flags to Implement (Easy Reconstruction)
These have most of the surrounding code already in place:
- `AUTO_THEME` - Missing only `systemThemeWatcher.js`
- `BG_SESSIONS` - Missing only `bg.js` CLI fast-path
- `BUDDY` - Missing only `buddy/index.js` command entry
- `COMMIT_ATTRIBUTION` - Missing only `attributionHooks.js`
- `HISTORY_SNIP` - Missing only `force-snip.js` command
- `MCP_SKILLS` - Missing only `mcpSkills.js` registry layer

### Priority Flags to Implement (Medium-Sized Gaps)
- `BYOC_ENVIRONMENT_RUNNER` - Environment runner main.js
- `CONTEXT_COLLAPSE` - CtxInspectTool implementation
- `COORDINATOR_MODE` - Coordinator worker agent system
- `DAEMON` - Worker registry for true daemon mode
- `DIRECT_CONNECT` - Parse connect URL logic
- `EXPERIMENTAL_SKILL_SEARCH` - Local skill search implementation
- `MONITOR_TOOL` - System monitoring tool
- `REACTIVE_COMPACT` - Reactive compaction service
- `REVIEW_ARTIFACT` - Hunter.js review system
- `SELF_HOSTED_RUNNER` - Self-hosted runner main.js
- `SSH_REMOTE` - SSH session creation
- `TERMINAL_PANEL` - TerminalCaptureTool
- `UDS_INBOX` - UDS messaging utilities
- `WEB_BROWSER_TOOL` - Web browser automation distinct from headless
- `WORKFLOW_SCRIPTS` - Workflow command and task implementation

### Large Missing Subsystems
- `KAIROS` - Full assistant mode with `src/assistant/index.js` stack
- `KAIROS_DREAM` - Dream task behavior for AFK consolidation
- `PROACTIVE` - Proactive task/tool stack for daemon behavior

## Legend

- [x] Implemented
- [ ] Not yet implemented
- [!] Partially implemented / Experimental

## Notes

- Permission system uses Zod schemas with `isReadOnly`/`isDestructive` flags
- All tools should support proper TypeScript types and validation
- Slash commands follow the pattern in `src/commands.ts`
- Feature flags use `feature('FLAG_NAME')` pattern with bun:bundle
- Many experimental features are gated by GrowthBook or environment variables
