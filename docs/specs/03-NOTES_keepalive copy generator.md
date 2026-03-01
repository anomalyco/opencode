
---

## 1) Contract

```ts
type KeepaliveLine = {
  id: string
  text: string
  kind: "keepalive" | "polling" | "status" | "hint"
  confidence: "truth"          // always truth; no “claims”
}

type KeepaliveOutput = {
  headline: string             // short, phase-appropriate
  lines: KeepaliveLine[]       // rotate/cycle in UI
  rotateEveryMs: number        // e.g. 1200–2500ms
}
```

### Usage pattern

* Call `generateTruthfulKeepalive(run, now)` every UI tick (or every second).
* The UI picks the “current line” based on `(now / rotateEveryMs) % lines.length`.

---

## 2) Hard rules (enforced in code)

**Allowed facts**

* `run.task`, `run.repoUrl`
* `run.phase`, `run.providerState.julesStatus`
* `run.plan.summary`, `run.plan.steps[].text`, and `active step` *as a plan reference*
* time deltas: `now - run.lastTruthAt`, `run.nextPollAt - now`, `now - run.startedAt`
* counts: `run.pollCount`, `run.timeline.length`, `run.artifacts.length`

**Forbidden claims**
Any statement that implies an action occurred unless you have an artifact or an explicit activity that says so. Examples forbidden:

* “Applied patch,” “Updated files,” “Opened PR,” “Ran tests,” “Fixed bug,” “Committed changes.”

**Allowed “doing” language**
Only as *waiting / processing / following the plan*:

* “Waiting for an update…”
* “Working through the plan step: …”
* “Executing (per plan): …”

**If unsure**: phrase as *“Based on the plan…”* or *“Waiting…”*.

---

## 3) Reference implementation

