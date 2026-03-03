# Plan Mode — Architecture & Low-Level Design

**Issue:** anomalyco/opencode#3844  
**Date:** 2026-03-03  
**Status:** Draft  

---

## 1. Context & Discovery

### Existing Implementation (Behind Feature Flag)

Plan Mode **already exists** in the codebase behind `Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE`:

- **Two agents:** `build` (default, full tool access) and `plan` (read-only, limited to plan files)
- **Plan tool:** `packages/opencode/src/tool/plan.ts` — writes to `plan.md`, asks user "switch to build agent?"
- **Plan-exit tool:** `packages/opencode/src/tool/plan-exit.txt` — describes when to exit plan mode
- **Agent switching:** User message carries `agent` field, frontend switches via `local.agent.set()`
- **Question tool:** Already exists as interactive Q&A interruption during planning

### What #3844 Actually Wants (Beyond Current Implementation)

1. **Automatic plan-before-execute flow** — not just a separate agent, but the default agent should plan first, then ask for confirmation before executing
2. **Claude Code-style behavior:** AI proposes changes → user reviews → user confirms/modifies → AI executes
3. **Inline plan review in the same session** — not a separate agent mode toggle

### Gap Analysis

| Capability | Current State | Desired |
|---|---|---|
| Plan agent | ✅ Exists, read-only | ✅ Good |
| Build agent | ✅ Exists, full access | ✅ Good |
| Question tool | ✅ Interactive Q&A | ✅ Good |
| Plan tool (writes plan.md) | ✅ Exists | ⚠️ Overkill — users want lightweight approval |
| Auto plan-then-build flow | ❌ Manual agent switch | ❌ **Main gap** |
| Plan confirmation in dock | ❌ Not implemented | ❌ **Main gap** |
| Plan mode as default behavior | ❌ Behind feature flag | ❌ **Main gap** |
| Settings UI toggle | ❌ Not exposed | ❌ Needed |

---

## 2. Architecture Decision Record (ADR)

### ADR-001: Plan Mode Implementation Strategy

**Decision:** Enhance the existing plan/build agent system with an **automatic plan-confirm-execute flow**, rather than building a new system.

**Rationale:**
- Plan agent + question tool already work
- Agent switching infrastructure is solid
- Permission/question dock UI already handles pause-and-wait patterns
- Feature flag allows incremental rollout

### ADR-002: Plan Confirmation Mechanism

**Options Considered:**

| Option | Description | Pros | Cons |
|---|---|---|---|
| A. Question tool | Plan agent uses question tool to ask "proceed?" | Already works, no new code | Clunky UX, loses plan context |
| B. New "confirm" tool | New tool that shows plan + confirm/reject buttons | Clean UX, purpose-built | New tool registration, new UI |
| C. Auto-agent-chain | Plan agent auto-delegates to build agent on confirmation | Seamless flow | Complex, requires session processor changes |
| **D. Enhanced question tool + auto-switch** | Plan agent proposes, question tool confirms, auto-switches to build on "yes" | Minimal new code, leverages existing systems | Slightly coupled |

**Decision:** Option D — Enhanced question tool + auto-agent-switch

The plan tool (`plan.ts`) already asks "switch to build agent?" via the question tool. The main missing piece is:
1. Making this the **default flow** (not behind feature flag)
2. Adding a **settings toggle** for plan-before-execute
3. Making the **confirmation UX smoother** in the web dock

### ADR-003: Where Plan Mode Lives

**Decision:** Session-level setting, configurable per-project

- `config.toml`: `[experimental] plan_mode = true` (already partially exists)
- Web UI: Settings → Experimental → "Plan before execute" toggle
- Per-session override via slash command: `/plan on` / `/plan off`

---

## 3. Low-Level Design (LLD)

### 3.1 Backend Changes

#### 3.1.1 Remove Feature Flag Gate (Minimal)

**File:** `packages/opencode/src/tool/registry.ts`

Currently plan tools are only registered when `Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE` is true. Change to always register them but only activate when config enables plan mode.

```ts
// Before (gated)
if (Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE) {
  tools.push(PlanTool, PlanExitTool)
}

// After (config-driven)
if (config.experimental?.plan_mode || Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE) {
  tools.push(PlanTool, PlanExitTool)
}
```

#### 3.1.2 Config Schema Addition

**File:** `packages/opencode/src/config/config.ts`

```ts
experimental: {
  plan_mode: z.boolean().optional().default(false),
  // existing fields...
}
```

#### 3.1.3 Auto-Agent-Switch After Plan Confirmation

**File:** `packages/opencode/src/tool/plan.ts`

The plan tool already asks "Would you like to switch to build agent?" — when user confirms, it should automatically set the next message's agent to "build":

