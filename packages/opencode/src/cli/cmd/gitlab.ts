import { cmd } from "./cmd"
import { VCSManager } from "../../vcs/manager"
import * as prompts from "@clack/prompts"
import { Flag } from "../../flag/flag"
import { Instance } from "../../project/instance"
import { UI } from "../ui"

export const GitlabCommand = cmd({
  command: "gitlab",
  describe: "manage GitLab integration",
  builder: (yargs) =>
    yargs
      .command(GitlabStatusCommand)
      .command(GitlabTestCommand)
      .command(GitlabConfigCommand)
      .demandCommand(),
  async handler() {},
})

export const GitlabStatusCommand = cmd({
  command: "status",
  describe: "check GitLab connection status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        prompts.intro("GitLab Status")

        const manager = new VCSManager()
        await manager.initialize()

        const baseUrl = Flag.OPENSACIA_GITLAB_BASE_URL
        const token = Flag.OPENSACIA_GITLAB_TOKEN
        const projectId = Flag.OPENSACIA_GITLAB_PROJECT_ID

        UI.println(`Provider: ${manager.providerName || "Not initialized"}`)
        UI.println(`Base URL: ${baseUrl || "Not configured"}`)
        UI.println(`Project ID: ${projectId || "Not configured"}`)
        UI.println(`Token: ${token ? `${token.slice(0, 10)}...` : "Not configured"}`)

        prompts.outro("GitLab status complete")
      },
    })
  },
})

export const GitlabTestCommand = cmd({
  command: "test",
  describe: "test GitLab API connection",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        prompts.intro("Testing GitLab Connection")

        const manager = new VCSManager()
        await manager.initialize()

        try {
          const projectId = Flag.OPENSACIA_GITLAB_PROJECT_ID || "61"
          const mrs = await manager.listMRs(projectId, { state: "opened" })

          UI.println(`Success: Found ${mrs.length} open merge requests`)
        } catch (error) {
          UI.error(String(error))
        }

        prompts.outro("GitLab test complete")
      },
    })
  },
})

export const GitlabConfigCommand = cmd({
  command: "config",
  describe: "show GitLab configuration",
  async handler() {
    const baseUrl = Flag.OPENSACIA_GITLAB_BASE_URL
    const projectId = Flag.OPENSACIA_GITLAB_PROJECT_ID
    const token = Flag.OPENSACIA_GITLAB_TOKEN

    console.log({
      provider: "gitlab",
      baseUrl,
      projectId,
      token: token ? `${token.slice(0, 10)}...` : undefined,
    })
  },
})
