// Scrolling the background activity menu with 20 long-running subagents open, both quiet and while the parent
// session streams tool progress and child sessions update in the background.
import { bench, web } from "@hona/strobe"
import { base64Encode } from "@opencode/util/encode"
import type { OpenCodeEvent, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { mockOpenCodeServer } from "../e2e/utils/mock-server"
import { cached } from "./fixtures/mock"
import { eventSource } from "./fixtures/events"
import { composer, timeline } from "./fixtures/timeline"

const directory = "C:/OpenCode/SubagentPillPerf"

const projectID = "proj_subagent_pill_perf"

const parentID = "ses_subagent_pill_parent"

const assistantMessageID = "msg_assistant_subagents"

const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

const chip = '[data-slot="session-activity-chip"]'

const panel = '[data-slot="session-activity-panel"]'

const viewport = '[data-slot="session-activity-panel"] [data-slot="menu-scroll-viewport"]'

const SUBAGENT_COUNT = 20

const EXTRA_SESSIONS = 250

const descriptions = [
  "WS-3: timeline, code wrap, measurement stability and resize observers",
  "WS-8: focus rings, rescue, tooltips and keyboard navigation",
  "WS-1 (fresh): the browser, bridge, tab strip and pane layout",
  "BROWSER-TOOLS (fresh): the snapshot, eval and click actions",
  "ENGINE-DELIVERY: source.rs streaming frames and backpressure",
  "SCREENS-B: Shift source queue ordering and inbox reconciliation",
  "UPDATER: in-app updates 1:1 parity with desktop beta channel",
  "GESTURES: web-default interactions and trackpad scroll inertia",
  "AUDITOR: verify today's merges against regression benchmarks",
  "DEV-KEEPER-b: keep dev green across windows and linux shards",
]

// Ages from 40s up to 63h 46m so rows span seconds, minutes and hours simultaneously.
const agesMs = [
  63 * 3600_000 + 46 * 60_000,
  61 * 3600_000 + 17 * 60_000,
  60 * 3600_000 + 45 * 60_000,
  59 * 3600_000 + 8 * 60_000,
  45 * 3600_000 + 31 * 60_000,
  40_000,
  44 * 3600_000 + 24 * 60_000,
  22 * 3600_000 + 7 * 60_000,
  19 * 3600_000 + 47 * 60_000,
  22 * 60_000 + 9_000,
  15 * 3600_000 + 12 * 60_000,
  11 * 3600_000 + 3 * 60_000,
  9 * 3600_000 + 55 * 60_000,
  7 * 3600_000 + 18 * 60_000,
  5 * 3600_000 + 42 * 60_000,
  3 * 3600_000 + 11 * 60_000,
  2 * 3600_000 + 5 * 60_000,
  48 * 60_000 + 33_000,
  14 * 60_000 + 52_000,
  3 * 60_000 + 17_000,
]

let seq = 0

export default bench({
  targets: {
    web: web({
      expect: { title: "OpenCode" },
      viewport: { width: 1366, height: 768 },
      prepare: async (ctx) => {
        const now = Date.now()
        const server = new URL(ctx.url).origin
        const page = cached(ctx)

        const children = Array.from({ length: SUBAGENT_COUNT }, (_, i) => {
          const started = now - agesMs[i % agesMs.length]!

          return {
            id: `ses_subagent_child_${String(i).padStart(2, "0")}`,
            slug: `subagent-${i}`,
            projectID,
            parentID,
            directory,
            title: `${descriptions[i % descriptions.length]} (@general subagent)`,
            agent: "general",
            version: "dev",
            time: { created: started, updated: now - i * 1000 },
          }
        })

        const extra = Array.from({ length: EXTRA_SESSIONS }, (_, i) => ({
          id: `ses_extra_${String(i).padStart(4, "0")}`,
          slug: `extra-${i}`,
          projectID,
          directory,
          title: `Historical session ${i}`,
          version: "dev",
          time: { created: now - (i + 100) * 60_000, updated: now - (i + 100) * 60_000 },
        }))

        const parentSession = {
          id: parentID,
          slug: "subagent-pill-perf",
          projectID,
          directory,
          title: "Orchestrate 20 parallel subagents",
          version: "dev",
          time: { created: now - 70 * 3600_000, updated: now },
        }

        const tools: SessionMessageAssistantTool[] = children.map((child, i) => ({
          type: "tool",
          id: `prt_subagent_${i}`,
          name: "subagent",
          time: { created: child.time.created, ran: child.time.created, completed: child.time.created + 100 },
          state: {
            status: "completed",
            input: {
              agent: "general",
              description: descriptions[i % descriptions.length]!,
              prompt: descriptions[i % descriptions.length]!,
            },
            content: [{ type: "text", text: "Subagent started in background." }],
            metadata: { sessionID: child.id, status: "running" },
          },
        }))

        const history: SessionMessageInfo[] = Array.from({ length: 40 }, (_, i): SessionMessageInfo[] => [
          {
            id: `msg_hist_${String(i).padStart(3, "0")}_u`,
            type: "user",
            time: { created: now - (50 - i) * 60_000 },
            text: `Check status of batch ${i} and launch follow-up work.`,
          },
          {
            id: `msg_hist_${String(i).padStart(3, "0")}_a`,
            type: "assistant",
            time: { created: now - (50 - i) * 60_000 + 500, completed: now - (50 - i) * 60_000 + 2000 },
            model: { id: model.modelID, providerID: model.providerID, variant: model.variant },
            agent: "build",
            cost: 0.02,
            tokens: { input: 200, output: 400, reasoning: 0, cache: { read: 0, write: 0 } },
            finish: "stop",
            content: [{ type: "text", text: `Batch ${i} is underway.` }],
          },
        ]).flat()

        const messages: SessionMessageInfo[] = [
          ...history,
          {
            id: "msg_user_launch",
            type: "user",
            time: { created: now - 65 * 3600_000 },
            text: "Launch all 20 workstreams in parallel.",
          },
          {
            id: assistantMessageID,
            type: "assistant",
            time: { created: now - 64 * 3600_000 },
            model: { id: model.modelID, providerID: model.providerID, variant: model.variant },
            agent: "build",
            cost: 0.5,
            tokens: { input: 1000, output: 2000, reasoning: 500, cache: { read: 0, write: 0 } },
            content: [
              { type: "reasoning", text: "Coordinating 20 parallel subagents...", time: { created: now - 30_000 } },
              ...tools,
            ],
          },
        ]

        const sessionStatus = Object.fromEntries([
          [parentID, { type: "busy" }],
          ...children.map((c) => [c.id, { type: "busy" }]),
        ])

        const source = await eventSource(page, server)

        await mockOpenCodeServer(page, {
          server,
          directory,
          project: {
            id: projectID,
            worktree: directory,
            vcs: "git",
            name: "subagent-pill-perf",
            time: { created: now - 70 * 3600_000, updated: now },
            sandboxes: [],
          },
          provider: {
            all: [
              {
                id: "opencode",
                name: "OpenCode",
                models: {
                  "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } },
                },
              },
            ],
            connected: ["opencode"],
            default: { providerID: "opencode", modelID: "claude-opus-4-6" },
          },
          sessions: [parentSession, ...children, ...extra],
          sessionStatus,
          pageMessages: () => ({ items: messages }),
        })

        return {
          path: `/server/${base64Encode(server)}/session/${parentID}`,
          source,
          childIDs: children.map((c) => c.id),
        }
      },
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ page }) {
    await page.waitFor(timeline, { timeout: 60_000 })
    await page.waitFor(composer)
    await page.waitFor(chip, { timeout: 30_000 })
    await page.click(chip, { until: panel })
    await page.waitFor(viewport)
    await page.idle()
  },

  teardown: ({ prepared }) => prepared.source.stop(),

  cases: {
    "scroll pill static": {
      primary: "main.work",
      metrics: [
        "main.script",
        "main.style",
        "main.layout",
        "main.paint",
        "style.count",
        "frames.dropped.pct",
        "frames.interval.p95",
        "frames.renderer.p95",
        "frames.viz.p95",
      ],
      async run({ page, phase }) {
        await phase("down1", () => page.scroll(viewport, { by: 360, speed: 300 }))
        await phase("up1", () => page.scroll(viewport, { by: -360, speed: 300 }))
        await phase("down2", () => page.scroll(viewport, { by: 360, speed: 300 }))
        await phase("up2", () => page.scroll(viewport, { by: -360, speed: 300 }))
      },
      reset: ({ page }) => page.idle(),
    },

    "scroll pill with live events": {
      primary: "main.work",
      metrics: [
        "main.script",
        "main.style",
        "main.layout",
        "main.paint",
        "style.count",
        "frames.dropped.pct",
        "frames.interval.p95",
        "frames.renderer.p95",
        "frames.viz.p95",
      ],
      async run({ page, phase, prepared }) {
        // Production-shaped traffic while scrolling: the parent session runs tool calls (which refreshes history()
        // in createSessionBackground) and background subagents tick executions (which re-sorts session.list()).
        let tick = 0

        const timer = setInterval(() => {
          tick++
          const toolID = `prt_live_read_${tick}`
          const childID = prepared.childIDs[tick % prepared.childIDs.length]!
          const created = Date.now()

          const events: OpenCodeEvent[] = [
            {
              id: `evt_live_${++seq}`,
              created,
              location: { directory },
              durable: { aggregateID: parentID, seq, version: 1 },
              type: "session.tool.input.started",
              data: {
                sessionID: parentID,
                assistantMessageID,
                id: toolID,
                name: "read",
              },
            } satisfies Extract<OpenCodeEvent, { type: "session.tool.input.started" }>,
            {
              id: `evt_live_${++seq}`,
              created: created + 1,
              location: { directory },
              durable: { aggregateID: parentID, seq, version: 1 },
              type: "session.tool.called",
              data: {
                sessionID: parentID,
                assistantMessageID,
                id: toolID,
                input: { path: `src/check-${tick}.ts` },
                executed: true,
              },
            } satisfies Extract<OpenCodeEvent, { type: "session.tool.called" }>,
            {
              id: `evt_live_${++seq}`,
              created: created + 2,
              location: { directory },
              durable: { aggregateID: parentID, seq, version: 2 },
              type: "session.tool.success",
              data: {
                sessionID: parentID,
                assistantMessageID,
                id: toolID,
                content: [{ type: "text", text: "ok" }],
                metadata: {},
                executed: true,
              },
            } satisfies Extract<OpenCodeEvent, { type: "session.tool.success" }>,
            {
              id: `evt_live_${++seq}`,
              created: created + 3,
              location: { directory },
              durable: { aggregateID: childID, seq, version: 1 },
              type: "session.execution.started",
              data: { sessionID: childID },
            } satisfies Extract<OpenCodeEvent, { type: "session.execution.started" }>,
          ]

          prepared.source.send(events)
        }, 250)

        try {
          await phase("down1", () => page.scroll(viewport, { by: 360, speed: 300 }))
          await phase("up1", () => page.scroll(viewport, { by: -360, speed: 300 }))
          await phase("down2", () => page.scroll(viewport, { by: 360, speed: 300 }))
          await phase("up2", () => page.scroll(viewport, { by: -360, speed: 300 }))
        } finally {
          clearInterval(timer)
        }
      },
      reset: ({ page }) => page.idle(),
    },
  },
})
