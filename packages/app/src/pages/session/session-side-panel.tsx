import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useParams } from "@solidjs/router"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { Icon } from "@opencode-ai/ui/icon"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"

import FileTree from "@/components/file-tree"
import { SessionContextUsage } from "@/components/session-context-usage"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { Persist, persisted } from "@/utils/persist"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { createOpenSessionFileTab, getTabReorderIndex } from "@/pages/session/helpers"
import { StickyAddButton } from "@/pages/session/review-tab"
import { setSessionHandoff } from "@/pages/session/handoff"

type PromptDoc = {
  category?: string
  categoryIcon?: string
  prompts?: {
    id: string
    name: string
    summary?: string
    description?: string
    template: string
    tags?: string[]
  }[]
}

type PromptItem = {
  id: string
  name: string
  summary?: string
  description?: string
  template: string
  category: string
  icon?: string
  tags: string[]
  path: string
}

const FALLBACK_PROMPTS: PromptItem[] = [
  {
    id: "quick-code-review",
    name: "Quick Code Review",
    summary: "Fast, high-signal review with prioritized fixes",
    template:
      "Act as a senior reviewer. Do a fast, risk-focused review of the code I am currently working on in this workspace.\n\nOutput in this exact structure:\n1) Verdict (2-3 sentences)\n2) Critical findings (severity: high/medium/low)\n3) Quick wins (small changes with big impact)\n4) Suggested patch snippets\n5) What looks good\n\nRules:\n- Prefer correctness and safety over style nits.\n- For each finding, cite the exact file/function and explain impact.\n- If uncertain, say what evidence is missing.\n- Keep total response under 350 words unless there is a high-severity issue.",
    category: "Code Review",
    icon: "🔍",
    tags: ["review", "quality", "fast"],
    path: "fallback",
  },
  {
    id: "deep-code-review",
    name: "Deep Code Review",
    summary: "Thorough review for correctness, design, and maintainability",
    template:
      "Perform a deep review of the code I am currently working on as if it is production-critical.\n\nEvaluate:\n- Correctness and edge cases\n- API/design clarity\n- Maintainability and readability\n- Error handling and observability\n- Test coverage gaps\n\nOutput sections:\n1) Executive summary\n2) Findings table (severity, area, issue, impact, recommendation)\n3) Refactoring opportunities (ordered by ROI)\n4) Test cases to add\n5) Merge readiness (Ready / Needs changes)",
    category: "Code Review",
    icon: "🔍",
    tags: ["review", "architecture", "quality"],
    path: "fallback",
  },
  {
    id: "security-audit",
    name: "Security Audit",
    summary: "Threat-model oriented security review",
    template:
      "Audit the code I am currently working on for security risks. Assume hostile input and realistic attacker behavior.\n\nLook for:\n- Injection, auth/authz, secrets exposure, unsafe deserialization\n- SSRF/path traversal/file access issues\n- Privilege escalation and trust boundary mistakes\n- Data leakage in logs/errors\n\nOutput:\n1) Threat model assumptions\n2) Vulnerabilities (severity, exploit path, impact)\n3) Concrete remediations\n4) Defense-in-depth improvements\n5) Security tests to add",
    category: "Code Review",
    icon: "🔍",
    tags: ["security", "review", "threat-model"],
    path: "fallback",
  },
  {
    id: "performance-triage",
    name: "Performance Triage",
    summary: "Find likely bottlenecks and prioritize fixes",
    template:
      "Review the code I am currently working on for performance bottlenecks. Prioritize likely real-world hotspots over theoretical micro-optimizations.\n\nOutput:\n1) Top 3 bottlenecks (with why)\n2) Quick optimizations (low risk)\n3) Structural optimizations (higher impact)\n4) Measurement plan (what to benchmark and how)\n5) Tradeoffs and regression risks",
    category: "Code Review",
    icon: "🔍",
    tags: ["performance", "profiling", "optimization"],
    path: "fallback",
  },
  {
    id: "readability-review",
    name: "Readability Review",
    summary: "Improve clarity without changing behavior",
    template:
      "Review the code I am currently working on for readability and maintainability. Focus on naming, control flow, cohesion, and cognitive load.\n\nOutput:\n1) Most confusing areas\n2) Why they are hard to reason about\n3) Minimal edits to improve clarity\n4) Optional larger cleanup ideas\n5) Risks if left unchanged",
    category: "Code Review",
    icon: "🔍",
    tags: ["readability", "maintainability", "review"],
    path: "fallback",
  },
  {
    id: "bug-root-cause",
    name: "Root Cause Analysis",
    summary: "Reproduce, isolate, and propose a safe fix",
    template:
      "Help debug the issue I am currently working on with a root-cause-first approach.\n\nOutput:\n1) Most likely root cause (and confidence)\n2) Alternate hypotheses to rule out\n3) Minimal reproduction strategy\n4) Safe fix plan\n5) Verification checks\n6) Regression tests to add",
    category: "Engineering",
    icon: "🛠",
    tags: ["debug", "rca", "incident"],
    path: "fallback",
  },
  {
    id: "test-gap-analysis",
    name: "Test Gap Analysis",
    summary: "Design high-value tests that catch regressions",
    template:
      "Analyze the code I am currently working on and propose a focused test plan that maximizes defect detection with minimal redundant tests.\n\nOutput:\n1) Behavior matrix (happy path, edge cases, failure paths)\n2) Highest-value unit tests\n3) Integration tests worth adding\n4) Non-obvious edge cases\n5) Flaky test risks and how to avoid them",
    category: "Engineering",
    icon: "🛠",
    tags: ["testing", "quality", "coverage"],
    path: "fallback",
  },
  {
    id: "minimal-safe-fix",
    name: "Minimal Safe Fix",
    summary: "Smallest reliable patch for a bug",
    template:
      "Design the smallest safe fix for the issue I am currently working on while minimizing blast radius.\n\nOutput:\n1) Proposed minimal change\n2) Why this is safe\n3) Risks and assumptions\n4) Exact tests to run\n5) Follow-up hardening tasks",
    category: "Engineering",
    icon: "🛠",
    tags: ["bugfix", "safety", "maintenance"],
    path: "fallback",
  },
  {
    id: "refactor-plan",
    name: "Incremental Refactor Plan",
    summary: "Stepwise refactor with checkpoints and rollback safety",
    template:
      "Create an incremental refactor plan for the code I am currently working on that keeps behavior stable and easy to verify at every step.\n\nOutput:\n1) Refactor goals and constraints\n2) Step-by-step plan (small PR-sized steps)\n3) Validation per step\n4) Rollback strategy\n5) Final cleanup pass",
    category: "Engineering",
    icon: "🛠",
    tags: ["refactor", "design", "maintainability"],
    path: "fallback",
  },
  {
    id: "api-contract-review",
    name: "API Contract Review",
    summary: "Validate API shape, error model, and evolution safety",
    template:
      "Review the API/interface design in the code I am currently working on for clarity, correctness, and long-term evolution.\n\nEvaluate:\n- Naming and ergonomics\n- Input validation and error model\n- Backward compatibility risks\n- Versioning and deprecation strategy\n\nOutput:\n1) Contract issues\n2) Recommended contract changes\n3) Breaking-change risk assessment\n4) Migration guidance for consumers",
    category: "Engineering",
    icon: "🛠",
    tags: ["api", "design", "compatibility"],
    path: "fallback",
  },
  {
    id: "implementation-plan",
    name: "Implementation Plan",
    summary: "Turn a goal into an executable engineering plan",
    template:
      "Create an implementation plan for the feature or change I am currently working on.\n\nOutput:\n1) Problem framing and constraints\n2) Architecture approach and alternatives\n3) Step-by-step execution plan\n4) Validation strategy and tests\n5) Risks, rollbacks, and follow-up tasks",
    category: "Engineering",
    icon: "🛠",
    tags: ["planning", "implementation", "architecture"],
    path: "fallback",
  },
  {
    id: "qa-test-strategy",
    name: "Test Strategy",
    summary: "Design layered tests by risk and confidence",
    template:
      "Design a practical test strategy for the changes I am currently working on.\n\nOutput:\n1) Risk map (critical, moderate, low)\n2) Test layers (unit, integration, e2e) with goals\n3) Highest-value tests to add first\n4) Manual exploratory checks\n5) Exit criteria for release",
    category: "QA",
    icon: "🧪",
    tags: ["qa", "testing", "strategy"],
    path: "fallback",
  },
  {
    id: "qa-regression-matrix",
    name: "Regression Matrix",
    summary: "Build a concise matrix of what can break",
    template:
      "Create a regression matrix for my current changes.\n\nOutput:\n1) Core user journeys at risk\n2) Environment/version combinations to validate\n3) Data/state transitions to test\n4) Negative and failure-path checks\n5) Must-pass smoke tests",
    category: "QA",
    icon: "🧪",
    tags: ["qa", "regression", "matrix"],
    path: "fallback",
  },
  {
    id: "qa-edge-case-hunt",
    name: "Edge Case Hunt",
    summary: "Find non-obvious edge cases before users do",
    template:
      "Find likely edge cases for the code I am currently touching.\n\nOutput:\n1) Input boundary cases\n2) Timing and concurrency cases\n3) Invalid/malformed data cases\n4) State transition traps\n5) Suggested tests for each case",
    category: "QA",
    icon: "🧪",
    tags: ["qa", "edge-cases", "reliability"],
    path: "fallback",
  },
  {
    id: "incident-triage",
    name: "Incident Triage",
    summary: "Prioritize impact, isolate blast radius, and stabilize",
    template:
      "Help me triage an active issue in this project quickly and safely.\n\nOutput:\n1) Immediate impact assessment\n2) Probable blast radius\n3) Stabilization actions (now)\n4) Investigation plan (next)\n5) Communication update draft",
    category: "Troubleshooting",
    icon: "🧭",
    tags: ["incident", "triage", "operations"],
    path: "fallback",
  },
  {
    id: "flaky-failure-analysis",
    name: "Flaky Failure Analysis",
    summary: "Diagnose non-deterministic test or runtime failures",
    template:
      "Investigate a flaky failure pattern in this codebase.\n\nOutput:\n1) Most likely non-deterministic causes\n2) Isolation strategy\n3) Deterministic repro plan\n4) Hardening fixes\n5) Monitoring/tests to prevent recurrence",
    category: "Troubleshooting",
    icon: "🧭",
    tags: ["flaky", "stability", "tests"],
    path: "fallback",
  },
  {
    id: "postmortem-draft",
    name: "Postmortem Draft",
    summary: "Create a blameless incident postmortem",
    template:
      "Draft a blameless postmortem for the issue I just resolved.\n\nOutput:\n1) Summary and impact\n2) Timeline\n3) Root causes and contributing factors\n4) What worked / what failed\n5) Action items with owners and due dates",
    category: "Troubleshooting",
    icon: "🧭",
    tags: ["postmortem", "incident", "learning"],
    path: "fallback",
  },
  {
    id: "latency-breakdown",
    name: "Latency Breakdown",
    summary: "Decompose end-to-end latency into actionable buckets",
    template:
      "Break down the latency profile of the feature or request path I am working on.\n\nOutput:\n1) Likely latency contributors by stage\n2) Which are CPU, I/O, network, or serialization bound\n3) Highest-leverage optimization points\n4) Expected gains per change\n5) Validation plan",
    category: "Performance",
    icon: "⚡",
    tags: ["latency", "profiling", "optimization"],
    path: "fallback",
  },
  {
    id: "frontend-performance-pass",
    name: "Frontend Performance Pass",
    summary: "Reduce render cost and user-perceived slowness",
    template:
      "Audit the frontend changes I am making for runtime and load performance.\n\nOutput:\n1) Render bottlenecks and re-render causes\n2) Bundle and asset opportunities\n3) Interaction latency risks\n4) Low-risk quick wins\n5) Metrics to watch (LCP, INP, CLS, TTI)",
    category: "Performance",
    icon: "⚡",
    tags: ["frontend", "web-vitals", "performance"],
    path: "fallback",
  },
  {
    id: "throughput-scaling-plan",
    name: "Throughput Scaling Plan",
    summary: "Increase capacity without sacrificing reliability",
    template:
      "Create a scaling plan for the workload this code path will face.\n\nOutput:\n1) Current bottleneck assumptions\n2) Horizontal vs vertical scaling options\n3) Queueing/backpressure recommendations\n4) Capacity test plan\n5) Reliability tradeoffs and safeguards",
    category: "Performance",
    icon: "⚡",
    tags: ["throughput", "scaling", "capacity"],
    path: "fallback",
  },
  {
    id: "ui-critique",
    name: "UI Critique",
    summary: "Evaluate visual hierarchy and interaction clarity",
    template:
      "Review the UI I am currently building.\n\nOutput:\n1) First-impression clarity issues\n2) Visual hierarchy and scanability problems\n3) Interaction friction points\n4) High-impact design improvements\n5) Priority-ranked next edits",
    category: "Web Design",
    icon: "🎨",
    tags: ["ui", "design", "ux"],
    path: "fallback",
  },
  {
    id: "accessibility-ux-audit",
    name: "Accessibility UX Audit",
    summary: "Catch a11y issues in keyboard, semantics, and contrast",
    template:
      "Perform an accessibility-focused UX audit of the UI changes I am making.\n\nOutput:\n1) Keyboard navigation issues\n2) Semantic and ARIA issues\n3) Contrast/readability concerns\n4) Screen reader flow problems\n5) Concrete fixes with expected user impact",
    category: "Web Design",
    icon: "🎨",
    tags: ["a11y", "ux", "accessibility"],
    path: "fallback",
  },
  {
    id: "mobile-polish-pass",
    name: "Mobile Polish Pass",
    summary: "Tune small screens for readability and touch ergonomics",
    template:
      "Run a mobile polish pass on the UI I am working on.\n\nOutput:\n1) Layout and density issues on small screens\n2) Touch target and gesture risks\n3) Typography and readability adjustments\n4) Performance-sensitive visual effects to simplify\n5) Final mobile QA checklist",
    category: "Web Design",
    icon: "🎨",
    tags: ["mobile", "responsive", "ui"],
    path: "fallback",
  },
  {
    id: "doc-architecture-overview",
    name: "Architecture Overview",
    summary: "Write a clear architecture narrative for this system",
    template:
      "Draft an architecture overview for the code I am currently working on.\n\nOutput:\n1) System purpose and boundaries\n2) Major components and responsibilities\n3) Data and control flow\n4) Key design decisions and tradeoffs\n5) Known limitations and future direction",
    category: "Documentation",
    icon: "📝",
    tags: ["docs", "architecture", "overview"],
    path: "fallback",
  },
  {
    id: "doc-api-guide",
    name: "API Usage Guide",
    summary: "Document API usage, contracts, and failure modes",
    template:
      "Write an API guide for the interfaces touched by my current changes.\n\nOutput:\n1) Endpoint/function summary\n2) Inputs, outputs, and error model\n3) Examples for common use cases\n4) Failure modes and retries\n5) Compatibility and versioning notes",
    category: "Documentation",
    icon: "📝",
    tags: ["docs", "api", "guide"],
    path: "fallback",
  },
  {
    id: "doc-runbook",
    name: "Operational Runbook",
    summary: "Create runbook steps for diagnose, recover, and verify",
    template:
      "Draft an operational runbook for this feature or service.\n\nOutput:\n1) Symptoms and alert triggers\n2) Diagnosis checklist\n3) Recovery actions\n4) Validation after fix\n5) Escalation path and ownership",
    category: "Documentation",
    icon: "📝",
    tags: ["docs", "runbook", "operations"],
    path: "fallback",
  },
  {
    id: "commit-message",
    name: "Commit Message",
    summary: "Generate a high-quality commit message with rationale",
    template:
      "Write a commit message for the current changes.\n\nRequirements:\n- Use Conventional Commit style when appropriate\n- Subject <= 72 chars, imperative mood\n- Body explains why, not just what\n- Include notable risks or migration notes if relevant\n\nReturn:\n1) Primary commit message\n2) Two alternate subjects",
    category: "Delivery",
    icon: "🚀",
    tags: ["git", "commit", "workflow"],
    path: "fallback",
  },
  {
    id: "pr-summary",
    name: "PR Summary",
    summary: "Produce a reviewer-friendly pull request description",
    template:
      "Draft a PR description that helps reviewers quickly understand and validate the change.\n\nFormat:\n## Why\n## What changed\n## How to review\n## Validation\n## Risks\n## Rollout / follow-ups\n\nIf information is missing, add a short Assumptions section.",
    category: "Delivery",
    icon: "🚀",
    tags: ["git", "pr", "communication"],
    path: "fallback",
  },
  {
    id: "migration-plan",
    name: "Migration Plan",
    summary: "Plan safe rollout for schema/API/config changes",
    template:
      "Create a production-safe migration plan for the changes I am currently working on.\n\nOutput:\n1) Preconditions\n2) Ordered migration steps\n3) Backward compatibility strategy\n4) Rollback plan\n5) Verification in staging and production\n6) Stakeholder communication checklist",
    category: "Delivery",
    icon: "🚀",
    tags: ["migration", "release", "operations"],
    path: "fallback",
  },
  {
    id: "release-risk-checklist",
    name: "Release Risk Checklist",
    summary: "Pre-merge and pre-release risk gate",
    template:
      "Build a release readiness checklist for the work I am currently doing.\n\nInclude:\n- Test and quality gates\n- Security and performance checks\n- Monitoring/alerting updates\n- Documentation updates\n- Rollout and rollback readiness\n\nReturn a checklist grouped by Must / Should / Nice-to-have.",
    category: "Delivery",
    icon: "🚀",
    tags: ["release", "risk", "checklist"],
    path: "fallback",
  },
  {
    id: "docs-sync",
    name: "Docs Sync",
    summary: "Update docs to match real behavior",
    template:
      "Propose documentation updates to align with actual system behavior and current developer workflow for the code I am currently working on.\n\nOutput:\n1) Outdated or missing docs\n2) Proposed replacements (ready-to-paste)\n3) Common misunderstandings to prevent\n4) Quickstart verification steps",
    category: "Delivery",
    icon: "🚀",
    tags: ["docs", "developer-experience"],
    path: "fallback",
  },
  {
    id: "release-notes-draft",
    name: "Release Notes Draft",
    summary: "Draft clear user-facing release notes",
    template:
      "Draft release notes for the work currently in this branch.\n\nOutput:\n1) Headline summary\n2) User-visible changes\n3) Developer-facing/internal changes\n4) Breaking changes and migration notes\n5) Known issues and mitigations",
    category: "Delivery",
    icon: "🚀",
    tags: ["release", "notes", "communication"],
    path: "fallback",
  },
  {
    id: "rollback-runbook",
    name: "Rollback Runbook",
    summary: "Prepare a safe rollback procedure",
    template:
      "Create a rollback runbook for the change I am preparing to ship.\n\nOutput:\n1) Trigger conditions for rollback\n2) Exact rollback steps\n3) Data integrity and compatibility checks\n4) Monitoring during rollback\n5) Post-rollback verification and communication",
    category: "Delivery",
    icon: "🚀",
    tags: ["rollback", "operations", "incident"],
    path: "fallback",
  },
  {
    id: "ai-create-custom-prompt",
    name: "Create a Prompt That...",
    summary: "Generate and save a high-quality custom prompt from plain language",
    template:
      'You are a senior prompt librarian inside an OpenCode workspace. Your job is to convert a user intent into a real prompt file saved in the correct location so it appears in the Prompt Library.\n\nOperating expectations:\n- Be practical, explicit, and file-system aware.\n- Produce production-quality prompts (not one-liners).\n- If intent is ambiguous, make reasonable assumptions and state them briefly.\n- Do the file-writing work, not just advisory text.\n\nUser input (edit this):\nINSERT TEXT HERE\n\nOptional context from current selection:\n{{selection}}\n\nAssistant behavior:\n- Treat "INSERT TEXT HERE" as the user intent placeholder.\n- If it was not replaced and no useful selection context exists, ask one concise clarifying question before proceeding.\n\nTask:\nConvert the user intent into a reusable prompt and create or update a JSON file in:\n- `.opencode/prompts/custom/<slug>.json`\n\nFile and format rules:\n- Use top-level keys: `version`, `category`, `categoryIcon`, `prompts`\n- Prompt keys: `id`, `name`, `summary`, `template`, `tags`\n- Use `version: "2.0"`\n- Default to `category: "custom"` and `categoryIcon: "✨"` unless user asks otherwise\n- Keep `id` stable kebab-case\n- Ensure `template` includes role framing, operating expectations, task section, and structured output contract\n\nExecution steps:\n1) Infer purpose, audience, and output style from user intent\n2) Draft full prompt JSON object\n3) Write to `.opencode/prompts/custom/<slug>.json`\n4) If file exists, merge safely by `id` unless user requests replace\n5) Validate JSON and required fields\n6) Report file path, prompt id, and name',
    category: "AI",
    icon: "✨",
    tags: ["ai", "prompting", "meta", "template-generation"],
    path: "fallback",
  },
]

