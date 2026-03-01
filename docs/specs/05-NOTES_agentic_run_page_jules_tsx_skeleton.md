import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Agentic Run Page (Jules) — single-file TSX skeleton
 * - Two-loop UX: truth polling + perception keepalive ticker
 * - Mock Jules client included for demo (no network)
 * - Minimal layout (Tailwind classes only)
 */

// -----------------------------
// Types (IDE model)
// -----------------------------

type JulesStatus =
  | "QUEUED"
  | "PLANNING"
  | "AWAITING_PLAN_APPROVAL"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

type JulesPlan = { summary: string; steps: string[] };

type JulesActivityResponse = {
  id: string;
  type: string;
  status: string;
  data: Record<string, unknown>;
};

type JulesArtifactResponse = {
  id: string;
  type: "git_patch" | "pull_request";
  title: string;
  url?: string;
  patch?: string;
};

type JulesSessionResponse = {
  id: string;
  status: JulesStatus;
  plan?: JulesPlan;
  activities?: JulesActivityResponse[];
  artifacts?: JulesArtifactResponse[];
  error?: string;
};

type RunPhase =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

type RunEvent = {
  eventId: string;
  at: number;
  source: "status" | "activity" | "artifact" | "system";
  level: "info" | "warn" | "error";
  title: string;
  detail?: string;
  raw?: unknown;
};

type Artifact =
  | { id: string; type: "git_patch"; title: string; patch?: string; url?: string; raw?: unknown }
  | { id: string; type: "pull_request"; title: string; url?: string; raw?: unknown };

type RunPlanStep = {
  text: string;
  state: "pending" | "active" | "done_confirmed" | "done_estimated";
  evidence?: { eventId: string };
};

type Run = {
  runId: string;
  provider: "jules";
  repoUrl: string;
  task: string;

  phase: RunPhase;
  providerState: { julesStatus: JulesStatus; error?: string };

  startedAt: number;
  endedAt?: number;

  lastTruthAt: number;
  lastPollAt: number;
  nextPollAt: number;
  pollCount: number;

  plan?: { summary: string; steps: RunPlanStep[] };
  timeline: RunEvent[];
  artifacts: Artifact[];
};

// -----------------------------
// Poll config (ADR-aligned defaults)
// -----------------------------

const POLL = {
  initialDelay: 2000,
  planningInterval: 5000,
  executionInterval: 10000,
  maxDuration: 60 * 60 * 1000,
  maxPolls: 360,
};

// -----------------------------
// Keepalive generator
// -----------------------------

type KeepaliveLine = {
  id: string;
  text: string;
  kind: "keepalive" | "polling" | "status" | "hint";
  confidence: "truth";
};

type KeepaliveOutput = {
  headline: string;
  lines: KeepaliveLine[];
  rotateEveryMs: number;
};

