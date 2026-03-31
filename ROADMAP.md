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
- [ ] **12. Jupyter Notebook Integration (NotebookEditTool)**
  Add a dedicated tool specifically for reading, manipulating, and executing Jupyter Notebook (`.ipynb`) cells directly as JSON without breaking the file structure.
- [ ] **13. Safe Git Sandboxing (EnterWorktreeTool / ExitWorktreeTool)**
  Allow the agent to autonomously spawn a temporary Git Worktree (an isolated clone of the repo), do experimental coding there, test it, and only merge it back if it works.
- [ ] **14. Background Task Orchestration (TaskCreateTool, TaskUpdateTool, TaskOutputTool)**
  Allow the agent to kick off long-running terminal commands (like `npm run build` or `pytest`), push them to the background, and periodically check their status without blocking the chat UI.
- [ ] **15. Context Window Management (SnipTool & BriefTool)**
  Implement `SnipTool` to autonomously permanently delete useless messages from the middle of the context window, and `BriefTool` to replace debugging loops with a 2-sentence summary.
- [ ] **16. Scheduled & Remote Triggers (ScheduleCronTool & RemoteTriggerTool)**
  Allow the agent to create cron jobs to wake itself up, or expose a local webhook so external services can ping it to start working.
- [ ] **17. System Monitoring (MonitorTool)**
  Allow the agent to read CPU, memory usage, and active processes to diagnose system crashes or performance issues.
