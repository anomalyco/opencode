# Cedric (OpenCode for Kimi K2.6) — Development Roadmap

> **Last updated:** 2026-06-09
> **Status:** Core provider integration complete. Computer-use implemented. UI components and swarm pending.

---

## ✅ Completed

### 1. Native Moonshot Provider
- **Files:** `packages/llm/src/providers/moonshot.ts`, `packages/llm/src/providers/openai-compatible-profile.ts`, `packages/llm/src/providers/openai-compatible.ts`, `packages/llm/src/providers/index.ts`, `packages/core/src/provider.ts`
- **Status:** ✅ Compiles and integrates with OpenCode's provider system
- **Features:**
  - 4 pre-configured models: `kimi-k2-6`, `kimi-k2-6-thinking`, `kimi-k2-6-vision`, `kimi-k2-6-search`
  - `reasoningEffort` parameter (low/medium/high)
  - `searchMode` parameter
  - Bearer auth with `MOONSHOT_API_KEY` env fallback
  - OpenAI-compatible API endpoint (`api.moonshot.cn/v1`)

### 2. Context Window Optimizer
- **File:** `packages/core/src/context-optimizer/kimi-optimizer.ts`
- **Status:** ✅ Real implementation with token allocation, file selection, relevance scoring
- **Features:**
  - 256K context window allocation (40% codebase, 30% history, 20% tools, 10% reserve)
  - CJK-aware token estimation
  - Config file prioritization
  - Customizable system prompt generation

### 3. Computer Control Tool
- **File:** `packages/core/src/tool/computer-control.ts`
- **Status:** ✅ Implemented and wired into tool registry (`builtins.ts`)
- **Features:**
  - **Screenshot** (full screen + region) via `screencapture`
  - **Mouse click** via AppleScript / cliclick / xdotool
  - **Keyboard type** via AppleScript / SendKeys / xdotool
  - **Scroll** via xdotool / PowerShell (macOS scroll limited to positioning)
  - **Key combos** (Command+C, etc.)
- **Cross-platform:** macOS, Windows, Linux
- **Security:** All actions require user confirmation via OpenCode's permission system
- **Verification:** `bun run --cwd packages/core typecheck` passes as of 2026-06-11.

### 4. Preset Configuration
- **File:** `.opencode/presets/kimi.json`
- **Status:** ✅ Ready-to-use preset with Kimi-optimized settings

### 5. Documentation
- `GETTING_STARTED.md` — Quick start guide
- `KIMI_SETUP.md` — Detailed configuration guide
- `IMPLEMENTATION_SUMMARY.md` — What has been built

---

## 🚧 In Progress / Needs Work

### 6. Example Scripts
- **File:** `packages/llm/example/kimi-example.ts`
- **Issue:** Fails at runtime with `Service not found: @opencode/LLM/RequestExecutor`
- **Action:** Needs proper Effect-TS service layer wiring (Layer, provide, etc.)
- **Priority:** Low (examples are nice-to-have, not critical path)

---

## 📋 Next Milestones

### Phase 3: UI Components (Short Term — 2-4 weeks)

#### 8. In-App Web Browser
- **Target:** `packages/desktop/src/renderer/` or `packages/app/src/components/`
- **Architecture:** Embedded BrowserView (Electron) or iframe with annotation layer
- **Features:**
  - [ ] Browse websites within the app
  - [ ] Annotate pages with highlights/comments
  - [ ] Share page content with Kimi for analysis
  - [ ] Capture screenshots of specific elements
  - [ ] DOM inspection capabilities
- **Depends on:** Computer control screenshot (✅ done)

#### 9. Markdown Viewer
- **Target:** `packages/app/src/components/`
- **Features:**
  - [ ] Rich markdown rendering with syntax highlighting
  - [ ] Mermaid diagram support
  - [ ] Live editing with split view
  - [ ] Kimi-assisted markdown generation
  - [ ] Export to PDF/HTML
- **Libraries to evaluate:** `marked`, `marked-shiki` (already in catalog), `mermaid`

#### 10. Multi-Project Workspace
- **Target:** `packages/app/src/pages/`
- **Features:**
  - [ ] Sidebar with project tree
  - [ ] Tabbed chat interface (multiple concurrent conversations)
  - [ ] Workspace switcher with project-specific context
  - [ ] Session persistence and restoration
  - [ ] Per-project `AGENTS.md` support
- **Depends on:** Session storage architecture in `packages/core/src/session/`

#### 11. Model Selection Dropdown
- **Target:** UI settings panel
- **Features:**
  - [ ] Dropdown to switch between Kimi variants (standard, thinking, vision, search)
  - [ ] Reasoning effort slider (when thinking model selected)
  - [ ] Search mode toggle
- **Depends on:** UI component library (`@opentui/solid` already in project)

---

### Phase 4: Swarm & Advanced Features (Medium Term — 1-2 months)

