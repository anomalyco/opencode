# Cedric Product Improvement Plan

**Date:** June 2026
**Product:** Cedric — The LLM Operating System
**Status:** Foundation Complete, Workspace 90% Built, Agentic Layer 0%

---

## The Big Picture

Cedric has a **solid technical foundation** but is currently stuck between two identities: it's still carrying the OpenCode/OpenKimi DNA while trying to become "Cedric." The workspace tab system is architecturally correct and now has real browser, review, markdown, code, terminal, and Side Chat tabs with persisted tab state. The remaining critical workspace work is Terminal desktop smoke coverage plus Side Chat desktop send/model-response smoke. The agentic vision is well-documented but not implemented.

**The #1 risk:** Users will try Cedric, see "Coming Soon" on core features, and never return.

**The #1 opportunity:** No competitor offers true multi-model + multi-tab + agent-native workspace. If Cedric ships Phase 1 and 2, it leapfrogs Codex, Claude App, and Cursor on flexibility.

---

## Top 10 Improvements (Ranked by Impact/Effort)

### 1. 🚨 Hide Debug Bar in Production (1 hour)
**Impact:** 🔴 Critical | **Effort:** Trivial
This single component makes the app look like a developer toy. One `import.meta.env.DEV` check fixes it.

### 2. 🚨 Complete User-Facing Rebrand (4 hours)
**Impact:** 🔴 Critical | **Effort:** Low
Window title, menu items, HTML title, splash screen. Users must see "Cedric" everywhere.

### 3. 🚨 Polish Side Chat Tab (1-2 days)
**Impact:** 🟠 High | **Effort:** Medium
The Side Chat tab now has real session-backed text conversations, per-tab agent/model/variant controls, browser URL/title handoff, file handoff, and main-chat draft copy. Finish the product layer: desktop send/model-response smoke coverage and a compact session title/status treatment.

### 4. 🔄 Complete Terminal Runtime QA (1 day)
**Impact:** 🟠 High | **Effort:** Low
The workspace terminal is wired to the existing PTY renderer. It still needs a live desktop smoke test before treating it as fully product-verified.

### 5. 🔄 Replace Swarm Tab with Background Tasks (1 week)
**Impact:** 🟠 High | **Effort:** High
The Swarm tab is conceptually wrong. Move it to the left panel as background tasks. This aligns with the vision.

### 6. 🔄 Simplify Chat Composer (2-3 days)
**Impact:** 🟠 High | **Effort:** Medium
The prompt input is 2235 lines and has too many buttons. Reduce to: Input + Attach + Model + Send.

### 7. 🔄 Implement Agent-Initiated Tab Opening (1 week)
**Impact:** 🟠 High | **Effort:** High
The "agentic OS" promise requires agents to manipulate the workspace. Add tools: `open_browser`, `open_file`, `open_terminal`.

### 8. 🔄 Complete Browser Context Response Smoke (0.5 day)
**Impact:** 🟠 High | **Effort:** Low
The browser tab already hands page context to Side Chat and the main composer. Finish the actual model-response smoke so context handoff is proven beyond UI mount.

### 9. 🔄 Add Browser Annotation Tools (1 week)
**Impact:** 🟡 Medium | **Effort:** Medium
Highlights and notes turn the browser from a viewer into a research workspace.

### 10. 🔄 Finish Multi-Model UI Polish (2-3 days)
**Impact:** 🟡 Medium | **Effort:** Medium
The provider plumbing exists, but the user-facing model controls need to feel clear and trustworthy.

---

## Recently Completed

| Task | Result |
|------|--------|
| Code file viewer | Shiki-backed read-only viewer with line numbers, copy, wrap, and search |
| Workspace terminal tab | PTY-backed terminal tab using the existing Ghostty renderer and terminal state store |
| Side Chat tab | Independent session-backed text chat with optimistic sends, per-tab model controls, browser/file context handoff, and persisted backing session ID |
| Workspace persistence | Per-workspace tab state restore with migration and invalid-state recovery |
| Keyboard shortcuts | Close, new tab, reopen closed tab, numbered tab switching, previous/next tab |
| Tab context menu | Activate, duplicate, pin/unpin, close, close others, close all, reopen closed tab |

---

## Strategic Recommendations

### Recommendation 1: Ship Phase 1 Before Phase 2

**Do not** start building agent channels until Terminal has passed a live smoke test and Side Chat polish is complete. Why? Because agents need tools to manipulate. An agent that can open browser tabs, markdown, code files, and terminal sessions is useful; an agent that can also keep side conversations becomes compelling.

**Order of operations:**
1. Fix branding + debug bar (Week 1, days 1-2)
2. Terminal desktop smoke test (Week 1)
3. Side Chat desktop send/model-response smoke (Week 2)
4. Browser handoff + annotations (Week 2)
5. **Then** Background Tasks + Agent-Initiated Actions (Weeks 3-4)

### Recommendation 2: Keep the "OpenCode" Package Names Internally (For Now)

Renaming `@cedric/ui` to `@cedric/ui` across 100+ files is risky and time-consuming. **Better approach:**
- Keep internal package names as-is for now
- Update only user-facing strings (window title, menus, HTML title, splash screen)
- Do the full package rename as a dedicated sprint when the app is stable
- This avoids breaking builds during critical feature development

