# OpenCode Feature Roadmap (Claude Code Parity)

This roadmap is now ordered by practical product priority rather than original discovery order.

Priority rules:

- ship core parity and workflow leverage first
- prefer features that improve agent reliability, autonomy, and context handling
- push novelty/UI features later unless they unlock core usage

## Phase 1: Core Foundations — shipped

- [x] **1. Native Desktop Control (Computer Use Tool)**
      Integrate `@nut-tree/nut-js` for native OS control: mouse movement, keystrokes, and screen capture outside the terminal.
- [x] **2. Headless Browser Automation (WebBrowserTool)**
      Integrate Playwright to navigate SPAs, execute JavaScript, click buttons, and read post-rendered DOM.
- [x] **3. Dynamic Agent Swarms (SpawnMultiAgentTool)**
      Implement Bun background workers so the main thread can spawn independent sub-agents for parallel task execution.
- [x] **4. Long-Term Semantic Memory (SessionMemory)**
      Persist user preferences, project architecture rules, and other reusable context across sessions.
- [x] **5. Strict Zod-Based Permission Gates (PermissionRouter)**
      Add strict tool validation plus read-only / destructive classification and automated risk assessment.

## Phase 2: Highest-Priority Remaining Parity

- [!] **6. Context Window Management (BriefTool / SnipTool / context inspection)**
  `brief` and safe `snip` are in flight/partially implemented. Remaining work: true context inspection, better visibility into token-heavy history, and any additional safe compaction controls.
- [x] **7. Safe Git Sandboxing (EnterWorktreeTool / ExitWorktreeTool)**
      Let the agent spawn and tear down temporary Git worktrees for isolated experimentation.
- [x] **8. Background Task Orchestration**
      Support long-running background commands without blocking chat flows.
- [ ] **9. Scheduled & Remote Triggers (ScheduleCronTool / RemoteTriggerTool)**
      Let the agent wake itself up on a schedule or be triggered by local webhooks/external events.
- [ ] **10. Remote Control & Sessions**
      Continue sessions from phone/browser, remotely control a running local agent, and attach to active work without being at the terminal.
- [ ] **11. Dispatch / Handoff / Remote Runners**
      Spin up new remote or background instances, hand off work to durable runners, and retrieve results later without actively driving the session.
- [ ] **12. Bridge / Remote Control & Peer Discovery**
      Improve `opencode attach` with peer discovery and easier shared environment access.
- [ ] **13. SSH Remote Support**
      Work on remote machines over SSH with full tool support.
- [ ] **14. Direct Connect**
      Peer-to-peer remote collaboration/control without going through hosted services.
- [ ] **15. Self-Hosted Runner Support**
      Deploy agents onto self-hosted infrastructure for enterprise and always-on workflows.
- [ ] **16. System Monitoring (MonitorTool)**
      Read CPU, memory, disk usage, and active processes to diagnose crashes, hangs, and resource issues.
- [ ] **17. WorkflowTool**
      Allow reusable workflow scripts that compose multiple tool calls into a single repeatable command.
- [ ] **18. TerminalCaptureTool**
      Capture and analyze terminal output as a first-class debugging/context surface.
- [ ] **19. CtxInspectTool (ContextCollapse)**
      Inspect the current context window, explain what is consuming tokens, and help the agent decide what to compact.

## Phase 3: Proactive Agent Platform

- [ ] **20. KAIROS & Daemon Mode (Proactive Agent)**
      Turn `--serve` into a true daemon that wakes up, checks for work, and proactively opens review/work sessions.
- [ ] **21. Auto-Dream & AFK Mode**
      Run idle-time memory consolidation and session review without burning active chat tokens.
- [ ] **22. Background Sessions (BG Sessions)**
      Allow sessions to run fully in the background without a live TUI attached.
- [ ] **23. Specialized Modes (/advisor, /bughunter, /teleport, /ultraplan)**
      Add high-leverage command modes for review, bug hunting, handoff, and heavier planning loops.
- [ ] **24. TeamCreateTool / TeamDeleteTool**
      Create and manage named agent teams for coordinated swarming.
- [ ] **25. Coordinator Mode**
      Add a worker registry and stronger orchestration model for long-running multi-agent execution.
- [ ] **26. Team Memory (TeamMem)**
      Shared memory files and synchronization for teams operating on the same project.

## Phase 4: Remote, Collaboration, and Reach

- [ ] **27. RemoteTriggerTool integrations**
      Tighten integration points with GitHub, Slack, and similar event sources once local triggers exist.
- [ ] **28. Mobile Companion Support**
      QR flow and mobile control/mirroring support.
- [ ] **29. Chrome Extension Integration**
      Browser-surface integration for web-based workflows.

## Phase 5: UX Modes and Interface Surface Area

- [ ] **30. Voice Mode / /voice**
      Speech-to-text input and text-to-speech output.
- [ ] **31. /brief UI mode**
      Toggle a brief-only transcript layout instead of full tool-output-heavy views.
- [ ] **32. Buddy (Virtual Pet) / /buddy**
      ASCII companion that reacts to confidence and execution events.
- [ ] **33. /proactive and /assistant**
      User-facing controls for enabling proactive behavior and assistant-mode interaction models.
- [ ] **34. /torch**
      Profiling/debugging-oriented command for understanding slow operations.

## Phase 6: Platform Completeness / Lower-Leverage Extensions

- [ ] **35. PowerShellTool**
      Full Windows-native PowerShell support with permission and safety parity.
- [ ] **36. Context7 Integration for Libraries**
      Deep documentation lookup using Context7-compatible IDs.
- [ ] **37. AST-Grep Integration**
      Native AST-based search and refactoring across many languages.
- [ ] **38. MCP Rich Output**
      Better rendering for images, formatted results, and interactive MCP payloads.
- [ ] **39. Commit Attribution**
      Track which agent produced which changes in git history.
- [ ] **40. Sandboxed Execution Mode**
      Stronger execution isolation for risky/untrusted code paths.
- [ ] **41. Template System**
      Project scaffolding and reusable templates.
- [ ] **42. Reactive Compact**
      More dynamic context compaction based on real usage patterns.
- [ ] **43. Verification Agent**
      Built-in verification-agent guidance for task/todo workflows.
- [ ] **44. Extract Memories**
      Post-query learning hooks for automatic memory extraction.
- [ ] **45. Cached Microcompact**
      Persist microcompact state through query and API flows.

## Current Priority Order (short version)

1. Finish Context Window Management
2. Add Scheduled & Remote Triggers
3. Add Remote Control & Sessions
4. Add Dispatch / Handoff / Remote Runners
5. Add System Monitoring
6. Build WorkflowTool + TerminalCaptureTool
7. Build KAIROS / daemon / AFK platform
8. Add voice / buddy / secondary UX surfaces

## Notes

- `brief`, safe `snip`, worktree sandboxing, and background task orchestration have already begun shifting Phase 2 upward in practical priority.
- Remote work is now split into two features: **Remote Control & Sessions** for driving a live session from afar, and **Dispatch / Handoff / Remote Runners** for sending work away to durable background or remote execution contexts.
- Duplicate roadmap entries were collapsed into one canonical location each.
- Novelty features are intentionally later than workflow, reliability, and autonomy features.

## Legend

- [x] Implemented
- [ ] Not yet implemented
- [!] Partially implemented / in flight
