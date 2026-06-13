# OpenKimi UI/UX Audit Report
## Executive Summary

**Date:** June 7, 2026
**Auditor:** UI/UX Expert Analysis
**App Version:** OpenKimi (OpenCode fork)
**Platform:** macOS Desktop

---

## Critical Findings

### 1. BRANDING INCONSISTENCY (CRITICAL)
**Severity:** 🔴 Critical
**Impact:** User confusion, brand dilution

**Evidence:**
- Window title bar shows "OpenCode" instead of "OpenKimi"
- App menu shows "OpenCode"
- Multiple UI elements still reference "OpenCode"
- Protocol handler uses `openkimi://` but UI doesn't reflect this

**Recommendation:** Complete brand audit. Every visible element must say "OpenKimi". This is non-negotiable for a standalone product.

---

### 2. DEVELOPMENT ARTIFACTS IN PRODUCTION (CRITICAL)
**Severity:** 🔴 Critical
**Impact:** Unprofessional appearance, performance overhead

**Evidence:**
- Performance diagnostics panel visible in bottom-right corner (FPS: 60, FRAME: 33, JANK: 1, LONG: 14/1, MEM: 2%)
- "DEV" badge visible in top-left
- These are development-only tools that should NEVER appear in user-facing builds

**Recommendation:** Remove performance diagnostics and DEV badge from production builds immediately.

---

### 3. INFORMATION ARCHITECTURE BREAKDOWN (HIGH)
**Severity:** 🟠 High
**Impact:** Cognitive overload, feature discoverability issues

**Evidence:**
Right panel contains 4 tabs: **Review | Browser | Markdown | Swarm**

**Problems:**
1. **Mental Model Mismatch**: These features serve completely different purposes but are given equal visual weight
2. **Context Confusion**: Why is a markdown viewer at the same level as a browser or swarm panel?
3. **Tab Overload**: 4 tabs in a secondary panel is too many. Users will ignore them.

**Analysis:**
- **Review** (Git changes) - Makes sense as a secondary panel for developers
- **Browser** - Should be a primary feature, not buried in a tab
- **Markdown** - Should be integrated into file preview, not a standalone tab
- **Swarm** - Novel concept but poorly positioned. Users don't understand what "swarm" means without explanation

**Recommendation:**
- Reorganize into primary/secondary hierarchy
- Browser should be a toggleable side panel or floating window
- Markdown should auto-open when clicking .md files
- Swarm needs to be rethought entirely (see section 6)

---

### 4. EMPTY STATE FAILURES (HIGH)
**Severity:** 🟠 High
**Impact:** User abandonment, confusion

**Evidence:**

#### Markdown Tab
- Shows: "Select a markdown file to view"
- **Problem**: No guidance on HOW to select a file. No file picker visible.
- **Problem**: "Hide TOC" button is visible when there's no TOC to hide
- **Problem**: Empty gray space with no visual interest

#### Browser Tab
- Shows: "Loading..." with URL bar showing "https://www.google.com/"
- **Problem**: Stuck in loading state with no error message
- **Problem**: No indication of what's loading or why
- **Problem**: Disabled navigation buttons with no explanation

#### Swarm Tab
- Shows: Available agents "build", "plan" as plain text
- **Problem**: No visual indication of what these agents do
- **Problem**: No onboarding or explanation of "swarm" concept
- **Problem**: "Create Swarm Task" button disabled with no guidance on how to enable it

**Recommendation:**
- Design proper empty states with clear CTAs
- Add onboarding tooltips for novel concepts (Swarm)
- Show actionable guidance, not just placeholder text

---

### 5. VISUAL HIERARCHY ISSUES (MEDIUM)
**Severity:** 🟡 Medium
**Impact:** Eye fatigue, poor scannability

**Evidence:**

#### Color Usage
- Dark theme is consistent but monotonous
- No accent colors to draw attention to important actions
- Agent status dots (in Swarm) are too small to be meaningful

