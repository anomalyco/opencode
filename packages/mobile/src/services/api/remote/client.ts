import axios, { type AxiosInstance } from "axios"

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
    // Request interceptor to ensure we're using the active project's server URL
    this.client.interceptors.request.use(async (config) => {
      // If baseURL is already set and not empty, use it
      if (config.baseURL) {
        return config
      }

      try {
        // Get active project's server URL
        const serverUrl = await this.getActiveProjectServerUrl()
        if (serverUrl) {
          config.baseURL = serverUrl
        }
      } catch (error) {
        // If we can't get server URL, let the request proceed and fail naturally
      }
      return config
    })

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        // Just return the error - connection status will be handled by the calling code
        return Promise.reject(error)
      },
    )
  }

  private async getActiveProjectServerUrl(): Promise<string | null> {
    try {
      const db = (await import("@/db")).default
      const { projects } = await import("@/db/schema")
      const { eq } = await import("drizzle-orm")

      const activeProject = await db.select().from(projects).where(eq(projects.isActive, true)).limit(1)
      return activeProject[0]?.serverUrl || null
    } catch (error) {
      return null
    }
  }

  async updateBaseUrl(hostname: string, port: number) {
    // For backward compatibility, construct URL from hostname and port
    // Use the same smart protocol detection as parseServerUrl
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") ||
      hostname.startsWith("172.19.") ||
      hostname.startsWith("172.20.") ||
      hostname.startsWith("172.21.") ||
      hostname.startsWith("172.22.") ||
      hostname.startsWith("172.23.") ||
      hostname.startsWith("172.24.") ||
      hostname.startsWith("172.25.") ||
      hostname.startsWith("172.26.") ||
      hostname.startsWith("172.27.") ||
      hostname.startsWith("172.28.") ||
      hostname.startsWith("172.29.") ||
      hostname.startsWith("172.30.") ||
      hostname.startsWith("172.31.") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname) // Any IP address defaults to http

    const protocol = isLocal ? "http" : "https"
    const defaultPort = protocol === "https" ? 443 : 80
    const portSuffix = port === defaultPort ? "" : `:${port}`
    const serverUrl = `${protocol}://${hostname}${portSuffix}`
    // Set the baseURL immediately for subsequent requests
    this.client.defaults.baseURL = serverUrl
  }

  async updateBaseUrlFromString(connectionString: string) {
    let serverUrl = connectionString

    // Ensure the URL has a protocol
    if (!connectionString.startsWith("http://") && !connectionString.startsWith("https://")) {
      serverUrl = `http://${connectionString}`
    }

    // Set the baseURL immediately for subsequent requests
    this.client.defaults.baseURL = serverUrl
  }

  get axios() {
    return this.client
  }

  // Health check
  async ping() {
    const response = await this.client.get("/app", {
      timeout: 5000, // 5 second timeout for ping
    })
    return response.data
  }
}

export const apiClient = ApiClient.getInstance()
