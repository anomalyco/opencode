import { apiClient } from "@/services/api/remote/client"

export interface ConnectionResult {
  success: boolean
  error?: string
}

export interface ConnectionMutations {
  setActiveProject: (id: string) => Promise<any>
  updateConnectionStatus: (params: {
    projectId: string
    status: "connected" | "disconnected" | "connecting"
  }) => Promise<any>
}

/**
 * Shared connection service to eliminate duplication across components
 * Note: This service requires mutation functions to be passed in to maintain proper React Query invalidation
 */
export class ConnectionService {
  /**
   * Test connection to a project and update its status
   */
  static async connectToProject(
    projectId: string,
    serverUrl: string,
    mutations: Pick<ConnectionMutations, "updateConnectionStatus">,
  ): Promise<ConnectionResult> {
    try {
      // Set status to connecting
      await mutations.updateConnectionStatus({ projectId, status: "connecting" })

      // Update API client base URL and test connection
      await apiClient.updateBaseUrlFromString(serverUrl)
      await apiClient.ping()

      // Set status to connected on success
      await mutations.updateConnectionStatus({ projectId, status: "connected" })

      return { success: true }
    } catch (error) {
      // Set status to disconnected on failure
      await mutations.updateConnectionStatus({ projectId, status: "disconnected" })

      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      }
    }
  }

  /**
   * Disconnect a project
   */
  static async disconnectProject(
    projectId: string,
    mutations: Pick<ConnectionMutations, "updateConnectionStatus">,
  ): Promise<void> {
    await mutations.updateConnectionStatus({ projectId, status: "disconnected" })
  }

  /**
   * Switch to a project and connect to it
   */
  static async switchAndConnect(
    projectId: string,
    serverUrl: string,
    mutations: ConnectionMutations,
  ): Promise<ConnectionResult> {
    try {
      // Switch to the project first (this triggers all the important side effects)
      await mutations.setActiveProject(projectId)

      // Then connect to it
      return await this.connectToProject(projectId, serverUrl, mutations)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to switch and connect",
      }
    }
  }
}
