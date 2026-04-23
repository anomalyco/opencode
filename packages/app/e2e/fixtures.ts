import { test as base, expect, type Page } from "@playwright/test"
import type { E2EWindow } from "../src/testing/terminal"
import { cleanupSession, seedProjects, sessionIDFromUrl } from "./actions"
import { promptSelector } from "./selectors"
import { createSdk, projectPath, sessionPath, getCurrentProject } from "./utils"
import {
  applyE2eWorkosSession,
  clearE2eWorkosSession,
  e2eAppOrigin,
  mintE2eSealedSessionFromWorkos,
  withAuth,
} from "./workos-auth"

export const settingsKey = "settings.v3"

type TestFixtures = {
  sdk: ReturnType<typeof createSdk>
  project: { id: string; directory: string }
  gotoSession: (sessionID?: string) => Promise<void>
  withProject: <T>(
    callback: (project: {
      id: string
      directory: string
      gotoSession: (sessionID?: string) => Promise<void>
      trackSession: (sessionID: string) => void
    }) => Promise<T>,
  ) => Promise<T>
}

type WorkerFixtures = {
  project: { id: string; directory: string }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Project is determined once per worker from the seeded environment
  project: [
    async ({}, use) => {
      const project = await getCurrentProject()
      await use(project)
    },
    { scope: "worker" },
  ],
  
  sdk: async ({ project }, use) => {
    await use(createSdk())
  },
  
  gotoSession: async ({ page, project }, use) => {
    await seedStorage(page, { projectId: project.id })

    const gotoSession = async (sessionID?: string) => {
      await page.goto(sessionPath(project.id, sessionID))
      await expect(page.locator(promptSelector)).toBeVisible()
    }
    await use(gotoSession)
  },
  
  withProject: async ({ page, sdk }, use) => {
    await use(async (callback) => {
      // Create a fresh database project for this test
      const result = await sdk.project.create({ name: "E2E Test Project" })
      if (!result.data?.id) throw new Error("Failed to create project")
      
      const project = {
        id: result.data.id,
        directory: `/projects/${result.data.id}`,
      }
      
      await seedStorage(page, { projectId: project.id })
      
      const sessions = new Set<string>()
      
      const gotoSession = async (sessionID?: string) => {
        await page.goto(sessionPath(project.id, sessionID))
        await expect(page.locator(promptSelector)).toBeVisible()
        const current = sessionIDFromUrl(page.url())
        if (current) sessions.add(current)
      }

      const trackSession = (sessionID: string) => {
        sessions.add(sessionID)
      }

      try {
        return await callback({ 
          id: project.id, 
          directory: project.directory, 
          gotoSession, 
          trackSession 
        })
      } finally {
        // Cleanup all tracked sessions
        await Promise.allSettled(
          Array.from(sessions).map((sessionID) => cleanupSession({ sdk, sessionID })),
        )
      }
    })
  },
})

async function seedStorage(page: Page, input: { projectId: string }) {
  await seedProjects(page, { projectId: input.projectId })
  await page.addInitScript(() => {
    const win = window as E2EWindow
    win.__opencode_e2e = {
      ...win.__opencode_e2e,
      terminal: {
        enabled: true,
        terminals: {},
      },
    }
    localStorage.setItem(
      "opencode.global.dat:model",
      JSON.stringify({
        recent: [{ providerID: "openai", modelID: "llama3.2:1b" }],
        user: [],
        variant: {},
      }),
    )
  })
}

export { expect }
export { applyE2eWorkosSession, clearE2eWorkosSession, e2eAppOrigin, mintE2eSealedSessionFromWorkos, withAuth }