function generateTruthfulKeepalive(run: Run | null, now: number): KeepaliveOutput {
  if (!run) {
    return {
      headline: "Ready",
      rotateEveryMs: 1600,
      lines: [
        { id: "idle-1", kind: "keepalive", confidence: "truth", text: "Start a run to see progress here." },
      ],
    };
  }

  const phase = run.phase;
  const elapsedSec = Math.max(0, Math.floor((now - run.startedAt) / 1000));
  const sinceTruthSec = Math.max(0, Math.floor((now - run.lastTruthAt) / 1000));
  const nextPollSec = Math.max(0, Math.ceil((run.nextPollAt - now) / 1000));

  const repoName = shortRepo(run.repoUrl);
  const activeStep = getActiveStepText(run);
  const planSummary = run.plan?.summary;

  const headline =
    phase === "queued"
      ? "Queued"
      : phase === "planning"
        ? "Planning"
        : phase === "awaiting_approval"
          ? "Plan ready"
          : phase === "executing"
            ? "Working"
            : phase === "completed"
              ? "Completed"
              : phase === "failed"
                ? "Failed"
                : "Cancelled";

  const lines: KeepaliveLine[] = [];

  lines.push({
    id: "poll-next",
    kind: "polling",
    confidence: "truth",
    text: nextPollSec > 0 ? `Next check in ${nextPollSec}s.` : "Checking for updates…",
  });

  lines.push({
    id: "truth-age",
    kind: "status",
    confidence: "truth",
    text: `Last confirmed update ${sinceTruthSec}s ago.`,
  });

  lines.push({
    id: "meta",
    kind: "status",
    confidence: "truth",
    text: `Run: ${repoName} • ${elapsedSec}s elapsed • ${run.pollCount} polls`,
  });

  if (phase === "queued") {
    lines.push({
      id: "queued-1",
      kind: "keepalive",
      confidence: "truth",
      text: "Queued in Jules. Waiting to begin planning.",
    });
    lines.push({
      id: "queued-2",
      kind: "keepalive",
      confidence: "truth",
      text: `Task: ${truncate(run.task, 90)}`,
    });
  }

  if (phase === "planning") {
    lines.push({
      id: "planning-1",
      kind: "keepalive",
      confidence: "truth",
      text: planSummary
        ? `Drafting a plan: ${truncate(planSummary, 110)}`
        : `Building a plan for: ${truncate(run.task, 110)}`,
    });
    lines.push({
      id: "planning-2",
      kind: "hint",
      confidence: "truth",
      text: "Tip: keep working; updates will appear here as they arrive.",
    });
  }

  if (phase === "awaiting_approval") {
    lines.push({
      id: "approval-1",
      kind: "keepalive",
      confidence: "truth",
      text: "Review the plan and approve to continue execution.",
    });
    if (planSummary) {
      lines.push({
        id: "approval-2",
        kind: "status",
        confidence: "truth",
        text: `Plan summary: ${truncate(planSummary, 120)}`,
      });
    }
    lines.push({
      id: "approval-3",
      kind: "hint",
      confidence: "truth",
      text: "Rejecting with feedback sends your notes back into planning.",
    });
  }

  if (phase === "executing") {
    lines.push({
      id: "exec-1",
      kind: "keepalive",
      confidence: "truth",
      text: activeStep
        ? `Executing (per plan): ${truncate(activeStep, 120)}`
        : planSummary
          ? `Executing the approved plan: ${truncate(planSummary, 120)}`
          : "Execution in progress. Waiting for new activity from Jules…",
    });

    lines.push({
      id: "exec-2",
      kind: "keepalive",
      confidence: "truth",
      text: "If nothing appears for a bit, it’s usually deep work between updates.",
    });

    lines.push({
      id: "exec-3",
      kind: "hint",
      confidence: "truth",
      text: "You can add guidance if needed; avoid changing scope mid-run.",
    });
  }

  if (phase === "completed") {
    const artCount = run.artifacts.length;
    lines.push({
      id: "done-1",
      kind: "status",
      confidence: "truth",
      text:
        artCount > 0
          ? `Artifacts received (${artCount}). Review them before applying.`
          : "Run completed. No artifacts reported.",
    });
    lines.push({
      id: "done-2",
      kind: "hint",
      confidence: "truth",
      text: "Next: inspect patch/PR, then decide whether to apply.",
    });
  }

  if (phase === "failed") {
    lines.push({
      id: "fail-1",
      kind: "status",
      confidence: "truth",
      text: run.providerState.error
        ? `Error: ${truncate(run.providerState.error, 160)}`
        : "Run failed. See timeline for details.",
    });
    lines.push({
      id: "fail-2",
      kind: "hint",
      confidence: "truth",
      text: "Recovery: retry with narrower scope or add clarifying constraints.",
    });
  }

  if (phase === "cancelled") {
    lines.push({
      id: "cancel-1",
      kind: "status",
      confidence: "truth",
      text: "Run cancelled.",
    });
  }

  const uniq = dedupeById(lines);
  const rotateEveryMs =
    phase === "planning" ? 1300 : phase === "executing" ? 1200 : phase === "awaiting_approval" ? 1800 : 2000;

  return { headline, lines: uniq, rotateEveryMs };
}

function getActiveStepText(run: Run): string | undefined {
  const steps = run.plan?.steps;
  if (!steps) return undefined;
  for (const s of steps) if (s.state === "active") return s.text;
  return undefined;
}

function dedupeById(lines: KeepaliveLine[]): KeepaliveLine[] {
  const seen = new Set<string>();
  const out: KeepaliveLine[] = [];
  for (const l of lines) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l);
  }
  return out;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