#### 12. Swarm Manager
- **File:** `packages/core/src/swarm/` (currently only `architecture.md`)
- **Architecture:** Multi-agent collaboration framework
- **Agent roles:**
  - [ ] Orchestrator (coordinator)
  - [ ] Coder (implementation)
  - [ ] Reviewer (quality assurance)
  - [ ] Tester (test generation)
  - [ ] Researcher (information gathering)
- **Execution patterns:**
  - [ ] Sequential Pipeline
  - [ ] Parallel Execution
  - [ ] Debate & Converge
  - [ ] Iterative Improvement
- **Depends on:** Agent identity system, shared memory, task decomposition

#### 13. Vector Database Integration
- **Purpose:** Long-term memory for agent learning
- **Evaluate:** Pinecone, Weaviate, or local SQLite vector extension

#### 14. Multi-Modal UI
- **Features:**
  - [ ] Image upload in chat
  - [ ] Document viewer (PDF, DOCX)
  - [ ] Image analysis results display

---

### Phase 5: Ecosystem (Long Term — 3+ months)

#### 15. Agent Learning & Memory
- [ ] Persistent agent memory across sessions
- [ ] Learning from user feedback
- [ ] Hierarchical swarm teams

#### 16. Plugin Marketplace
- [ ] Plugin discovery and installation
- [ ] Third-party tool contributions
- [ ] Community preset sharing

#### 17. Advanced Computer Vision
- [ ] OCR for screenshots
- [ ] UI element detection
- [ ] Automated testing workflows

#### 18. Voice Interface
- [ ] Speech-to-text input
- [ ] Text-to-speech output

---

## 🔧 Immediate Action Items (This Week)

| # | Task | File | Priority |
|---|------|------|----------|
| 1 | Reconcile current canonical repo with the richer duplicate `openkimi` worktree | workspace | High |
| 2 | Commit all uncommitted changes after reconciliation | `git add . && git commit` | High |
| 3 | Test Moonshot provider end-to-end with real API key | `packages/llm/example/kimi-example.ts` | High |
| 4 | Add scroll wheel support for macOS | `packages/core/src/tool/computer-control.ts` | Medium |
| 5 | Create browser component scaffold or port the existing duplicate implementation | `packages/app/src/components/browser/` | Medium |
| 6 | Create markdown viewer scaffold or port the existing duplicate implementation | `packages/app/src/components/markdown-viewer/` | Medium |

---

## 🐛 Known Issues

1. **Computer control scroll on macOS** — AppleScript has no native scroll wheel support. Needs CGEvent API binding or `cliclick` installation.
2. **Keyboard automation requires Accessibility permissions** — macOS blocks `osascript` keystrokes unless the host app has Accessibility permission in System Settings.
3. **Screenshot requires Screen Recording permission** — macOS `screencapture` fails without permission.
4. **Example script runtime error** — `Service not found: @opencode/LLM/RequestExecutor` suggests missing Effect-TS layer wiring.

---

## 📁 File Inventory

### New Files (Created for Kimi Integration)
```
packages/llm/src/providers/moonshot.ts              ✅ Provider
packages/core/src/context-optimizer/kimi-optimizer.ts ✅ Optimizer
packages/core/src/tool/computer-control.ts          ✅ Tool (typecheck verified)
packages/core/src/swarm/architecture.md             🏗️ Design only
packages/llm/example/kimi-example.ts                ⚠️ Needs runtime fix
.opencode/presets/kimi.json                         ✅ Preset
GETTING_STARTED.md                                  ✅ Docs
KIMI_SETUP.md                                       ✅ Docs
IMPLEMENTATION_SUMMARY.md                           ✅ Docs
KIMI_ROADMAP.md                                     ✅ This file
```

### Modified Files (OpenCode Base)
```
packages/core/src/provider.ts                       + moonshot ID
packages/llm/package.json                           + moonshot export
packages/llm/src/providers/index.ts                 + Moonshot export
packages/llm/src/providers/openai-compatible-profile.ts + moonshot profile
packages/llm/src/providers/openai-compatible.ts     + moonshot helper
packages/core/src/tool/builtins.ts                + ComputerControlTool.layer
```

---

## 🛠️ Technical Stack

- **Framework:** Effect-TS v4.0.0-beta.74 (functional programming)
- **UI:** SolidJS (reactive UI)
- **Desktop:** Electron (cross-platform)
- **Build:** Vite + Bun
- **Protocol:** OpenAI-compatible API
- **Language:** TypeScript 5.8.2
- **Checker:** `tsgo` (fast Go-based TypeScript checker)

---

## 🤝 Contributing

1. Create feature branch from `dev`
2. Implement changes
3. Run `bun run --cwd packages/<pkg> typecheck`
4. Add tests
5. Update this roadmap
6. Submit PR

---

**Next immediate step:** Reconcile the canonical `opencode-kimi` repo with the richer duplicate `openkimi` worktree, then test the Moonshot provider end-to-end with a real API key.
