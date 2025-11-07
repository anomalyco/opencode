import { $ } from "bun"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import readline from "node:readline"
import { Octokit } from "@octokit/rest"
import { graphql } from "@octokit/graphql"
import * as core from "@actions/core"
import * as github from "@actions/github"
import type { Context as GitHubContext } from "@actions/github/lib/context"
import type { IssueCommentEvent } from "@octokit/webhooks-types"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { spawn } from "node:child_process"

// =========================================================================
// Type Definitions
// =========================================================================

type GitHubAuthor = {
  login: string
  name?: string
}

type GitHubComment = {
  id: string
  databaseId: string
  body: string
  author: GitHubAuthor
  createdAt: string
}

type GitHubReviewComment = GitHubComment & {
  path: string
  line: number | null
}

type GitHubCommit = {
  oid: string
  message: string
  author: {
    name: string
    email: string
  }
}

type GitHubFile = {
  path: string
  additions: number
  deletions: number
  changeType: string
}

type GitHubReview = {
  id: string
  databaseId: string
  author: GitHubAuthor
  body: string
  state: string
  submittedAt: string
  comments: {
    nodes: GitHubReviewComment[]
  }
}

type GitHubPullRequest = {
  title: string
  body: string
  author: GitHubAuthor
  baseRefName: string
  headRefName: string
  headRefOid: string
  createdAt: string
  additions: number
  deletions: number
  state: string
  baseRepository: {
    nameWithOwner: string
  }
  headRepository: {
    nameWithOwner: string
  }
  commits: {
    totalCount: number
    nodes: Array<{
      commit: GitHubCommit
    }>
  }
  files: {
    nodes: GitHubFile[]
  }
  comments: {
    nodes: GitHubComment[]
  }
  reviews: {
    nodes: GitHubReview[]
  }
}

type GitHubIssue = {
  title: string
  body: string
  author: GitHubAuthor
  createdAt: string
  state: string
  comments: {
    nodes: GitHubComment[]
  }
}

type PullRequestQueryResponse = {
  repository: {
    pullRequest: GitHubPullRequest
  }
}

type IssueQueryResponse = {
  repository: {
    issue: GitHubIssue
  }
}

// =========================================================================
// CLI Uninstall Command Logic
// =========================================================================

/**
 * Determines common global opencode data paths based on the operating system.
 * @returns An array of potential opencode-related file/directory paths.
 */
function getOpencodeGlobalPaths(): string[] {
  const homeDir = os.homedir()
  const paths: string[] = []

  switch (os.platform()) {
    case "darwin": // macOS
      paths.push(path.join(homeDir, "Library", "Application Support", "opencode"))
      paths.push(path.join(homeDir, "Library", "Caches", "opencode"))
      break
    case "win32": // Windows
      const appDataRoaming = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming")
      const appDataLocal = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local")
      paths.push(path.join(appDataRoaming, "opencode"))
      paths.push(path.join(appDataLocal, "opencode"))
      break
    default: // Linux and other POSIX-like systems (XDG Base Directory Specification)
      const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config")
      const xdgCacheHome = process.env.XDG_CACHE_HOME || path.join(homeDir, ".cache")
      const xdgDataHome = process.env.XDG_DATA_HOME || path.join(homeDir, ".local", "share")

      paths.push(path.join(xdgConfigHome, "opencode"))
      paths.push(path.join(xdgCacheHome, "opencode"))
      paths.push(path.join(xdgDataHome, "opencode"))
      // Fallback for older systems or non-XDG compliant applications
      paths.push(path.join(homeDir, ".opencode"))
      break
  }
  return paths
}

/**
 * Prompts the user for confirmation via the console.
 * @param message The message to display to the user.
 * @returns True if the user confirms by typing "yes", false otherwise.
 */
async function promptForConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === "yes")
    })
  })
}

/**
 * Executes the opencode uninstall command logic.
 */
