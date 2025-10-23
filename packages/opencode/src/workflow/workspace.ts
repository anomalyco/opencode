/**
 * Workspace Management System
 *
 * Extends the Project system with workspace-specific features including
 * multi-repository support, agent configuration, and workflow settings.
 */

import z from "zod/v4"
import { Project } from "../project/project.js"
import { Storage } from "../storage/storage.js"
import { ulid } from "ulid"
import { $ } from "bun"
import path from "path"
import type { Workspace as WorkspaceType, Repository, WorkspaceConfig } from "./types.js"

const RepositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  branch: z.string(),
  remote: z.string().optional(),
})

const WorkspaceConfigSchema = z.object({
  defaultBranch: z.string(),
  testCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  deployCommand: z.string().optional(),
  environmentVariables: z.record(z.string(), z.string()),
})

const WorkspaceInfoSchema = Project.Info.extend({
  repositories: z.array(RepositorySchema),
  agents: z.array(z.string()),
  configuration: WorkspaceConfigSchema,
})

export namespace Workspace {
  export type Info = WorkspaceType

  /**
   * Create a new workspace
   */
  export async function create(params: {
    directory: string
    repositories?: Array<{
      name: string
      path: string
    }>
    config?: Partial<WorkspaceConfig>
  }): Promise<Info> {
    // First, create or get the underlying project
    const project = await Project.fromDirectory(params.directory)

    // Discover repositories in the workspace
    const repositories = await discoverRepositories(
      project.worktree,
      params.repositories
    )

    // Build workspace configuration
    const configuration: WorkspaceConfig = {
      defaultBranch: "main",
      environmentVariables: {},
      ...params.config,
    }

    const workspace: Info = {
      ...project,
      repositories,
      agents: ["planning", "coding", "testing", "deployment"],
      configuration,
    }

    // Save workspace info
    await Storage.write<Info>(["workspace", workspace.id], workspace)

    return workspace
  }

  /**
   * Get workspace by ID
   */
  export async function get(workspaceID: string): Promise<Info | null> {
    try {
      return await Storage.read<Info>(["workspace", workspaceID])
    } catch {
      return null
    }
  }

  /**
   * Get workspace from directory
   */
  export async function fromDirectory(directory: string): Promise<Info | null> {
    const project = await Project.fromDirectory(directory)
    return await get(project.id)
  }

  /**
   * Update workspace configuration
   */
  export async function update(
    workspaceID: string,
    updates: Partial<Pick<Info, "repositories" | "agents" | "configuration">>
  ): Promise<Info> {
    await Storage.update<Info>(["workspace", workspaceID], (draft) => {
      if (updates.repositories) {
        draft.repositories = updates.repositories
      }
      if (updates.agents) {
        draft.agents = updates.agents
      }
      if (updates.configuration) {
        draft.configuration = {
          ...draft.configuration,
          ...updates.configuration,
        }
      }
    })

    const updated = await Storage.read<Info>(["workspace", workspaceID])
    return updated
  }

  /**
   * List all workspaces
   */
  export async function list(): Promise<Info[]> {
    const keys = await Storage.list(["workspace"])
    return await Promise.all(
      keys.map((key) => Storage.read<Info>(key))
    )
  }

  /**
   * Delete a workspace
   */
  export async function remove(workspaceID: string): Promise<void> {
    await Storage.remove(["workspace", workspaceID])
  }

  /**
   * Add a repository to the workspace
   */
  export async function addRepository(
    workspaceID: string,
    repository: {
      name: string
      path: string
    }
  ): Promise<Repository> {
    const workspace = await get(workspaceID)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceID} not found`)
    }

    const repoInfo = await getRepositoryInfo(repository.path)

    const newRepo: Repository = {
      id: ulid(),
      name: repository.name,
      path: repository.path,
      branch: repoInfo.branch,
      remote: repoInfo.remote,
    }

    await update(workspaceID, {
      repositories: [...workspace.repositories, newRepo],
    })

    return newRepo
  }

  /**
   * Remove a repository from the workspace
   */
  export async function removeRepository(
    workspaceID: string,
    repositoryID: string
  ): Promise<void> {
    const workspace = await get(workspaceID)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceID} not found`)
    }

    await update(workspaceID, {
      repositories: workspace.repositories.filter((r) => r.id !== repositoryID),
    })
  }

  /**
   * Discover git repositories in the workspace
   */
  async function discoverRepositories(
    worktree: string,
    provided?: Array<{ name: string; path: string }>
  ): Promise<Repository[]> {
    // If repositories were explicitly provided, use those
    if (provided && provided.length > 0) {
      return Promise.all(
        provided.map(async (repo) => {
          const repoInfo = await getRepositoryInfo(repo.path)
          return {
            id: ulid(),
            name: repo.name,
            path: repo.path,
            branch: repoInfo.branch,
            remote: repoInfo.remote,
          }
        })
      )
    }

    // Otherwise, discover the main repository
    const mainRepoInfo = await getRepositoryInfo(worktree)

    return [
      {
        id: ulid(),
        name: path.basename(worktree),
        path: worktree,
        branch: mainRepoInfo.branch,
        remote: mainRepoInfo.remote,
      },
    ]
  }

  /**
   * Get repository information from a git directory
   */
  async function getRepositoryInfo(repoPath: string): Promise<{
    branch: string
    remote?: string
  }> {
    try {
      // Get current branch
      const branch = await $`git rev-parse --abbrev-ref HEAD`
        .cwd(repoPath)
        .quiet()
        .text()
        .then((x) => x.trim())
        .catch(() => "main")

      // Get remote URL
      const remote = await $`git config --get remote.origin.url`
        .cwd(repoPath)
        .quiet()
        .text()
        .then((x) => x.trim())
        .catch(() => undefined)

      return { branch, remote }
    } catch {
      return { branch: "main" }
    }
  }

  /**
   * Configure workspace agents
   */
  export async function setAgents(
    workspaceID: string,
    agents: string[]
  ): Promise<void> {
    await update(workspaceID, { agents })
  }

  /**
   * Update workspace configuration
   */
  export async function setConfiguration(
    workspaceID: string,
    config: Partial<WorkspaceConfig>
  ): Promise<void> {
    const workspace = await get(workspaceID)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceID} not found`)
    }

    await update(workspaceID, {
      configuration: {
        ...workspace.configuration,
        ...config,
      },
    })
  }

  /**
   * Get workspace statistics
   */
  export async function getStats(workspaceID: string): Promise<{
    repositoryCount: number
    agentCount: number
    hasTestCommand: boolean
    hasBuildCommand: boolean
    hasDeployCommand: boolean
  }> {
    const workspace = await get(workspaceID)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceID} not found`)
    }

    return {
      repositoryCount: workspace.repositories.length,
      agentCount: workspace.agents.length,
      hasTestCommand: !!workspace.configuration.testCommand,
      hasBuildCommand: !!workspace.configuration.buildCommand,
      hasDeployCommand: !!workspace.configuration.deployCommand,
    }
  }
}