const normalizePath = (value: string) => value.replaceAll("\\", "/")
const joinPath = (base: string, part: string) => `${normalizePath(base).replace(/\/+$/, "")}/${part}`
const PRIMARY_PROMPT_ID = "ai-create-custom-prompt"
const categoryName = (value?: string) =>
  value
    ? value.toLowerCase() === "qa"
      ? "QA"
      : value
          .split(/[-_]/g)
          .filter(Boolean)
          .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
          .join(" ")
    : "General"

function renderPromptTemplate(template: string, values: { selection: string; clipboard: string }) {
  return template.replaceAll("{{selection}}", values.selection).replaceAll("{{clipboard}}", values.clipboard)
}

export function SessionSidePanel(props: {
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
}) {
  const params = useParams()
  const layout = useLayout()
  const sync = useSync()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const sdk = useSDK()
  const prompt = usePrompt()
  const platform = usePlatform()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey))
  const view = createMemo(() => layout.view(sessionKey))

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const open = createMemo(
    () => isDesktop() && (view().reviewPanel.opened() || layout.fileTree.opened() || layout.fileTree.promptOpened()),
  )
  const reviewTab = createMemo(() => isDesktop())

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))
  const reviewCount = createMemo(() => Math.max(info()?.summary?.files ?? 0, diffs().length))
  const hasReview = createMemo(() => reviewCount() > 0)
  const diffsReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    if (!hasReview()) return true
    return sync.data.session_diff[id] !== undefined
  })

  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalize(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const contextOpen = createMemo(() => tabs().active() === "context" || tabs().all().includes("context"))
  const openedTabs = createMemo(() =>
    tabs()
      .all()
      .filter((tab) => tab !== "context" && tab !== "review"),
  )

  const activeTab = createMemo(() => {
    const active = tabs().active()
    if (active === "context") return "context"
    if (active === "review" && reviewTab()) return "review"
    if (active && file.pathFromTab(active)) return normalizeTab(active)

    const first = openedTabs()[0]
    if (first) return first
    if (contextOpen()) return "context"
    if (reviewTab() && hasReview()) return "review"
    return "empty"
  })

  const activeFileTab = createMemo(() => {
    const active = activeTab()
    if (!openedTabs().includes(active)) return
    return active
  })

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
    fileTreeScrolled: false,
    promptSearch: "",
    promptList: [] as PromptItem[],
  })
  const [pref, setPref] = persisted(
    Persist.global("layout.prompt", ["layout.prompt.v1"]),
    createStore({
      category: {} as Record<string, boolean>,
    }),
  )

  let changesEl: HTMLDivElement | undefined
  let allEl: HTMLDivElement | undefined

  const syncFileTreeScrolled = (el?: HTMLDivElement) => {
    const next = (el?.scrollTop ?? 0) > 0
    setStore("fileTreeScrolled", (current) => (current === next ? current : next))
  }

  const promptRoot = createMemo(() => joinPath(sdk.directory, ".opencode/prompts"))
  const promptOpen = createMemo(() => layout.fileTree.promptOpened())
  const promptHeight = createMemo(() => layout.fileTree.promptHeight())
  const treeHeight = createMemo(() => (promptOpen() ? `calc(100% - ${promptHeight()}px)` : "100%"))

  const promptFiltered = createMemo(() => {
    const q = store.promptSearch.trim().toLowerCase()
    if (!q) return store.promptList
    return store.promptList.filter((item) => {
      if (item.name.toLowerCase().includes(q)) return true
      if (item.summary?.toLowerCase().includes(q)) return true
      if (item.description?.toLowerCase().includes(q)) return true
      if (item.category.toLowerCase().includes(q)) return true
      if (item.tags.some((tag) => tag.toLowerCase().includes(q))) return true
      return item.template.toLowerCase().includes(q)
    })
  })

  const promptGrouped = createMemo(() => {
    const map = new Map<string, PromptItem[]>()
    for (const item of promptFiltered()) {
      if (item.id === PRIMARY_PROMPT_ID) continue
      const list = map.get(item.category) ?? []
      list.push(item)
      map.set(item.category, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  })

  const promptPrimary = createMemo(() => promptFiltered().find((item) => item.id === PRIMARY_PROMPT_ID))

  const readPromptFile = (path: string) =>
    sdk.client.file
      .read({ path })
      .then((result) => {
        const text = result.data?.content
        if (!text) return [] as PromptItem[]
        const parsed = JSON.parse(text) as PromptDoc
        if (!parsed.prompts?.length) return [] as PromptItem[]
        return parsed.prompts
          .filter((item) => item.id && item.name && item.template)
          .map((item) => ({
            id: item.id,
            name: item.name,
            summary: item.summary ?? item.description,
            template: item.template,
            tags: item.tags ?? [],
            category: categoryName(parsed.category),
            icon: parsed.categoryIcon,
            path,
          }))
      })
      .catch(() => [] as PromptItem[])

  const promptRoots = (dir: string) => {
    const base = normalizePath(dir).replace(/\/+$/, "")
    const parts = base.split("/").filter(Boolean)
    const out: string[] = [".opencode/prompts"]
    if (parts.length === 0) return out
    const head = base.startsWith("/") ? "/" : /^[A-Za-z]:$/.test(parts[0] ?? "") ? `${parts[0]}/` : ""
    const body = head ? parts.slice(1) : parts
    for (let i = 1; i <= body.length; i++) out.push(`${"../".repeat(i)}.opencode/prompts`)
    for (let i = body.length; i >= 0; i--) {
      const path = `${head}${body.slice(0, i).join("/")}`.replace(/\/+$/, "")
      out.push(`${path}/.opencode/prompts`.replace(/^\/+/, head ? "" : "/"))
    }
    return Array.from(new Set(out))
  }

  const listPromptFiles = async (root: string) => {
    const out = new Set<string>()
    const walk = async (dir: string): Promise<void> => {
      const nodes = await sdk.client.file
        .list({ path: dir })
        .then((r) => r.data ?? [])
        .catch(() => [])
      await Promise.all(
        nodes.map(async (node) => {
          if (node.type === "file" && node.path.endsWith(".json")) {
            out.add(node.path)
            return
          }
          if (node.type !== "directory") return
          await walk(node.path)
        }),
      )
    }
    await walk(root)
    return Array.from(out)
  }

  const reloadPrompts = () => {
    Promise.all(promptRoots(sdk.directory).map((root) => listPromptFiles(root)))
      .then(async (groups) => {
        const files = Array.from(new Set(groups.flat()))
        const loaded = files.length > 0 ? (await Promise.all(files.map((file) => readPromptFile(file)))).flat() : []
        const legacy = loaded.length > 0 && loaded.every((item) => item.category === "Starter")
        setStore("promptList", loaded.length > 0 && !legacy ? loaded : FALLBACK_PROMPTS)
      })
      .catch(() => {
        setStore("promptList", FALLBACK_PROMPTS)
      })
  }

  createEffect(() => {
    promptRoot()
    reloadPrompts()
  })

  createEffect(() => {
    if (!promptOpen()) return
    reloadPrompts()
  })

  createEffect(() => {
    if (!promptOpen()) return
    const timer = setInterval(reloadPrompts, 2000)
    onCleanup(() => clearInterval(timer))
  })

  const togglePromptCategory = (category: string) => {
    setPref("category", category, (value) => !(value ?? false))
  }

  const isPromptCategoryOpen = (category: string) => {
    if (store.promptSearch) return true
    return pref.category[category] ?? false
  }

  const selectedText = () => {
    const active = tabs().active()
    if (!active) return ""
    const path = file.pathFromTab(active)
    if (!path) return ""
    const range = file.selectedLines(path)
    if (!range || typeof range !== "object") return ""
    if (!("startLine" in range) || !("endLine" in range)) return ""
    const content = file.get(path)?.content?.content
    if (!content) return ""
    const startLine = Number(range.startLine)
    const endLine = Number(range.endLine)
    const start = Math.max(1, Math.min(startLine, endLine))
    const end = Math.max(startLine, endLine)
    return content
      .split("\n")
      .slice(start - 1, end)
      .join("\n")
  }

  const applyPrompt = (item: PromptItem) => {
    const text = renderPromptTemplate(item.template, {
      selection: selectedText(),
      clipboard: "",
    })
    prompt.set(
      [
        {
          type: "text",
          content: text,
          start: 0,
          end: text.length,
        },
      ],
      text.length,
    )
    showToast({
      variant: "success",
      title: "Prompt inserted",
      description: item.name,
    })
  }

  const openPromptFolder = () => {
    if (!platform.openPath) {
      showToast({ variant: "default", title: "Open folder not available" })
      return
    }
    platform.openPath(promptRoot()).catch((error) => {
      showToast({
        variant: "error",
        title: "Failed to open prompt folder",
        description: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  createEffect(() => {
    if (!layout.fileTree.opened()) return
    syncFileTreeScrolled(fileTreeTab() === "changes" ? changesEl : allEl)
  })

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  return (
    <Show when={open()}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        class="relative min-w-0 h-full border-l border-border-weak-base flex"
        classList={{
          "flex-1": reviewOpen(),
          "shrink-0": !reviewOpen(),
        }}
        style={{ width: reviewOpen() ? undefined : `${layout.fileTree.width()}px` }}
      >
        <Show when={reviewOpen()}>
          <div class="flex-1 min-w-0 h-full">
            <DragDropProvider
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragYAxis />
              <Tabs value={activeTab()} onChange={openTab}>
                <div class="sticky top-0 shrink-0 flex">
                  <Tabs.List
                    ref={(el: HTMLDivElement) => {
                      const stop = createFileTabListSync({ el, contextOpen })
                      onCleanup(stop)
                    }}
                  >
                    <Show when={reviewTab()}>
                      <Tabs.Trigger value="review">
                        <div class="flex items-center gap-1.5">
                          <div>{language.t("session.tab.review")}</div>
                          <Show when={hasReview()}>
                            <div>{reviewCount()}</div>
                          </Show>
                        </div>
                      </Tabs.Trigger>
                    </Show>
                    <Show when={contextOpen()}>
                      <Tabs.Trigger
                        value="context"
                        closeButton={
                          <TooltipKeybind
                            title={language.t("common.closeTab")}
                            keybind={command.keybind("tab.close")}
                            placement="bottom"
                            gutter={10}
                          >
                            <IconButton
                              icon="close-small"
                              variant="ghost"
                              class="h-5 w-5"
                              onClick={() => tabs().close("context")}
                              aria-label={language.t("common.closeTab")}
                            />
                          </TooltipKeybind>
                        }
                        hideCloseButton
                        onMiddleClick={() => tabs().close("context")}
                      >
                        <div class="flex items-center gap-2">
                          <SessionContextUsage variant="indicator" />
                          <div>{language.t("session.tab.context")}</div>
                        </div>
                      </Tabs.Trigger>
                    </Show>
                    <SortableProvider ids={openedTabs()}>
                      <For each={openedTabs()}>{(tab) => <SortableTab tab={tab} onTabClose={tabs().close} />}</For>
                    </SortableProvider>
                    <StickyAddButton>
                      <TooltipKeybind
                        title={language.t("command.file.open")}
                        keybind={command.keybind("file.open")}
                        class="flex items-center"
                      >
                        <IconButton
                          icon="plus-small"
                          variant="ghost"
                          iconSize="large"
                          class="!rounded-md"
                          onClick={() => dialog.show(() => <DialogSelectFile mode="files" onOpenFile={showAllFiles} />)}
                          aria-label={language.t("command.file.open")}
                        />
                      </TooltipKeybind>
                    </StickyAddButton>
                  </Tabs.List>
                </div>

                <Show when={reviewTab()}>
                  <Tabs.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                    <Show when={activeTab() === "review"}>{props.reviewPanel()}</Show>
                  </Tabs.Content>
                </Show>

                <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                  <Show when={activeTab() === "empty"}>
                    <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                      <div class="h-full px-6 pb-42 flex flex-col items-center justify-center text-center gap-6">
                        <Mark class="w-14 opacity-10" />
                        <div class="text-14-regular text-text-weak max-w-56">
                          {language.t("session.files.selectToOpen")}
                        </div>
                      </div>
                    </div>
                  </Show>
                </Tabs.Content>

                <Show when={contextOpen()}>
                  <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                    <Show when={activeTab() === "context"}>
                      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                        <SessionContextTab />
                      </div>
                    </Show>
                  </Tabs.Content>
                </Show>

                <Show when={activeFileTab()} keyed>
                  {(tab) => <FileTabContent tab={tab} />}
                </Show>
              </Tabs>
              <DragOverlay>
                <Show when={store.activeDraggable} keyed>
                  {(tab) => {
                    const path = createMemo(() => file.pathFromTab(tab))
                    return (
                      <div data-component="tabs-drag-preview">
                        <Show when={path()}>{(p) => <FileVisual active path={p()} />}</Show>
                      </div>
                    )
                  }}
                </Show>
              </DragOverlay>
            </DragDropProvider>
          </div>
        </Show>

        <Show when={layout.fileTree.opened() || promptOpen()}>
          <div id="file-tree-panel" class="relative shrink-0 h-full" style={{ width: `${layout.fileTree.width()}px` }}>
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-l border-border-weak-base": reviewOpen() }}
            >
              <Show when={layout.fileTree.opened()}>
                <div class="min-h-0" style={{ height: treeHeight() }}>
                  <Tabs
                    variant="pill"
                    value={fileTreeTab()}
                    onChange={setFileTreeTabValue}
                    class="h-full"
                    data-scope="filetree"
                  >
                    <Tabs.List data-scrolled={store.fileTreeScrolled ? "" : undefined}>
                      <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                        {reviewCount()}{" "}
                        {language.t(reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
                      </Tabs.Trigger>
                      <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                        {language.t("session.files.all")}
                      </Tabs.Trigger>
                    </Tabs.List>
                    <Tabs.Content
                      value="changes"
                      ref={(el: HTMLDivElement) => (changesEl = el)}
                      onScroll={(e: UIEvent & { currentTarget: HTMLDivElement }) =>
                        syncFileTreeScrolled(e.currentTarget)
                      }
                      class="bg-background-stronger px-3 py-0"
                    >
                      <Switch>
                        <Match when={hasReview()}>
                          <Show
                            when={diffsReady()}
                            fallback={
                              <div class="px-2 py-2 text-12-regular text-text-weak">
                                {language.t("common.loading")}
                                {language.t("common.loading.ellipsis")}
                              </div>
                            }
                          >
                            <FileTree
                              path=""
                              allowed={diffFiles()}
                              kinds={kinds()}
                              draggable={false}
                              active={props.activeDiff}
                              onFileClick={(node) => props.focusReviewDiff(node.path)}
                            />
                          </Show>
                        </Match>
                        <Match when={true}>
                          <div class="mt-8 text-center text-12-regular text-text-weak">
                            {language.t("session.review.noChanges")}
                          </div>
                        </Match>
                      </Switch>
                    </Tabs.Content>
                    <Tabs.Content
                      value="all"
                      ref={(el: HTMLDivElement) => (allEl = el)}
                      onScroll={(e: UIEvent & { currentTarget: HTMLDivElement }) =>
                        syncFileTreeScrolled(e.currentTarget)
                      }
                      class="bg-background-stronger px-3 py-0"
                    >
                      <FileTree
                        path=""
                        modified={diffFiles()}
                        kinds={kinds()}
                        onFileClick={(node) => openTab(file.tab(node.path))}
                      />
                    </Tabs.Content>
                  </Tabs>
                </div>
              </Show>

              <Show when={promptOpen()}>
                <div
                  id="prompt-library-panel"
                  class="relative shrink-0"
                  classList={{ "border-t border-border-weak-base": layout.fileTree.opened() }}
                  style={{ height: layout.fileTree.opened() ? `${promptHeight()}px` : "100%" }}
                >
                  <Show when={layout.fileTree.opened()}>
                    <ResizeHandle
                      direction="vertical"
                      edge="start"
                      size={promptHeight()}
                      min={140}
                      max={typeof window === "undefined" ? 700 : window.innerHeight * 0.6}
                      collapseThreshold={90}
                      onResize={layout.fileTree.resizePrompt}
                      onCollapse={layout.fileTree.togglePrompt}
                    />
                  </Show>
                  <div class="h-full bg-background-stronger px-3 py-2 flex flex-col gap-2">
                    <div class="flex items-center gap-2">
                      <div class="flex items-center gap-1 text-12-medium text-text-weak uppercase tracking-wide">
                        <Icon name="prompt" size="small" />
                        Prompts
                      </div>
                      <button
                        type="button"
                        class="ml-auto h-6 px-2 rounded-md border border-border-weak-base text-12-medium hover:bg-surface-base-hover"
                        onClick={openPromptFolder}
                      >
                        Open folder
                      </button>
                    </div>

                    <div class="flex items-center gap-2">
                      <input
                        value={store.promptSearch}
                        onInput={(event) => setStore("promptSearch", event.currentTarget.value)}
                        placeholder="Search prompts"
                        class="w-full h-7 px-2 rounded-md border border-border-weak-base bg-surface-panel text-13-regular outline-none"
                      />
                    </div>

                    <div class="min-h-0 overflow-auto pr-1" data-scrollable>
                      <Show
                        when={promptFiltered().length > 0}
                        fallback={
                          <div class="text-12-regular text-text-weak">No prompts found. Click + to add one.</div>
                        }
                      >
                        <For each={promptGrouped()}>
                          {([category, items]) => (
                            <div class="mb-2">
                              <button
                                type="button"
                                class="w-full flex items-center gap-1 text-left text-12-medium text-text-weak hover:text-text-strong"
                                onClick={() => togglePromptCategory(category)}
                              >
                                <span>{isPromptCategoryOpen(category) ? "▼" : "▶"}</span>
                                <span>{items[0]?.icon ? `${items[0].icon} ${category}` : category}</span>
                                <span class="text-text-dim">({items.length})</span>
                              </button>
                              <Show when={isPromptCategoryOpen(category)}>
                                <div class="mt-1 flex flex-col gap-1">
                                  <For each={items}>
                                    {(item) => (
                                      <ContextMenu>
                                        <ContextMenu.Trigger
                                          as="button"
                                          type="button"
                                          class="w-full text-left px-2 py-1.5 rounded-md border border-transparent hover:border-border-weak-base hover:bg-surface-base-hover"
                                          onClick={() => void applyPrompt(item)}
                                        >
                                          <div class="text-12-medium text-text-strong truncate">{item.name}</div>
                                          <Show when={item.summary ?? item.description}>
                                            <div class="text-11-regular text-text-weak truncate">
                                              {item.summary ?? item.description}
                                            </div>
                                          </Show>
                                        </ContextMenu.Trigger>
                                        <ContextMenu.Portal>
                                          <ContextMenu.Content>
                                            <ContextMenu.Item onSelect={() => void applyPrompt(item)}>
                                              <ContextMenu.ItemLabel>Use prompt</ContextMenu.ItemLabel>
                                            </ContextMenu.Item>
                                            <ContextMenu.Item
                                              onSelect={() => {
                                                navigator.clipboard.writeText(item.template).catch(() => {})
                                              }}
                                            >
                                              <ContextMenu.ItemLabel>Copy template</ContextMenu.ItemLabel>
                                            </ContextMenu.Item>
                                            <ContextMenu.Item onSelect={openPromptFolder}>
                                              <ContextMenu.ItemLabel>Customize prompts</ContextMenu.ItemLabel>
                                            </ContextMenu.Item>
                                          </ContextMenu.Content>
                                        </ContextMenu.Portal>
                                      </ContextMenu>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                        <Show when={promptPrimary()}>
                          {(item) => (
                            <div class="mt-2">
                              <ContextMenu>
                                <ContextMenu.Trigger
                                  as="button"
                                  type="button"
                                  class="w-full text-left px-2 py-1.5 rounded-md hover:bg-surface-base-hover"
                                  onClick={() => void applyPrompt(item())}
                                >
                                  <div class="text-12-medium text-text-strong truncate flex items-center gap-2">
                                    <span style={{ color: "#22c55e", "font-weight": "700", "line-height": "1" }}>
                                      +
                                    </span>
                                    <span>{item().name}</span>
                                  </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                  <ContextMenu.Content>
                                    <ContextMenu.Item onSelect={() => void applyPrompt(item())}>
                                      <ContextMenu.ItemLabel>Use prompt</ContextMenu.ItemLabel>
                                    </ContextMenu.Item>
                                    <ContextMenu.Item
                                      onSelect={() => {
                                        navigator.clipboard.writeText(item().template).catch(() => {})
                                      }}
                                    >
                                      <ContextMenu.ItemLabel>Copy template</ContextMenu.ItemLabel>
                                    </ContextMenu.Item>
                                    <ContextMenu.Item onSelect={openPromptFolder}>
                                      <ContextMenu.ItemLabel>Customize prompts</ContextMenu.ItemLabel>
                                    </ContextMenu.Item>
                                  </ContextMenu.Content>
                                </ContextMenu.Portal>
                              </ContextMenu>
                            </div>
                          )}
                        </Show>
                      </Show>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={layout.fileTree.width()}
              min={200}
              max={480}
              collapseThreshold={160}
              onResize={layout.fileTree.resize}
              onCollapse={layout.fileTree.close}
            />
          </div>
        </Show>
      </aside>
    </Show>
  )
}