async function runUninstallCommand(): Promise<void> {
  console.log("---------------------------------------")
  console.log(" opencode Uninstall Tool")
  console.log("---------------------------------------")
  console.log("Searching for global opencode data and configurations...\n")

  const pathsToDelete = getOpencodeGlobalPaths()
  const existingPaths = pathsToDelete.filter((p) => fs.existsSync(p))

  if (existingPaths.length === 0) {
    console.log("No opencode-related files or directories found on this system.")
    process.exit(0)
  }

  console.log("The following will be permanently deleted:")
  existingPaths.forEach((p) => console.log(`- ${p}`))
  console.log(
    "\nWARNING: This action is irreversible and will remove all global opencode data and configurations.",
  )

  const confirmed = await promptForConfirmation("Do you wish to proceed?")

  if (!confirmed) {
    console.log("\nUninstallation cancelled by user.")
    process.exit(0)
  }

  console.log("\nProceeding with deletion...")
  let deletedCount = 0
  let errorCount = 0

  for (const p of existingPaths) {
    try {
      const stats = fs.statSync(p)
      if (stats.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true })
        console.log(`- Deleted directory: ${p}`)
      } else {
        fs.unlinkSync(p)
        console.log(`- Deleted file: ${p}`)
      }
      deletedCount++
    } catch (error: any) {
      console.error(`- Failed to delete ${p}: ${error.message}`)
      errorCount++
    }
  }

  const skippedCount = pathsToDelete.length - existingPaths.length

  console.log("\n---------------------------------------")
  console.log("Uninstallation Summary:")
  console.log(`- ${deletedCount} item(s) deleted.`)
  console.log(`- ${skippedCount} item(s) skipped (not found).`)
  console.log(`- ${errorCount} item(s) failed to delete.`)
  console.log("---------------------------------------")

  if (errorCount > 0) {
    console.error("Uninstallation completed with errors.")
    process.exit(1)
  } else {
    console.log("Uninstallation completed successfully.")
    process.exit(0)
  }
}

// =========================================================================
// GitHub Action Logic
// =========================================================================

// These helper functions are used by the GitHub Action logic
// (Assuming they are defined elsewhere in the original file)
declare function assertContextEvent(event: string): void;
declare function assertPayloadKeyword(): void;
declare function assertOpencodeConnected(): Promise<void>;
declare function getAccessToken(): Promise<string>;
declare function getUserPrompt(): Promise<{ userPrompt: string; promptFiles: any[] }>;
declare function configureGit(token: string): Promise<void>;
declare function assertPermissions(): Promise<void>;
declare function createComment(): Promise<{ data: { id: number } }>;
declare function fetchRepo(): Promise<{ data: { private: boolean; default_branch: string } }>;
declare function subscribeSessionEvents(): Promise<void>;
declare function useEnvShare(): boolean;
declare function useShareUrl(): string;
declare function isPullRequest(): boolean;
declare function fetchPR(): Promise<GitHubPullRequest>;
declare function checkoutLocalBranch(prData: GitHubPullRequest): Promise<void>;
declare function buildPromptDataForPR(prData: GitHubPullRequest): string;
declare function chat(prompt: string, files: any[]): Promise<string>;
declare function branchIsDirty(): Promise<boolean>;
declare function summarize(response: string): Promise<string>;
declare function pushToLocalBranch(summary: string): Promise<void>;
declare function footer(options?: { image?: boolean }): string;
declare function updateComment(content: string): Promise<void>;
declare function checkoutForkBranch(prData: GitHubPullRequest): Promise<void>;
declare function pushToForkBranch(summary: string, prData: GitHubPullRequest): Promise<void>;
declare function checkoutNewBranch(): Promise<string>;
declare function fetchIssue(): Promise<GitHubIssue>;
declare function buildPromptDataForIssue(issueData: GitHubIssue): string;
declare function pushToNewBranch(summary: string, branch: string): Promise<void>;
declare function useIssueId(): number;
declare function createPR(base: string, head: string, title: string, body: string): Promise<number>;
declare function restoreGitConfig(): Promise<void>;
declare function revokeAppToken(): Promise<void>;

/**
 * Executes the primary GitHub Action logic.
 */