#### Typography
- Multiple font sizes create confusion (text-11, text-12, text-13, text-14)
- "TASK DESCRIPTION" and "EXECUTION PATTERN" labels are too prominent for their secondary importance
- Tab labels are not visually distinct from content

#### Spacing
- Inconsistent padding between elements
- Swarm execution pattern buttons have uneven spacing
- "Multi-Agent Collaboration" subtitle is too close to "Swarm" title

**Recommendation:**
- Establish clear typographic hierarchy (max 3 sizes)
- Use accent colors for primary actions only
- Increase spacing between distinct sections

---

### 6. SWARM FEATURE - CONCEPTUAL FAILURE (HIGH)
**Severity:** 🟠 High
**Impact:** Feature abandonment, user confusion

**Evidence:**

#### Naming
- "Swarm" is jargon. Users don't know what this means.
- "Multi-Agent Collaboration" subtitle helps but is insufficient
- No explanation of WHY or WHEN to use this feature

#### UI Implementation
- 4 execution patterns presented as equal options (Sequential, Parallel, Debate, Iterative)
- No guidance on which pattern to choose
- "Available Agents" shows just text names with colored dots
- No indication of agent capabilities or specialties

#### Interaction Model
- "Create Swarm Task" button disabled until text entered
- No preview of what will happen
- No indication of how tasks are executed or monitored

**Analysis:**
This feature violates several UX principles:
1. **No clear value proposition**: Why would a user choose "Swarm" over just chatting?
2. **No feedback loop**: Users can't see what agents are doing in real-time
3. **No progressive disclosure**: All options shown at once, overwhelming users
4. **Wrong mental model**: Users think in terms of "tasks" not "swarms"

**Recommendation:**
- **Rename**: "Swarm" → "Agent Team" or "Collaborative Mode"
- **Onboarding**: First-time tooltip explaining the concept
- **Simplify**: Default to "Sequential" pattern, hide others in advanced settings
- **Preview**: Show a diagram of how agents will collaborate BEFORE creating task
- **Integration**: Don't make this a tab - make it a mode in the chat interface

---

### 7. BROWSER INTEGRATION - HALF-BAKED (HIGH)
**Severity:** 🟠 High
**Impact:** Broken expectations, feature unusability

**Evidence:**
- Browser panel shows "Loading..." indefinitely
- URL bar shows Google but nothing loads
- Navigation buttons are disabled with no explanation
- "Open Browser" button in chat composer is disconnected from this panel

**Analysis:**
The browser integration appears to be:
1. **Non-functional** in current state (loading fails)
2. **Poorly positioned** as a tab instead of primary workspace
3. **Disconnected** from the chat workflow (why would users browse in a code editor?)

**Recommendation:**
- Fix the loading issue immediately
- Consider making browser a floating window or detached panel
- Integrate browser with chat (e.g., "Open in browser" action for links)
- Add annotation tools as promised in original requirements

---

### 8. CHAT INTERFACE - CLUTTERED (MEDIUM)
**Severity:** 🟡 Medium
**Impact:** Reduced productivity, missed features

**Evidence:**
- Input area shows: "Ask anything, / for commands, @ for context..."
- But also has: "Add files" button, "Open Browser" button, model selector, send button
- Shell commands shown inline with chat ("Shell Check Python availability")
- Token counting display is overly complex ("1 read, 0 searches, 0 lists")

**Problems:**
1. **Too many actions** in the composer bar
2. **Mixed metaphors**: Shell commands shouldn't appear in chat stream
3. **Token display** is confusing (what do "reads", "searches", "lists" mean?)

**Recommendation:**
- Simplify composer to: Input + Send + Attachments + Model
- Move "Open Browser" to a toolbar or keyboard shortcut
- Hide shell commands behind expandable sections
- Simplify token display or remove it

---

### 9. PERFORMANCE PANEL - DISTRACTING (MEDIUM)
**Severity:** 🟡 Medium
**Impact:** Visual clutter, reduced workspace

