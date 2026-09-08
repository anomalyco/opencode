import type { Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { fixture, pageMessages } from "./session-timeline-stress.fixture"

export async function installTimelineSettings(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          newLayoutDesigns: true,
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
        },
      }),
    )
  })
}

export function mockStressTimeline(
  page: Page,
  input?: {
    onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
    vcsDiff?: unknown[]
  },
) {
  return mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    onMessages: input?.onMessages,
    vcsDiff: input?.vcsDiff,
  })
}

export async function installStressSessionTabs(page: Page, input?: { draftID?: string; sessionIDs?: string[] }) {
  const server = stressServer()
  await page.addInitScript(
    ({ directory, sessionIDs, dirBase64, server, draftID }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          ...sessionIDs.map((sessionId) => ({
            type: "session",
            server,
            dirBase64,
            sessionId,
          })),
          ...(draftID ? [{ type: "draft", draftID, server, directory }] : []),
        ]),
      )
    },
    {
      directory: fixture.directory,
      sessionIDs: input?.sessionIDs ?? [fixture.sourceID, fixture.targetID],
      dirBase64: base64Encode(fixture.directory),
      server,
      draftID: input?.draftID,
    },
  )
}

export function stressSessionHref(sessionID: string) {
  return `/server/${base64Encode(stressServer())}/session/${sessionID}`
}

export function stressDraftHref(draftID: string) {
  return `/new-session?draftId=${encodeURIComponent(draftID)}`
}

function stressServer() {
  return `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
}

export function createReviewDiffs() {
  return Array.from({ length: Number(process.env.REVIEW_PANE_DIFF_COUNT ?? 72) }, (_, index) => {
    const lines = index % 3 === 0 ? 300 : index % 3 === 1 ? 120 : 38
    const file = `src/review/generated-${String(index).padStart(3, "0")}.ts`
    const before = reviewSource(index, lines)
    const after = before
      .replace(`value_${index}_4`, `updated_${index}_4`)
      .replace(
        `value_${index}_${Math.max(8, Math.floor(lines / 2))}`,
        `updated_${index}_${Math.max(8, Math.floor(lines / 2))}`,
      )
      .replace(`value_${index}_${lines - 4}`, `updated_${index}_${lines - 4}`)
    return {
      file,
      patch: reviewPatch(file, before, after),
      additions: 3,
      deletions: 3,
      status: "modified" as const,
    }
  })
}

function reviewSource(seed: number, lines: number) {
  return Array.from(
    { length: lines },
    (_, index) => `export const value_${seed}_${index} = "${reviewWords(seed + index, index % 5 === 0 ? 180 : 42)}"`,
  ).join("\n")
}

function reviewPatch(file: string, before: string, after: string) {
  const beforeLines = before.split("\n")
  const afterLines = after.split("\n")
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.flatMap((line, index) => {
      const next = afterLines[index]!
      if (line === next) return [` ${line}`]
      return [`-${line}`, `+${next}`]
    }),
  ].join("\n")
}

function reviewWords(seed: number, length: number) {
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"]
  return Array.from({ length: Math.ceil(length / 7) }, (_, index) => words[(seed + index * 3) % words.length]).join(" ")
}