```ts
// In plan.ts execute(), after question confirmation:
if (answer === "yes") {
  // Set agent switch for next turn
  await Session.setNextAgent(input.sessionID, "build")
}
```

#### 3.1.4 Default Agent Based on Plan Mode

**File:** `packages/opencode/src/session/prompt.ts`

When plan_mode is enabled and session has no messages yet, default to "plan" agent:

```ts
const agent = config.experimental?.plan_mode && !hasExistingMessages 
  ? "plan" 
  : userMessage.agent ?? "build"
```

### 3.2 Frontend Changes

#### 3.2.1 Settings Toggle

**File:** `packages/app/src/components/dialog-settings.tsx` (or `settings-experimental.tsx`)

Add a toggle in the Experimental section:

```tsx
<Switch
  checked={settings.experimental.planMode()}
  onChange={(v) => settings.experimental.setPlanMode(v)}
>
  {language.t("settings.experimental.planMode")}
</Switch>
```

#### 3.2.2 Agent Selector Enhancement

**File:** `packages/app/src/components/prompt-input.tsx`

The agent selector already exists in the tray area. When plan mode is enabled, show a visual indicator:

```tsx
<Show when={settings.experimental.planMode()}>
  <span class="text-11-regular text-icon-info-base">Plan → Build</span>
</Show>
```

#### 3.2.3 Plan Confirmation Dock (Future Enhancement)

**File:** `packages/ui/src/components/dock-prompt.tsx`

Currently, the question tool shows a generic question dock. For plan mode, a richer dock could show:
- The plan summary (markdown)
- Confirm/Modify/Reject buttons
- Option to edit the plan before confirming

This is a Phase 2 enhancement — Phase 1 uses the existing question dock.

### 3.3 i18n Keys

```ts
// packages/ui/src/i18n/en.ts
"settings.experimental.planMode": "Plan before execute",
"settings.experimental.planMode.description": "AI proposes a plan and asks for confirmation before making changes",
"prompt.mode.plan": "Planning",
"prompt.mode.plan.active": "Plan mode active — AI will ask before executing",
```

---

## 4. Implementation Phases

### Phase 1: Expose Existing Plan Mode (1-2 hours)
1. Add `plan_mode` to config schema
2. Remove hard feature flag gate, use config instead
3. Add settings toggle in web UI
4. Add i18n keys
5. Test with existing plan/build agent flow

### Phase 2: Smooth Auto-Switch UX (2-3 hours)
1. Auto-default to plan agent when plan_mode enabled
2. Auto-switch to build agent on plan confirmation
3. Visual indicator in prompt input tray
4. Session-level override via `/plan` command

### Phase 3: Rich Plan Dock (4-6 hours, optional)
1. New `DockPrompt` variant for plan review
2. Plan markdown preview in dock
3. Edit-before-confirm capability
4. Plan history/versioning

---

## 5. Data Flow

```
User types message
    ↓
[plan_mode enabled?]
    ↓ yes                          ↓ no
Agent = "plan"              Agent = "build"
    ↓                              ↓
LLM plans (read-only tools)  LLM executes (all tools)
    ↓
Plan tool writes plan.md
    ↓
Question tool: "Switch to build?"
    ↓
[User confirms in dock]
    ↓ yes                     ↓ no
Auto-switch to "build"    Stay in "plan"
    ↓
LLM executes plan
```

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Plan agent produces low-quality plans | Improve plan agent system prompt |
| Users confused by agent switching | Clear UI indicator showing current mode |
| Plan mode doubles token usage | Plan agent uses read-only tools, cheaper models possible |
| Breaking existing workflows | Config-driven, off by default |
| Plan.md file clutter | Option to use in-memory plans instead of file |

---

## 7. Testing Strategy

- Unit test: Config parsing with plan_mode flag
- Unit test: Agent default selection based on plan_mode
- Unit test: Auto-agent-switch after plan confirmation
- E2E test: Full plan → confirm → build flow in web UI
- Manual test: TUI plan mode with question tool

---

## 8. Files to Modify

### Phase 1 (Minimal)
- `packages/opencode/src/config/config.ts` — add plan_mode schema
- `packages/opencode/src/tool/registry.ts` — config-driven registration
- `packages/app/src/components/dialog-settings.tsx` — toggle
- `packages/ui/src/i18n/en.ts` (+ all locale files) — i18n keys

### Phase 2 (Auto-Switch)
- `packages/opencode/src/session/prompt.ts` — default agent logic
- `packages/opencode/src/tool/plan.ts` — auto-switch on confirmation
- `packages/app/src/components/prompt-input.tsx` — visual indicator

### Phase 3 (Rich Dock)
- `packages/ui/src/components/dock-prompt.tsx` — new plan variant
- `packages/ui/src/components/dock-prompt.css` — styles
- `packages/app/src/pages/session/composer/session-composer-region.tsx` — plan dock rendering
