import axios, { type AxiosInstance } from "axios"
import { localConfigService } from "../local/config"

export class ApiClient {
  private static instance: ApiClient
  private client: AxiosInstance

  private constructor() {
    this.client = axios.create({
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    })

    this.setupInterceptors()
  }

  static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient()
    }
    return ApiClient.instance
  }

  private setupInterceptors() {
    // Request interceptor to add base URL
    this.client.interceptors.request.use(async (config) => {
      // If baseURL is already set (from updateBaseUrl), use it
      if (config.baseURL) {
        return config
      }

      try {
        const serverUrl = await Promise.race([
          localConfigService.getServerUrl(),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2000)),
        ])
        if (serverUrl) {
          config.baseURL = serverUrl
        }
      } catch (error) {
        // If we can't get server URL quickly, skip it
        console.warn("Failed to get server URL:", error)
      }
      return config
    })

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.code === "ECONNREFUSED" || error.code === "NETWORK_ERROR") {
          await localConfigService.updateConnectionStatus("disconnected")
        }
        return Promise.reject(error)
      },
    )
  }

  async updateBaseUrl(hostname: string, port: number) {
    const serverUrl = `http://${hostname}:${port}`
    // Set the baseURL immediately for subsequent requests
    this.client.defaults.baseURL = serverUrl
    // Also ensure the connection settings are saved
    await localConfigService.setServerConnection(hostname, port)
  }

  get axios() {
    return this.client
  }

  // Health check
  async ping() {
    try {
      const response = await this.client.get("/app", {
        timeout: 5000, // 5 second timeout for ping
      })
      await localConfigService.updateConnectionStatus("connected")
      return response.data
    } catch (error) {
      await localConfigService.updateConnectionStatus("disconnected")
      throw error
    }
  }
}

export const apiClient = ApiClient.getInstance()
