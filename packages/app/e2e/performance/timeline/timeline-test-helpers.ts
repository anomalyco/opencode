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
  input?: { onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void },
) {
  return mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    onMessages: input?.onMessages,
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
        "opencode.global.dat:tabs",
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