```ts
function generateTruthfulKeepalive(run: Run, now: number): KeepaliveOutput {
  const phase = run.phase
  const elapsedSec = Math.max(0, Math.floor((now - run.startedAt) / 1000))
  const sinceTruthSec = Math.max(0, Math.floor((now - run.lastTruthAt) / 1000))
  const nextPollSec = Math.max(0, Math.ceil((run.nextPollAt - now) / 1000))

  const repoName = shortRepo(run.repoUrl)
  const activeStep = getActiveStepText(run)
  const planSummary = run.plan?.summary

  const headline =
    phase === "queued" ? "Queued"
    : phase === "planning" ? "Planning"
    : phase === "awaiting_approval" ? "Plan ready"
    : phase === "executing" ? "Working"
    : phase === "completed" ? "Completed"
    : phase === "failed" ? "Failed"
    : "Cancelled"

  const lines: KeepaliveLine[] = []

  // Always-safe polling/status lines
  lines.push({
    id: "poll-next",
    kind: "polling",
    confidence: "truth",
    text: nextPollSec > 0
      ? `Next check in ${nextPollSec}s.`
      : `Checking for updates…`,
  })

  lines.push({
    id: "truth-age",
    kind: "status",
    confidence: "truth",
    text: `Last confirmed update ${sinceTruthSec}s ago.`,
  })

  lines.push({
    id: "meta",
    kind: "status",
    confidence: "truth",
    text: `Run: ${repoName} • ${elapsedSec}s elapsed • ${run.pollCount} polls`,
  })

  // Phase-specific truthy lines
  if (phase === "queued") {
    lines.push({
      id: "queued-1",
      kind: "keepalive",
      confidence: "truth",
      text: `Queued in Jules. Waiting to begin planning.`,
    })
    lines.push({
      id: "queued-2",
      kind: "keepalive",
      confidence: "truth",
      text: `Task: ${truncate(run.task, 80)}`,
    })
  }

  if (phase === "planning") {
    if (planSummary) {
      lines.push({
        id: "planning-plan",
        kind: "keepalive",
        confidence: "truth",
        text: `Drafting a plan: ${truncate(planSummary, 90)}`,
      })
    } else {
      lines.push({
        id: "planning-1",
        kind: "keepalive",
        confidence: "truth",
        text: `Building a plan for: ${truncate(run.task, 90)}`,
      })
    }
    lines.push({
      id: "planning-2",
      kind: "hint",
      confidence: "truth",
      text: `Tip: you can keep working; updates will appear here as they arrive.`,
    })
  }

  if (phase === "awaiting_approval") {
    lines.push({
      id: "approval-1",
      kind: "keepalive",
      confidence: "truth",
      text: `Review the plan and approve to continue execution.`,
    })
    if (planSummary) {
      lines.push({
        id: "approval-2",
        kind: "status",
        confidence: "truth",
        text: `Plan summary: ${truncate(planSummary, 100)}`,
      })
    }
    lines.push({
      id: "approval-3",
      kind: "hint",
      confidence: "truth",
      text: `Rejecting with feedback will send your notes back into planning.`,
    })
  }

  if (phase === "executing") {
    if (activeStep) {
      lines.push({
        id: "exec-step",
        kind: "keepalive",
        confidence: "truth",
        text: `Executing (per plan): ${truncate(activeStep, 100)}`,
      })
    } else if (planSummary) {
      lines.push({
        id: "exec-plan",
        kind: "keepalive",
        confidence: "truth",
        text: `Executing the approved plan: ${truncate(planSummary, 100)}`,
      })
    } else {
      lines.push({
        id: "exec-1",
        kind: "keepalive",
        confidence: "truth",
        text: `Execution in progress. Waiting for new activity from Jules…`,
      })
    }

    // Safe “no-dead-air” lines that don’t claim work completed
    lines.push({
      id: "exec-2",
      kind: "keepalive",
      confidence: "truth",
      text: `If nothing appears for a bit, it’s usually just deep work between updates.`,
    })
    lines.push({
      id: "exec-3",
      kind: "hint",
      confidence: "truth",
      text: `You can add guidance, but avoid changing scope mid-run unless needed.`,
    })
  }

  if (phase === "completed") {
    const artCount = run.artifacts.length
    lines.push({
      id: "done-1",
      kind: "status",
      confidence: "truth",
      text: artCount > 0
        ? `Artifacts received (${artCount}). Review them before applying.`
        : `Run completed. No artifacts reported.`,
    })
    lines.push({
      id: "done-2",
      kind: "hint",
      confidence: "truth",
      text: `Next: inspect diff/PR, then decide whether to apply.`,
    })
  }

  if (phase === "failed") {
    const err = run.providerState.error
    lines.push({
      id: "fail-1",
      kind: "status",
      confidence: "truth",
      text: err ? `Error: ${truncate(err, 140)}` : `Run failed. See timeline for details.`,
    })
    lines.push({
      id: "fail-2",
      kind: "hint",
      confidence: "truth",
      text: `Common recovery: retry with narrower scope or add clarifying constraints.`,
    })
  }

  if (phase === "cancelled") {
    lines.push({
      id: "cancel-1",
      kind: "status",
      confidence: "truth",
      text: `Run cancelled.`,
    })
  }

  // Important: remove duplicates by id (in case of branching)
  const uniq = dedupeById(lines)

  // Rotation speed: slightly faster during planning/exec, slower otherwise
  const rotateEveryMs =
    phase === "planning" ? 1300
    : phase === "executing" ? 1200
    : phase === "awaiting_approval" ? 1800
    : 2000

  return { headline, lines: uniq, rotateEveryMs }
}

/** Helpers */
function getActiveStepText(run: Run): string | undefined {
  const steps = run.plan?.steps
  if (!steps) return undefined
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].state === "active") return steps[i].text
  }
  return undefined
}

function shortRepo(repoUrl: string): string {
  // best-effort: show owner/repo
  // supports: https://github.com/owner/repo, sources/github/owner/repo, etc.
  const m = repoUrl.match(/github\.com\/([^\/]+\/[^\/#?]+)/)
  if (m && m[1]) return m[1]
  const s = repoUrl.match(/sources\/github\/([^\/]+\/[^\/]+)/)
  if (s && s[1]) return s[1]
  return truncate(repoUrl.replace(/^https?:\/\//, ""), 28)
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, Math.max(0, n - 1)) + "…"
}

function dedupeById(lines: KeepaliveLine[]): KeepaliveLine[] {
  const seen = new Set<string>()
  const out: KeepaliveLine[] = []
  for (const l of lines) {
    if (seen.has(l.id)) continue
    seen.add(l.id)
    out.push(l)
  }
  return out
}
```

---

## 4) How it “cycles like a normal thinking pipeline”

* Your timeline stream updates only when the **truth loop** adds events.
* The keepalive generator **always has 6–12 safe lines** to rotate through, so there’s never dead air.
* The top line (“Next check in Xs”) makes the system feel alive **without inventing content**.

---

## 5) Optional upgrade: “micro-to-do progress” without lying

If you want the to-do list to show motion during long silences:

* keep `active` step pulsing
* show a “time in step” counter (`now - lastTruthAt` or a separate `activeStepSinceAt`)
* avoid marking any step “done_confirmed” unless you have evidence (artifact or explicit activity)