### Recommendation 3: Make the Browser Tab the Star Feature

The browser tab is already functional and unique (no competitor has multi-browser). **Double down:**
- Add "Send page to chat" button (1 day)
- Add basic highlight/annotation (1 week)
- Add agent screenshot capability (already in computer control tools)
- Market this: "Cedric is the only AI app where you can have 5 browsers open while coding"

### Recommendation 4: Side Chat as "Scratchpad"

Don't over-engineer Side Chat as a full second conversation system initially. Position it as:
- "Scratchpad" for quick calculations
- "Reference" for looking up docs without polluting main chat
- "Draft" for writing content before sending to main agent

This reduces the scope while still delivering value.

### Recommendation 5: Use "Background Tasks" Not "Agent Channels"

"Agent channels" is jargon. Users understand:
- "Background Tasks" (macOS, Windows terminology)
- "Running Jobs"
- "Active Processes"

Use familiar language. The UI can show:
```
▼ Background Tasks (2 running)
  ● Researching React hooks...        [View] [Stop]
  ○ Waiting to start: Write tests   [View] [Stop]
```

### Recommendation 6: Proactive Suggestions = "Cedric Noticed"

Instead of generic "proactive agent behaviors," frame them as:
```
┌─────────────────────────────────────────┐
│ 💡 Cedric noticed: You have 3 uncommitted│
│    changes. Want me to review them?     │
│    [Review] [Dismiss]                   │
└─────────────────────────────────────────┘
```

This feels helpful, not intrusive.

### Recommendation 7: Workspace Templates as "Layouts"

Don't call them "templates" — call them "Layouts":
- "Coding Layout" → File tree + Terminal + Browser
- "Research Layout" → 2x Browser + Side Chat
- "Review Layout" → Review + File + Terminal

Users understand "layouts" from IDEs. One-click switch is powerful.

---

## Anti-Recommendations (What NOT to Do)

### ❌ Don't Build a Plugin Marketplace Yet

The user base is too small. MCP server integration is enough extensibility for the next 6 months.

### ❌ Don't Add Collaboration Mode Yet

Multi-user sessions are complex and not the core differentiator. Focus on single-user power first.

### ❌ Don't Rewrite the UI Framework

SolidJS + Effect-TS is working. Don't migrate to React, Vue, or another framework. The team knows this stack.

### ❌ Don't Support Editing in Code Viewer (Yet)

Read-only syntax highlighting is 80% of the value. Editing requires save logic, conflict resolution, and git integration. Defer to v1.1.

### ❌ Don't Add Mobile App Yet

Desktop is the core experience. A mobile companion is a Phase 4 feature.

---

## Quick Wins (This Week)

| # | Task | File | Time |
|---|------|------|------|
| 1 | Hide DebugBar | `app.tsx` or layout | 15 min |
| 2 | Fix window title | `titlebar.tsx`, `index.html` | 30 min |
| 3 | Fix menu items | `desktop-menu.ts` | 30 min |
| 4 | Better browser error state | `browser-tab.tsx` | 1 hour |
| 5 | Better file tab empty state | `file-tab.tsx` | 1 hour |
| 6 | Add load timeout to browser | `browser-tab.tsx` | 2 hours |
| 7 | Verify production debug-bar behavior | `app.tsx` or layout | 1 hour |
| 8 | Smoke test tab persistence in desktop | `session-side-panel.tsx` | 1 hour |

**Total: ~2 days of work for massive UX improvement.**

---

## Medium Wins (Next 2 Weeks)

| # | Task | Effort |
|---|------|--------|
| 9 | Terminal tab desktop smoke | 1 day |
| 10 | Side chat desktop send/model-response smoke | 1 day |
| 11 | Browser context model-response smoke | 0.5 day |
| 12 | Browser annotations | 1 week |
| 13 | Simplify prompt input | 2 days |

**Total: ~2 weeks to eliminate remaining core placeholders and strengthen the browser workflow.**

---

## Measurement Plan

Track these metrics weekly:

| Metric | Baseline | Target (Week 4) | Tool |
|--------|----------|-----------------|------|
| Avg tabs per session | 1.2 | 3.0 | Telemetry |
| Terminal tab usage | 0% | 40% of sessions | Telemetry |
| Code file opens | 10% | 60% of sessions | Telemetry |
| Workspace restore success | N/A | 95% | Error tracking |
| "Coming Soon" encounters | High | 0 | Telemetry |
| Session duration | 15 min | 30 min | Telemetry |
| Return rate (7-day) | TBD | 50% | Analytics |

---

## Conclusion

Cedric is **90% of the way to a compelling MVP**. The remaining 10% is not invention — it's **completion**. The architecture is correct. The vision is clear. The competitors have left a gap (multi-model + multi-tab + agent-native).

**The path forward:**
1. Fix the embarrassing stuff (debug bar, branding, placeholders)
2. Complete the workspace (terminal smoke, side chat)
3. Add the agentic layer (background tasks, agent-initiated actions)
4. Then — and only then — build the ecosystem (plugins, collaboration, mobile)

**Cedric can be the VS Code of LLM apps. But only if it ships.**

---

*Product Improvement Plan — Generated by Product Orchestrator, June 2026*