async function runGitHubAction() {
  const { client, server } = createOpencode()
  let accessToken: string
  let octoRest: Octokit
  let octoGraph: typeof graphql
  let commentId: number
  let gitConfig: string
  let session: { id: string; title: string; version: string }
  let shareId: string | undefined
  let exitCode = 0
  type PromptFiles = Awaited<ReturnType<typeof getUserPrompt>>["promptFiles"]

  try {
    assertContextEvent("issue_comment")
    assertPayloadKeyword()
    await assertOpencodeConnected()

    accessToken = await getAccessToken()
    octoRest = new Octokit({ auth: accessToken })
    octoGraph = graphql.defaults({
      headers: { authorization: `token ${accessToken}` },
    })

    const { userPrompt, promptFiles } = await getUserPrompt()
    await configureGit(accessToken)
    await assertPermissions()

    const comment = await createComment()
    commentId = comment.data.id

    const repoData = await fetchRepo()
    session = await client.session.create<true>().then((r) => r.data)
    await subscribeSessionEvents()
    shareId = await (async () => {
      if (useEnvShare() === false) return
      if (!useEnvShare() && repoData.data.private) return
      await client.session.share<true>({ path: session })
      return session.id.slice(-8)
    })()
    console.log("opencode session", session.id)
    if (shareId) {
      console.log("Share link:", `${useShareUrl()}/s/${shareId}`)
    }

    if (isPullRequest()) {
      const prData = await fetchPR()
      if (prData.headRepository.nameWithOwner === prData.baseRepository.nameWithOwner) {
        await checkoutLocalBranch(prData)
        const dataPrompt = buildPromptDataForPR(prData)
        const response = await chat(`${userPrompt}\n\n${dataPrompt}`, promptFiles)
        if (await branchIsDirty()) {
          const summary = await summarize(response)
          await pushToLocalBranch(summary)
        }
        const hasShared = prData.comments.nodes.some((c) =>
          c.body.includes(`${useShareUrl()}/s/${shareId}`),
        )
        await updateComment(`${response}${footer({ image: !hasShared })}`)
      } else {
        await checkoutForkBranch(prData)
        const dataPrompt = buildPromptDataForPR(prData)
        const response = await chat(`${userPrompt}\n\n${dataPrompt}`, promptFiles)
        if (await branchIsDirty()) {
          const summary = await summarize(response)
          await pushToForkBranch(summary, prData)
        }
        const hasShared = prData.comments.nodes.some((c) =>
          c.body.includes(`${useShareUrl()}/s/${shareId}`),
        )
        await updateComment(`${response}${footer({ image: !hasShared })}`)
      }
    } else {
      const branch = await checkoutNewBranch()
      const issueData = await fetchIssue()
      const dataPrompt = buildPromptDataForIssue(issueData)
      const response = await chat(`${userPrompt}\n\n${dataPrompt}`, promptFiles)
      if (await branchIsDirty()) {
        const summary = await summarize(response)
        await pushToNewBranch(summary, branch)
        const pr = await createPR(
          repoData.data.default_branch,
          branch,
          summary,
          `${response}\n\nCloses #${useIssueId()}${footer({ image: true })}`,
        )
        await updateComment(`Created PR #${pr}${footer({ image: true })}`)
      } else {
        await updateComment(`${response}${footer({ image: true })}`)
      }
    }
  } catch (e: any) {
    exitCode = 1
    console.error(e)
    let msg = e
    if (e instanceof $.ShellError) {
      msg = e.stderr.toString()
    } else if (e instanceof Error) {
      msg = e.message
    }
    await updateComment(`${msg}${footer()}`)
    core.setFailed(msg)
  } finally {
    server.close()
    await restoreGitConfig()
    await revokeAppToken()
  }
  process.exit(exitCode)
}

function createOpencode() {
  const host = "127.0.0.1"
  const port = 4096
  const url = `http://${host}:${port}`
  const proc = spawn(`opencode`, [`serve`, `--hostname=${host}`, `--port=${port}`])
  return createOpencodeClient(url, { proc })
}

// =========================================================================
// Main Application Entry Point (CLI Command Dispatcher)
// =========================================================================

const command = process.argv[2]

if (command === "uninstall") {
  runUninstallCommand().catch((e) => {
    console.error("An unexpected error occurred during uninstallation:", e)
    process.exit(1)
  })
} else {
  // Default behavior is to run the GitHub Action logic.
  runGitHubAction()
}