**Evidence:**
- Performance metrics panel takes up space in bottom-right
- Shows: NAV, FPS, FRAME, JANK, LONG, DELAY, INP, CLS, MEM
- These are developer metrics, not user-facing information

**Recommendation:**
- Remove from production entirely
- If needed for debugging, make it a hidden developer feature (e.g., cmd+shift+D)

---

## Agentic OS Assessment

### Are We Creating an Agentic OS?

**Current State:** ❌ No
**Gap Analysis:**

An "Agentic OS" would have:
1. ✅ **Multi-modal interaction** (chat, browser, files)
2. ❌ **Proactive agents** (agents should suggest actions, not just respond)
3. ❌ **Ambient awareness** (agents should know context without explicit prompts)
4. ❌ **Seamless tool use** (browser, files, code should work together fluidly)
5. ❌ **Agent persona** (distinct personalities/helpers, not just modes)

**Missing Elements:**
- No proactive suggestions ("I noticed you have uncommitted changes, want me to review?")
- No ambient file monitoring
- No agent personalities or specializations visible in UI
- No integration between tools (browser findings → code changes)
- No "agent workspace" concept

---

## Recommendations Priority Matrix

### Immediate (This Week)
1. **Remove development artifacts** (performance panel, DEV badge)
2. **Fix branding** (replace all "OpenCode" with "OpenKimi")
3. **Fix browser loading** (currently broken)
4. **Add empty state guidance** (clear CTAs, actionable hints)

### Short-term (Next 2 Weeks)
5. **Redesign right panel tabs** (separate primary/secondary features)
6. **Simplify Swarm UI** (rename, add onboarding, reduce options)
7. **Clean up chat composer** (remove clutter, simplify actions)
8. **Integrate markdown** (auto-open on file click, remove from tabs)

### Medium-term (Next Month)
9. **Reimagine information architecture** (primary vs secondary features)
10. **Add proactive agent behaviors** (suggestions, ambient awareness)
11. **Create agent personas** (visual differentiation, specialties)
12. **Implement agent workspace** (dedicated space for agent activities)

### Long-term (Next Quarter)
13. **True agentic workflows** (multi-step tasks, agent collaboration)
14. **Browser annotation tools** (as originally requested)
15. **Cross-tool integration** (browser → code → review flow)

---

## Specific Redesign Suggestions

### Option A: Sidebar Reorganization
```
Left Sidebar (Primary):
- Chat (main workspace)
- Browser (toggleable panel)
- File Explorer

Right Sidebar (Secondary):
- Review (Git changes)
- Context (files, snippets)
- Agent Team (formerly Swarm)
```

### Option B: Workspace Model
```
Main Area: Chat (always visible)
Floating Panels:
- Browser (detachable window)
- Markdown Preview (auto-opens)
- Agent Console (for swarm tasks)

Side Panel: File tree + Review
```

### Option C: Contextual UI
```
- Show Browser tab ONLY when user asks to browse
- Show Markdown tab ONLY when .md file selected
- Show Agent Team ONLY when explicitly activated
- Default right panel: Review + Context
```

---

## Conclusion

OpenKimi has a solid foundation but suffers from:
1. **Incomplete rebranding** (still shows OpenCode)
2. **Feature sprawl** (too many tabs, unclear hierarchy)
3. **Broken features** (browser doesn't load)
4. **Poor empty states** (no guidance for users)
5. **Missing agentic behaviors** (reactive, not proactive)

**Verdict:** The app is functional but not polished. It needs significant UI/UX work before it can be considered a true "Agentic OS". The Swarm feature needs complete rethinking. The Browser integration needs to work reliably. Most importantly, the app needs to feel like Kimi K2's native environment, not a fork of another product.

**Priority:** Fix critical issues (branding, dev artifacts, broken browser) before adding new features.

---

## Appendix: Screenshot Evidence

See attached screenshots showing:
1. Swarm tab with basic UI
2. Browser tab stuck on loading
3. Markdown tab with empty state
4. Review tab with no changes
5. Performance panel visible in production

*Note: All screenshots captured from live application on June 7, 2026*