function shortRepo(repoUrl: string): string {
  const m = repoUrl.match(/github\.com\/([^/]+\/[^/#?]+)/);
  if (m?.[1]) return m[1];
  const s = repoUrl.match(/sources\/github\/([^/]+\/[^/]+)/);
  if (s?.[1]) return s[1];
  return truncate(repoUrl.replace(/^https?:\/\//, ""), 28);
}

// -----------------------------
// Normalization (Jules → Run)
// -----------------------------

type NormalizeInput = {
  repoUrl: string;
  task: string;
  session: JulesSessionResponse;
  activities?: JulesActivityResponse[];
  receivedAt: number;
  nextPollAt: number;
};

type NormalizeOutput = { run: Run; newEvents: RunEvent[]; changed: boolean };

function normalizeJulesToRun(prev: Run | null, input: NormalizeInput): NormalizeOutput {
  const now = input.receivedAt;
  const session = input.session;
  const acts = input.activities ?? session.activities ?? [];
  const arts = session.artifacts ?? [];

  const run = initOrClone(prev, input.repoUrl, input.task, session.id, now);

  run.lastPollAt = now;
  run.nextPollAt = input.nextPollAt;
  run.pollCount += 1;

  const newEvents: RunEvent[] = [];
  let changed = false;

  const prevStatus = run.providerState.julesStatus;
  run.providerState.julesStatus = session.status;
  run.providerState.error = session.error;

  const nextPhase = statusToPhase(session.status);
  if (prevStatus !== session.status) {
    appendEvent(run, {
      eventId: `st:${prevStatus}→${session.status}@${now}`,
      at: now,
      source: "status",
      level: session.status === "FAILED" ? "error" : session.error ? "warn" : "info",
      title: statusTitle(session.status),
      detail: session.error,
      raw: { from: prevStatus, to: session.status, error: session.error },
    }, newEvents);

    run.phase = nextPhase;
    run.lastTruthAt = now;
    changed = true;
  } else {
    run.phase = nextPhase;
  }

  if (isTerminal(run.phase) && !run.endedAt) run.endedAt = now;

  if (session.plan) {
    const planChanged = upsertPlan(run, session.plan, now, newEvents);
    if (planChanged) {
      run.lastTruthAt = now;
      changed = true;
    }
  }

  // Activities (dedupe by activity.id)
  let sawNewAct = false;
  let lastAct: JulesActivityResponse | undefined;
  for (const a of acts) {
    lastAct = a;
    const added = appendEvent(run, normalizeActivityEvent(a, now), newEvents);
    if (added) sawNewAct = true;
  }
  if (sawNewAct) {
    run.lastTruthAt = now;
    changed = true;
  }

  // Artifacts
  let sawNewArt = false;
  for (const ar of arts) {
    const added = upsertArtifact(run, ar, now, newEvents);
    if (added) sawNewArt = true;
  }
  if (sawNewArt) {
    run.lastTruthAt = now;
    changed = true;
  }

  // Active step heuristic (truthy: only move active)
  if (run.plan) setActiveStep(run, lastAct);

  return { run, newEvents, changed };
}

function initOrClone(prev: Run | null, repoUrl: string, task: string, runId: string, now: number): Run {
  if (!prev) {
    return {
      runId,
      provider: "jules",
      repoUrl,
      task,
      phase: "queued",
      providerState: { julesStatus: "QUEUED" },
      startedAt: now,
      lastTruthAt: now,
      lastPollAt: now,
      nextPollAt: now,
      pollCount: 0,
      timeline: [],
      artifacts: [],
    };
  }

  return {
    ...prev,
    providerState: { ...prev.providerState },
    timeline: prev.timeline.slice(),
    artifacts: prev.artifacts.slice(),
    plan: prev.plan
      ? { summary: prev.plan.summary, steps: prev.plan.steps.map((s) => ({ ...s, evidence: s.evidence ? { ...s.evidence } : undefined })) }
      : undefined,
  };
}

function statusToPhase(s: JulesStatus): RunPhase {
  if (s === "QUEUED") return "queued";
  if (s === "PLANNING") return "planning";
  if (s === "AWAITING_PLAN_APPROVAL") return "awaiting_approval";
  if (s === "IN_PROGRESS") return "executing";
  if (s === "COMPLETED") return "completed";
  if (s === "FAILED") return "failed";
  return "cancelled";
}

function statusTitle(s: JulesStatus): string {
  if (s === "QUEUED") return "Queued";
  if (s === "PLANNING") return "Planning";
  if (s === "AWAITING_PLAN_APPROVAL") return "Plan ready (approval required)";
  if (s === "IN_PROGRESS") return "Executing";
  if (s === "COMPLETED") return "Completed";
  if (s === "FAILED") return "Failed";
  return "Cancelled";
}

function isTerminal(p: RunPhase): boolean {
  return p === "completed" || p === "failed" || p === "cancelled";
}

function appendEvent(run: Run, ev: RunEvent, newEvents: RunEvent[]): boolean {
  if (run.timeline.some((e) => e.eventId === ev.eventId)) return false;
  run.timeline.push(ev);
  newEvents.push(ev);
  return true;
}

function upsertPlan(run: Run, plan: JulesPlan, now: number, newEvents: RunEvent[]): boolean {
  const existing = run.plan;
  const sameSummary = !!existing && existing.summary === plan.summary;
  const sameSteps = !!existing && arrayEq(existing.steps.map((s) => s.text), plan.steps);
  if (sameSummary && sameSteps) return false;

  const nextSteps: RunPlanStep[] = plan.steps.map((text) => {
    const prevStep = existing?.steps.find((s) => s.text === text);
    return {
      text,
      state: prevStep?.state ?? "pending",
      evidence: prevStep?.evidence,
    };
  });

  run.plan = { summary: plan.summary, steps: nextSteps };

  appendEvent(run, {
    eventId: `plan:${run.runId}@${now}`,
    at: now,
    source: "system",
    level: "info",
    title: "Plan updated",
    detail: plan.summary,
    raw: plan,
  }, newEvents);

  return true;
}

function normalizeActivityEvent(a: JulesActivityResponse, now: number): RunEvent {
  const title = (typeof a.data.title === "string" && a.data.title) || (typeof a.data.message === "string" && a.data.message) || `${a.type} (${a.status})`;
  const detail = (typeof a.data.summary === "string" && a.data.summary) || (typeof a.data.detail === "string" && a.data.detail) || undefined;
  const lvl = a.status.toUpperCase() === "FAILED" ? "error" : a.status.toUpperCase() === "WARNING" ? "warn" : "info";
  return {
    eventId: `act:${a.id}`,
    at: now,
    source: "activity",
    level: lvl as any,
    title,
    detail,
    raw: a,
  };
}

function upsertArtifact(run: Run, ar: JulesArtifactResponse, now: number, newEvents: RunEvent[]): boolean {
  if (run.artifacts.some((a) => a.id === ar.id)) return false;

  const art: Artifact =
    ar.type === "git_patch"
      ? { id: ar.id, type: "git_patch", title: ar.title, patch: ar.patch, url: ar.url, raw: ar }
      : { id: ar.id, type: "pull_request", title: ar.title, url: ar.url, raw: ar };

  run.artifacts.push(art);

  appendEvent(run, {
    eventId: `art:${ar.id}`,
    at: now,
    source: "artifact",
    level: "info",
    title: `Artifact: ${ar.title}`,
    detail: ar.url,
    raw: ar,
  }, newEvents);

  return true;
}

function setActiveStep(run: Run, lastActivity?: JulesActivityResponse): void {
  const plan = run.plan;
  if (!plan) return;

  // Clear prior active
  for (const s of plan.steps) {
    if (s.state === "active") s.state = "pending";
  }

  if (run.phase !== "executing") return;

  // If activity has stepIndex, prefer it
  const idx = lastActivity && typeof lastActivity.data.stepIndex === "number" ? (lastActivity.data.stepIndex as number) : undefined;
  if (typeof idx === "number" && idx >= 0 && idx < plan.steps.length && plan.steps[idx].state === "pending") {
    plan.steps[idx].state = "active";
    return;
  }

  // Otherwise first pending
  const firstPending = plan.steps.find((s) => s.state === "pending");
  if (firstPending) firstPending.state = "active";
}

function arrayEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// -----------------------------
// Evidence matcher (confirm steps with proof)
// -----------------------------

function upgradeStepsWithEvidence(run: Run): Run {
  if (!run.plan) return run;

  const patchFiles = extractFilesFromPatches(run.artifacts);
  const artifactTexts = run.artifacts.map((a) => `${a.title} ${(a as any).url ?? ""}`);
  const activityTexts = run.timeline
    .filter((e) => e.source === "activity")
    .map((e) => `${e.title} ${e.detail ?? ""}`);

  run.plan.steps = run.plan.steps.map((step) => {
    if (step.state === "done_confirmed") return step;

    const a = scoreStepAgainstArtifacts(step.text, patchFiles, artifactTexts);
    const b = scoreStepAgainstText(step.text, activityTexts, 12);

    const best = a.score >= b.score ? a : b;

    if (best.score >= 10 && best.evidenceEventId) {
      return { ...step, state: "done_confirmed", evidence: { eventId: best.evidenceEventId } };
    }
    return step;
  });

  return run;
}

function extractFilesFromPatches(arts: Artifact[]): string[] {
  const files: string[] = [];
  for (const a of arts) {
    if (a.type !== "git_patch" || !a.patch) continue;
    for (const line of a.patch.split("\n")) {
      if (!line.startsWith("diff --git ")) continue;
      const m = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
      if (m?.[2]) files.push(m[2]);
    }
  }
  return Array.from(new Set(files));
}

function scoreStepAgainstArtifacts(stepText: string, patchFiles: string[], artifactTexts: string[]): { score: number; evidenceEventId?: string } {
  const tokens = tokenize(norm(stepText));

  let bestFileScore = 0;
  for (const f of patchFiles) {
    const score = scoreFileMatch(tokens, norm(f));
    if (score > bestFileScore) bestFileScore = score;
  }

  let bestTextScore = 0;
  for (const t of artifactTexts) {
    const score = overlapScore(tokens, tokenize(norm(t)));
    if (score > bestTextScore) bestTextScore = score;
  }

  const score = Math.max(bestFileScore, bestTextScore);
  return score >= 10 ? { score, evidenceEventId: "artifact-proof" } : { score };
}

function scoreStepAgainstText(stepText: string, texts: string[], confirmThreshold: number): { score: number; evidenceEventId?: string } {
  const tokens = tokenize(norm(stepText));
  let best = 0;
  for (const t of texts) {
    const score = overlapScore(tokens, tokenize(norm(t)));
    if (score > best) best = score;
  }
  return best >= confirmThreshold ? { score: best, evidenceEventId: "activity-proof" } : { score: best };
}

function scoreFileMatch(stepTokens: string[], file: string): number {
  const parts = file.split("/");
  const name = parts[parts.length - 1] ?? file;
  if (containsToken(stepTokens, norm(name))) return 10;
  for (let i = 0; i < parts.length - 1; i++) if (containsToken(stepTokens, norm(parts[i]))) return 6;
  return 0;
}

function overlapScore(a: string[], b: string[]): number {
  const setB = new Set(b);
  let hit = 0;
  for (const x of a) if (setB.has(x)) hit += 1;
  return hit * 3;
}

function tokenize(s: string): string[] {
  return s.split(/[^a-z0-9]+/).filter((x) => x.length >= 3);
}

function norm(s: string): string {
  return s.toLowerCase();
}

function containsToken(tokens: string[], token: string): boolean {
  return tokens.includes(token);
}

// -----------------------------
// Jules client interface + Mock implementation
// -----------------------------

type CreateSessionArgs = { repoUrl: string; task: string; apiKey: string; branch?: string };

interface IJulesClient {
  createSession(args: CreateSessionArgs): Promise<JulesSessionResponse>;
  getSession(sessionId: string, apiKey: string): Promise<JulesSessionResponse>;
  listActivities(sessionId: string, apiKey: string): Promise<JulesActivityResponse[]>;
  approvePlan(sessionId: string, apiKey: string): Promise<JulesSessionResponse>;
  rejectPlan(sessionId: string, feedback: string, apiKey: string): Promise<JulesSessionResponse>;
  cancelSession(sessionId: string, apiKey: string): Promise<JulesSessionResponse>;
}

// Simple in-memory mock for demo: status progresses on each getSession poll.
class MockJulesClient implements IJulesClient {
  private db = new Map<string, { status: JulesStatus; task: string; repo: string; plan?: JulesPlan; acts: JulesActivityResponse[]; arts: JulesArtifactResponse[]; tick: number }>();

  async createSession(args: CreateSessionArgs): Promise<JulesSessionResponse> {
    const id = `sessions/mock-${Math.random().toString(16).slice(2)}`;
    const plan: JulesPlan = {
      summary: `Implement: ${args.task}`,
      steps: [
        "Inspect relevant files and constraints",
        "Draft minimal implementation + tests",
        "Integrate and validate",
      ],
    };

    this.db.set(id, {
      status: "QUEUED",
      task: args.task,
      repo: args.repoUrl,
      plan,
      acts: [],
      arts: [],
      tick: 0,
    });

    return { id, status: "QUEUED" };
  }

  async getSession(sessionId: string): Promise<JulesSessionResponse> {
    const row = this.db.get(sessionId);
    if (!row) return { id: sessionId, status: "FAILED", error: "Unknown session" };

    // Progression: QUEUED -> PLANNING -> AWAITING_PLAN_APPROVAL -> IN_PROGRESS -> COMPLETED
    row.tick += 1;

    if (row.status === "QUEUED" && row.tick >= 1) row.status = "PLANNING";

    if (row.status === "PLANNING" && row.tick >= 2) {
      row.status = "AWAITING_PLAN_APPROVAL";
    }

    if (row.status === "IN_PROGRESS") {
      // emit activity every 2 ticks
      if (row.tick % 2 === 0) {
        row.acts.push({
          id: `a-${row.tick}`,
          type: "log",
          status: "OK",
          data: {
            title: "Working…",
            summary: `Progress checkpoint ${row.tick}`,
            stepIndex: Math.min(2, Math.floor(row.tick / 4)),
          },
        });
      }

      // complete at tick ~8
      if (row.tick >= 8) {
        row.status = "COMPLETED";
        row.arts.push({
          id: "pr-1",
          type: "pull_request",
          title: "Jules: implement requested changes",
          url: "https://example.com/pr/1",
        });
        row.arts.push({
          id: "patch-1",
          type: "git_patch",
          title: "Patch: minimal implementation",
          patch:
            "diff --git a/src/agentic/run.ts b/src/agentic/run.ts\n" +
            "diff --git a/src/agentic/ui.tsx b/src/agentic/ui.tsx\n",
        });
      }
    }

    return {
      id: sessionId,
      status: row.status,
      plan: row.status === "PLANNING" || row.status === "AWAITING_PLAN_APPROVAL" || row.status === "IN_PROGRESS" || row.status === "COMPLETED" ? row.plan : undefined,
      artifacts: row.status === "COMPLETED" ? row.arts : undefined,
    };
  }

  async listActivities(sessionId: string): Promise<JulesActivityResponse[]> {
    const row = this.db.get(sessionId);
    return row?.acts ?? [];
  }

  async approvePlan(sessionId: string): Promise<JulesSessionResponse> {
    const row = this.db.get(sessionId);
    if (!row) return { id: sessionId, status: "FAILED", error: "Unknown session" };
    if (row.status === "AWAITING_PLAN_APPROVAL") {
      row.status = "IN_PROGRESS";
      row.acts.push({
        id: `a-approve-${Date.now()}`,
        type: "system",
        status: "OK",
        data: { title: "Plan approved", summary: "Execution started" },
      });
    }
    return { id: sessionId, status: row.status, plan: row.plan };
  }

  async rejectPlan(sessionId: string, feedback: string): Promise<JulesSessionResponse> {
    const row = this.db.get(sessionId);
    if (!row) return { id: sessionId, status: "FAILED", error: "Unknown session" };
    if (row.status === "AWAITING_PLAN_APPROVAL") {
      row.status = "PLANNING";
      row.tick = 0;
      row.acts.push({
        id: `a-reject-${Date.now()}`,
        type: "system",
        status: "OK",
        data: { title: "Plan rejected", summary: `Feedback: ${feedback}` },
      });
    }
    return { id: sessionId, status: row.status, plan: row.plan };
  }

  async cancelSession(sessionId: string): Promise<JulesSessionResponse> {
    const row = this.db.get(sessionId);
    if (!row) return { id: sessionId, status: "FAILED", error: "Unknown session" };
    row.status = "CANCELLED";
    row.acts.push({
      id: `a-cancel-${Date.now()}`,
      type: "system",
      status: "OK",
      data: { title: "Cancelled", summary: "Run cancelled by user" },
    });
    return { id: sessionId, status: row.status };
  }
}

// -----------------------------
// Scheduler + controller hook
// -----------------------------

function useJulesRunController(client: IJulesClient) {
  const [run, setRun] = useState<Run | null>(null);
  const [uiState, setUiState] = useState<"idle" | "creating" | "polling" | "paused" | "terminal" | "error">("idle");

  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schedulePoll = (sessionId: string, whenMs: number) => {
    clearTimer();
    const delay = Math.max(0, whenMs - Date.now());
    timerRef.current = window.setTimeout(() => void poll(sessionId), delay);
  };

  const computeNextPollAt = (status: JulesStatus, now: number): number => {
    return status === "IN_PROGRESS" ? now + POLL.executionInterval : now + POLL.planningInterval;
  };

  const start = async (repoUrl: string, task: string, apiKey: string) => {
    clearTimer();
    startedAtRef.current = Date.now();
    setUiState("creating");

    const created = await client.createSession({ repoUrl, task, apiKey });

    const now = Date.now();
    const nextPollAt = now + POLL.initialDelay;

    const out0 = normalizeJulesToRun(null, {
      repoUrl,
      task,
      session: created,
      receivedAt: now,
      nextPollAt,
    });

    const r0 = upgradeStepsWithEvidence(out0.run);
    setRun(r0);
    setUiState("polling");

    schedulePoll(created.id, nextPollAt);
  };

  const poll = async (sessionId: string) => {
    const current = run;
    if (!current) return;

    // guardrails
    const now = Date.now();
    const duration = now - current.startedAt;
    if (current.pollCount >= POLL.maxPolls || duration >= POLL.maxDuration) {
      setUiState("error");
      setRun({
        ...current,
        phase: "failed",
        providerState: { ...current.providerState, error: "Polling exceeded safety caps" },
        endedAt: now,
      });
      clearTimer();
      return;
    }

    const session = await client.getSession(sessionId, "");
    const acts = await client.listActivities(sessionId, "");

    const nextPollAt = computeNextPollAt(session.status, now);

    const out = normalizeJulesToRun(current, {
      repoUrl: current.repoUrl,
      task: current.task,
      session,
      activities: acts,
      receivedAt: now,
      nextPollAt,
    });

    const r1 = upgradeStepsWithEvidence(out.run);
    setRun(r1);

    if (r1.phase === "awaiting_approval") {
      setUiState("paused");
      // You can keep polling slowly if desired; here we keep a slow poll.
      schedulePoll(sessionId, now + POLL.planningInterval);
      return;
    }

    if (isTerminal(r1.phase)) {
      setUiState("terminal");
      clearTimer();
      return;
    }

    setUiState("polling");
    schedulePoll(sessionId, nextPollAt);
  };

  const approve = async () => {
    if (!run) return;
    const now = Date.now();

    const session = await client.approvePlan(run.runId, "");
    const nextPollAt = now + POLL.executionInterval;

    const out = normalizeJulesToRun(run, {
      repoUrl: run.repoUrl,
      task: run.task,
      session,
      receivedAt: now,
      nextPollAt,
    });

    setRun(upgradeStepsWithEvidence(out.run));
    setUiState("polling");
    schedulePoll(run.runId, nextPollAt);
  };

  const reject = async (feedback: string) => {
    if (!run) return;
    const now = Date.now();

    const session = await client.rejectPlan(run.runId, feedback, "");
    const nextPollAt = now + POLL.planningInterval;

    const out = normalizeJulesToRun(run, {
      repoUrl: run.repoUrl,
      task: run.task,
      session,
      receivedAt: now,
      nextPollAt,
    });

    setRun(upgradeStepsWithEvidence(out.run));
    setUiState("polling");
    schedulePoll(run.runId, nextPollAt);
  };

  const cancel = async () => {
    if (!run) return;
    const now = Date.now();

    const session = await client.cancelSession(run.runId, "");
    const out = normalizeJulesToRun(run, {
      repoUrl: run.repoUrl,
      task: run.task,
      session,
      receivedAt: now,
      nextPollAt: now,
    });

    setRun(out.run);
    setUiState("terminal");
    clearTimer();
  };

  const reset = () => {
    clearTimer();
    setRun(null);
    setUiState("idle");
    startedAtRef.current = null;
  };

  return { run, uiState, start, approve, reject, cancel, reset };
}

// -----------------------------
// UI Components (minimal)
// -----------------------------

function Badge({ text, tone }: { text: string; tone?: "neutral" | "info" | "warn" | "error" | "good" }) {
  const cls =
    tone === "good"
      ? "bg-green-100 text-green-800"
      : tone === "warn"
        ? "bg-yellow-100 text-yellow-800"
        : tone === "error"
          ? "bg-red-100 text-red-800"
          : tone === "info"
            ? "bg-blue-100 text-blue-800"
            : "bg-zinc-100 text-zinc-700";

  return <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${cls}`}>{text}</span>;
}

function fmtDelta(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${r}s`;
}

function phaseTone(phase: RunPhase): "neutral" | "info" | "warn" | "error" | "good" {
  if (phase === "completed") return "good";
  if (phase === "failed") return "error";
  if (phase === "awaiting_approval") return "warn";
  if (phase === "executing" || phase === "planning") return "info";
  return "neutral";
}

function phaseLabel(phase: RunPhase): string {
  if (phase === "queued") return "QUEUED";
  if (phase === "planning") return "PLANNING";
  if (phase === "awaiting_approval") return "AWAITING APPROVAL";
  if (phase === "executing") return "IN PROGRESS";
  if (phase === "completed") return "COMPLETED";
  if (phase === "failed") return "FAILED";
  return "CANCELLED";
}

// -----------------------------
// Main Page
// -----------------------------

export default function AgenticRunPageDemo() {
  const client = useMemo(() => new MockJulesClient(), []);
  const { run, uiState, start, approve, reject, cancel, reset } = useJulesRunController(client);

  const [repoUrl, setRepoUrl] = useState("https://github.com/acme/agentic-ide");
  const [task, setTask] = useState("Add Jules session view with truth stream + keepalive");
  const [feedback, setFeedback] = useState("Please split step 2 into implementation and tests.");

  // Perception loop ticker
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  const now = Date.now();
  const keepalive = useMemo(() => generateTruthfulKeepalive(run, now), [run, tick]); // tick drives rotation

  const rotateIndex = run
    ? Math.floor(now / keepalive.rotateEveryMs) % Math.max(1, keepalive.lines.length)
    : 0;

  const currentLine = keepalive.lines[rotateIndex];

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-zinc-200 pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Agentic Run</div>
                <div className="text-sm text-zinc-600">Provider: Jules (demo mock)</div>
              </div>

              <div className="flex items-center gap-2">
                {run ? <Badge text={phaseLabel(run.phase)} tone={phaseTone(run.phase)} /> : <Badge text="IDLE" />}
                <Badge text={uiState.toUpperCase()} />
              </div>
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-700">
              <div className="font-mono text-xs bg-zinc-50 border border-zinc-200 rounded px-2 py-1">
                {run ? run.runId : "—"}
              </div>
              <div>Repo: <span className="font-medium">{shortRepo(repoUrl)}</span></div>
              {run && (
                <>
                  <div>Elapsed: <span className="font-medium">{fmtDelta(now - run.startedAt)}</span></div>
                  <div>Last confirmed: <span className="font-medium">{fmtDelta(now - run.lastTruthAt)} ago</span></div>
                  <div>Next poll: <span className="font-medium">{Math.max(0, Math.ceil((run.nextPollAt - now) / 1000))}s</span></div>
                  <div>Polls: <span className="font-medium">{run.pollCount}</span></div>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
                onClick={() => start(repoUrl, task, "demo-key")}
                disabled={uiState !== "idle" && uiState !== "terminal" && uiState !== "error"}
              >
                Start run
              </button>

              <button
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
                onClick={reset}
              >
                Reset
              </button>

              {run && run.phase === "awaiting_approval" && (
                <>
                  <button
                    className="rounded-lg bg-zinc-900 text-white px-3 py-2 text-sm hover:bg-zinc-800"
                    onClick={approve}
                  >
                    Approve plan
                  </button>
                  <button
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
                    onClick={() => reject(feedback)}
                  >
                    Reject w/ feedback
                  </button>
                </>
              )}

              {run && !isTerminal(run.phase) && (
                <button
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
                  onClick={cancel}
                >
                  Cancel
                </button>
              )}
            </div>

            {/* Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-sm">
                <div className="text-zinc-600 mb-1">Repo URL</div>
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="text-zinc-600 mb-1">Task</div>
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                />
              </label>
              <label className="text-sm md:col-span-3">
                <div className="text-zinc-600 mb-1">Reject feedback (for demo)</div>
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
              </label>
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PlanPanel run={run} />
          <TimelinePanel run={run} />
        </div>

        {/* Keepalive */}
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Status (UI)</div>
            <div className="text-xs text-zinc-500">Keepalive (non-truth stream)</div>
          </div>
          <div className="mt-3 text-sm text-zinc-800">
            <div className="font-medium">{keepalive.headline}</div>
            <div className="mt-1">• {currentLine?.text}</div>
            <div className="mt-2 text-xs text-zinc-600">Rotating {keepalive.lines.length} lines every ~{Math.round(keepalive.rotateEveryMs / 100) / 10}s</div>
          </div>
        </div>

        {/* Artifacts */}
        {run && run.artifacts.length > 0 && (
          <ArtifactsPanel run={run} />
        )}
      </div>
    </div>
  );
}

function PlanPanel({ run }: { run: Run | null }) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Plan / To-Do</div>
        {run?.phase === "awaiting_approval" && <Badge text="APPROVAL REQUIRED" tone="warn" />}
      </div>

      {!run?.plan ? (
        <div className="mt-3 text-sm text-zinc-600">No plan available yet.</div>
      ) : (
        <>
          <div className="mt-3 text-sm text-zinc-700">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Summary</div>
            <div className="mt-1 font-medium">{run.plan.summary}</div>
          </div>

          <div className="mt-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Steps</div>
            <ul className="mt-2 space-y-2">
              {run.plan.steps.map((s, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-0.5 text-xs text-zinc-500 w-6">{idx + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <StepDot state={s.state} />
                      <div className="text-sm">{s.text}</div>
                    </div>
                    {s.evidence?.eventId && (
                      <div className="ml-6 mt-1 text-xs text-zinc-500">Evidence: {s.evidence.eventId}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 text-xs text-zinc-500">
              Confirmed steps only upgrade with proof (activities/artifacts). UI keepalive never marks completion.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StepDot({ state }: { state: RunPlanStep["state"] }) {
  const cls =
    state === "done_confirmed"
      ? "bg-green-500"
      : state === "done_estimated"
        ? "bg-green-300"
        : state === "active"
          ? "bg-blue-500 animate-pulse"
          : "bg-zinc-300";

  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} />;
}

function TimelinePanel({ run }: { run: Run | null }) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-4">
      <div className="text-sm font-semibold">Timeline (truth stream)</div>
      {!run ? (
        <div className="mt-3 text-sm text-zinc-600">Start a run to see status transitions, activities, and artifacts.</div>
      ) : run.timeline.length === 0 ? (
        <div className="mt-3 text-sm text-zinc-600">No events yet.</div>
      ) : (
        <div className="mt-3 space-y-2">
          {run.timeline
            .slice()
            .sort((a, b) => a.at - b.at)
            .map((e) => (
              <EventRow key={e.eventId} e={e} />
            ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ e }: { e: RunEvent }) {
  const tone = e.level === "error" ? "error" : e.level === "warn" ? "warn" : e.source === "artifact" ? "good" : "neutral";
  return (
    <details className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge text={e.source.toUpperCase()} tone={tone as any} />
              <span className="text-sm font-medium">{e.title}</span>
            </div>
            {e.detail && <div className="mt-1 text-sm text-zinc-600">{e.detail}</div>}
          </div>
          <div className="text-xs text-zinc-500">{new Date(e.at).toLocaleTimeString()}</div>
        </div>
      </summary>
      {e.raw && (
        <pre className="mt-2 overflow-auto rounded-lg bg-zinc-50 p-2 text-xs text-zinc-700">
          {JSON.stringify(e.raw, null, 2)}
        </pre>
      )}
    </details>
  );
}

function ArtifactsPanel({ run }: { run: Run }) {
  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 p-4">
      <div className="text-sm font-semibold">Artifacts</div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        {run.artifacts.map((a) => (
          <div key={a.id} className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{a.title}</div>
              <Badge text={a.type.toUpperCase()} tone={a.type === "pull_request" ? "good" : "info"} />
            </div>
            {(a as any).url && <div className="mt-1 text-xs text-zinc-600 break-all">{(a as any).url}</div>}
            {a.type === "git_patch" && a.patch && (
              <pre className="mt-2 overflow-auto rounded-lg bg-zinc-50 p-2 text-xs text-zinc-700">{a.patch}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


Perfect — OpenCode makes this easier, not harder.

OpenCode’s web/desktop app is SolidJS (not React): packages/app/src/pages/home.tsx imports solid-js + @solidjs/router.
And the TUI is also SolidJS via @opentui/solid.
So I created a SolidJS version that fits the OpenCode UI ecosystem (@opencode-ai/ui/*) and can be mounted in the IDE with minimal blast radius.

✅ I added a new canvas file

“OpenCode Agentic Run Panel (Jules) – SolidJS Skeleton” (in the canvas)

What it includes:

Two-loop UX (truth polling + perception keepalive)

Plan / Timeline / Keepalive / Artifacts

Approval gate (Approve / Reject feedback)

Uses OpenCode’s useServer() (so it can talk to the currently selected server)

Includes both:

MockJulesClient (demo instantly)

createHttpJulesClient() expecting your /jules/* proxy routes

How to mount it in OpenCode (lowest-friction path)

The cleanest “OpenCode way” is: add a Jules button to SessionHeader that opens a Dialog.

SessionHeader already uses IconButton, Dialog, and mounts UI into the titlebar.
So the minimal integration is:

Put the panel somewhere like:

packages/app/src/pages/session/jules-run-panel.tsx (or components folder if you prefer)

In packages/app/src/components/session/session-header.tsx, add:

a createSignal(false) for dialog open

an IconButton to open

a Dialog rendering <JulesRunPanel />

The skeleton file includes a helper DemoMountInDialog() showing exactly that pattern.

Wiring to the real backend

The panel already has a real client stub:

POST /jules/sessions

GET /jules/sessions/:id

GET /jules/sessions/:id/activities

POST /jules/sessions/:id/approve

POST /jules/sessions/:id/reject

POST /jules/sessions/:id/cancel

It uses useServer().current.http.url as the base URL, which is exactly how OpenCode tracks the active server connection.
