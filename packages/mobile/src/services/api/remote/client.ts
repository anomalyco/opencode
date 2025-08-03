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
      const serverUrl = await localConfigService.getServerUrl()
      if (serverUrl) {
        config.baseURL = serverUrl
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
    this.client.defaults.baseURL = serverUrl
    await localConfigService.setServerConnection(hostname, port)
  }

  get axios() {
    return this.client
  }

  // Health check
  async ping() {
    try {
      const response = await this.client.get("/app")
      await localConfigService.updateConnectionStatus("connected")
      return response.data
    } catch (error) {
      await localConfigService.updateConnectionStatus("disconnected")
      throw error
    }
  }
}

export const apiClient = ApiClient.getInstance()
