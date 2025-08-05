import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { eq } from "drizzle-orm"
import db from "@/db"
import { projects, userSettings } from "@/db/schema"
import { queryKeys } from "../keys"
import type { Project, NewProject, UserSettings } from "@/db/types"

// Raw database operations (internal use)
class ProjectsRepository {
  async getAllProjects() {
    return await db.select().from(projects).orderBy(projects.createdAt)
  }

  async getActiveProject() {
    const result = await db.select().from(projects).where(eq(projects.isActive, true)).limit(1)
    return result[0] || null
  }

  async getProjectById(id: string) {
    const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
    return result[0] || null
  }

  async createProject(projectData: Omit<NewProject, "id" | "createdAt" | "updatedAt">) {
    // Generate unique ID
    const id = `project-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`

    return await db
      .insert(projects)
      .values({
        ...projectData,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
  }

  async updateProject(id: string, updates: Partial<Project>) {
    return await db
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning()
  }

  async deleteProject(id: string) {
    return await db.delete(projects).where(eq(projects.id, id))
  }

  async setActiveProject(id: string) {
    // First, deactivate all projects
    await db.update(projects).set({ isActive: false })

    // Then activate the selected project
    return await db
      .update(projects)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning()
  }

  async updateConnectionStatus(projectId: string, status: "connected" | "disconnected" | "connecting") {
    return await db
      .update(projects)
      .set({
        connectionStatus: status,
        lastSyncTimestamp: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
      .returning()
  }

  async updateAppInfo(
    projectId: string,
    appInfo: {
      appHostname?: string
      appGit?: boolean
      appPathConfig?: string
      appPathData?: string
      appPathRoot?: string
      appPathCwd?: string
      appPathState?: string
      appTimeInitialized?: Date
    },
  ) {
    return await db
      .update(projects)
      .set({
        ...appInfo,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
      .returning()
  }

  async getServerUrl(projectId?: string) {
    const project = projectId ? await this.getProjectById(projectId) : await this.getActiveProject()

    if (!project) return null
    return project.serverUrl
  }

  async getCurrentMode() {
    const result = await db.select().from(userSettings).limit(1)
    const settings = result[0]
    return settings?.currentMode || "build"
  }

  async setCurrentMode(mode: string) {
    const existing = await db.select().from(userSettings).limit(1)
    if (existing.length > 0) {
      return await db
        .update(userSettings)
        .set({ currentMode: mode, updatedAt: new Date() })
        .where(eq(userSettings.id, 1))
        .returning()
    } else {
      return await db
        .insert(userSettings)
        .values({
          id: 1,
          currentMode: mode,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as UserSettings)
        .returning()
    }
  }
}

const projectsRepo = new ProjectsRepository()

// TanStack Query hooks for projects
export function useProjectsQuery() {
  return useQuery({
    queryKey: queryKeys.local.projects.lists(),
    queryFn: () => projectsRepo.getAllProjects(),
  })
}

export function useActiveProjectQuery() {
  return useQuery({
    queryKey: queryKeys.local.projects.active(),
    queryFn: () => projectsRepo.getActiveProject(),
  })
}

export function useProjectQuery(id: string) {
  return useQuery({
    queryKey: queryKeys.local.projects.byId(id),
    queryFn: () => projectsRepo.getProjectById(id),
    enabled: !!id,
  })
}

export function useActiveProjectServerUrlQuery() {
  return useQuery({
    queryKey: queryKeys.local.projects.activeServerUrl(),
    queryFn: () => projectsRepo.getServerUrl(),
  })
}

export function useCurrentModeQuery() {
  return useQuery({
    queryKey: queryKeys.local.config.currentMode(),
    queryFn: () => projectsRepo.getCurrentMode(),
  })
}

// Mutations for projects
export function useCreateProjectMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectData: Omit<NewProject, "id" | "createdAt" | "updatedAt">) =>
      projectsRepo.createProject(projectData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.all })
    },
  })
}

export function useUpdateProjectMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Project> }) => projectsRepo.updateProject(id, updates),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.byId(id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.active() })
    },
  })
}

export function useDeleteProjectMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => projectsRepo.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.active() })
    },
  })
}

export function useSetActiveProjectMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => projectsRepo.setActiveProject(id),
    onSuccess: () => {
      // Invalidate all project-related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.active() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.activeServerUrl() })

      // Invalidate all session queries (local and remote) since we switched projects
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.all })

      // Invalidate all message queries
      queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.messages.all })

      // Invalidate remote config queries
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.config.all })

      // Restart SSE service to connect to new server
      import("@/services/sse-service")
        .then(({ sseService }) => {
          sseService.disconnect()
          // Small delay to ensure clean disconnect
          setTimeout(() => {
            sseService.connect()
          }, 500)
        })
        .catch((error) => {
          console.warn("Failed to restart SSE service:", error)
        })
    },
  })
}

export function useUpdateProjectConnectionStatusMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ projectId, status }: { projectId: string; status: "connected" | "disconnected" | "connecting" }) =>
      projectsRepo.updateConnectionStatus(projectId, status),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.byId(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.active() })
      // Also invalidate remote app info query to refresh connection status display
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.config.app() })
    },
  })
}

export function useUpdateProjectAppInfoMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      projectId,
      appInfo,
    }: {
      projectId: string
      appInfo: Parameters<typeof projectsRepo.updateAppInfo>[1]
    }) => projectsRepo.updateAppInfo(projectId, appInfo),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.byId(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.projects.active() })
    },
  })
}

export function useSetCurrentModeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (mode: string) => projectsRepo.setCurrentMode(mode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.currentMode() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.userSettings() })
    },
  })
}

export function useSwitchModeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (currentMode?: string) => {
      // Toggle between build and plan modes locally
      const newMode = currentMode === "build" ? "plan" : "build"

      // Update local mode state
      await projectsRepo.setCurrentMode(newMode)

      return { newMode }
    },
    onSuccess: () => {
      // Invalidate local queries to update UI
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.currentMode() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.userSettings() })
    },
  })
}

// Export the repository for direct access when needed (e.g., in streaming service)
export const localProjectsService = projectsRepo
