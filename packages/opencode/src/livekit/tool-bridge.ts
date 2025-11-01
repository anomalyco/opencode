/**
 * Tool Bridge
 *
 * Bidirectional tool sharing between OpenCode and external agents in LiveKit rooms
 * Uses JSON-RPC 2.0 protocol over LiveKit data channels
 */

import type { RoomManager } from "./room-manager"
import type {
  Tool,
  ToolRegistry,
  ToolRequest,
  ToolResponse,
  ToolPermission,
  ToolRequestMessage,
  ToolResponseMessage,
  ToolDiscoveryMessage,
  DataChannelMessage,
  Participant,
} from "./types"

/**
 * Manages bidirectional tool access between agents
 */
export class ToolBridge {
  private roomManager: RoomManager
  private registry: ToolRegistry
  private permissions: Map<string, ToolPermission> = new Map()
  private pendingRequests: Map<
    string,
    {
      resolve: (value: any) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  > = new Map()

  // Configuration
  private readonly REQUEST_TIMEOUT = 30000 // 30 seconds
  private readonly MAX_REQUESTS_PER_MINUTE = 60

  // Rate limiting
  private requestCounts: Map<string, { count: number; resetAt: number }> = new Map()

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager
    this.registry = {
      local: [],
      external: new Map(),
    }

    this.setupEventHandlers()
  }

  // ============================================================================
  // Local Tool Management
  // ============================================================================

  /**
   * Register OpenCode tools to expose to external agents
   */
  async exposeTools(tools: Tool[]): Promise<void> {
    this.registry.local = tools

    // Announce tools to room
    await this.announceTools()
  }

  /**
   * Register a single tool
   */
  async exposeTool(tool: Tool): Promise<void> {
    const existing = this.registry.local.findIndex((t) => t.name === tool.name)
    if (existing >= 0) {
      this.registry.local[existing] = tool
    } else {
      this.registry.local.push(tool)
    }

    await this.announceTools()
  }

  /**
   * Unregister a tool
   */
  async removeTool(toolName: string): Promise<void> {
    this.registry.local = this.registry.local.filter((t) => t.name !== toolName)
    await this.announceTools()
  }

  /**
   * Get all locally registered tools
   */
  getLocalTools(): Tool[] {
    return [...this.registry.local]
  }

  // ============================================================================
  // External Tool Discovery
  // ============================================================================

  /**
   * Discover tools from external agents
   */
  async discoverExternalTools(): Promise<Tool[]> {
    const allTools: Tool[] = []

    for (const [agentId, tools] of this.registry.external) {
      allTools.push(...tools)
    }

    return allTools
  }

  /**
   * Get tools from a specific agent
   */
  getToolsFromAgent(agentId: string): Tool[] {
    return this.registry.external.get(agentId) || []
  }

  /**
   * Get all external agents with their tools
   */
  getExternalAgents(): Map<string, Tool[]> {
    return new Map(this.registry.external)
  }

  // ============================================================================
  // Tool Execution
  // ============================================================================

  /**
   * Execute an external agent's tool
   */
  async executeExternalTool(
    agentId: string,
    toolName: string,
    params: Record<string, any>,
  ): Promise<any> {
    // Check if agent exists
    const agentTools = this.registry.external.get(agentId)
    if (!agentTools) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    // Check if tool exists
    const tool = agentTools.find((t) => t.name === toolName)
    if (!tool) {
      throw new Error(`Tool not found: ${toolName} on agent ${agentId}`)
    }

    // Check rate limit
    if (!this.checkRateLimit(agentId)) {
      throw new Error(`Rate limit exceeded for agent: ${agentId}`)
    }

    // Send tool request
    const request: ToolRequest = {
      jsonrpc: "2.0",
      method: "tool.execute",
      params: {
        tool: toolName,
        arguments: params,
        sourceAgent: "opencode",
      },
      id: this.generateRequestId(),
    }

    return await this.sendToolRequest(agentId, request)
  }

  /**
   * Handle incoming tool request from external agent
   */
  private async handleToolRequest(
    request: ToolRequest,
    fromParticipant: Participant,
  ): Promise<ToolResponse> {
    try {
      // Check if we have this tool
      const tool = this.registry.local.find((t) => t.name === request.params.tool)
      if (!tool) {
        return {
          jsonrpc: "2.0",
          error: {
            code: -32601,
            message: `Tool not found: ${request.params.tool}`,
          },
          id: request.id,
        }
      }

      // Check permission
      const permissionKey = `${fromParticipant.id}:${request.params.tool}`
      if (!this.checkPermission(permissionKey)) {
        // Auto-grant for now (TODO: implement permission UI)
        this.grantPermission(fromParticipant.id, request.params.tool)
      }

      // Execute tool
      const result = await tool.execute(request.params.arguments)

      return {
        jsonrpc: "2.0",
        result,
        id: request.id,
      }
    } catch (error) {
      return {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
        id: request.id,
      }
    }
  }

  // ============================================================================
  // Permission Management
  // ============================================================================

  /**
   * Grant permission for an agent to use a tool
   */
  grantPermission(agentId: string, toolName: string, expiresIn?: number): void {
    const permission: ToolPermission = {
      agentId,
      toolName,
      granted: true,
      grantedAt: Date.now(),
      expiresAt: expiresIn ? Date.now() + expiresIn : undefined,
    }

    const key = `${agentId}:${toolName}`
    this.permissions.set(key, permission)
  }

  /**
   * Revoke permission
   */
  revokePermission(agentId: string, toolName: string): void {
    const key = `${agentId}:${toolName}`
    this.permissions.delete(key)
  }

  /**
   * Check if permission is granted
   */
  private checkPermission(permissionKey: string): boolean {
    const permission = this.permissions.get(permissionKey)
    if (!permission) return false
    if (!permission.granted) return false
    if (permission.expiresAt && Date.now() > permission.expiresAt) {
      this.permissions.delete(permissionKey)
      return false
    }
    return true
  }

  /**
   * Get all permissions
   */
  getPermissions(): ToolPermission[] {
    return Array.from(this.permissions.values())
  }

  // ============================================================================
  // Data Channel Communication
  // ============================================================================

  /**
   * Announce tools to room
   */
  private async announceTools(): Promise<void> {
    const message: ToolDiscoveryMessage = {
      type: "tool.discovery",
      payload: {
        agentId: "opencode",
        tools: this.registry.local.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    }

    await this.roomManager.sendData(message)
  }

  /**
   * Send tool request to specific agent
   */
  private async sendToolRequest(agentId: string, request: ToolRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id)
        reject(new Error(`Tool request timeout: ${request.params.tool}`))
      }, this.REQUEST_TIMEOUT)

      // Store pending request
      this.pendingRequests.set(request.id, { resolve, reject, timeout })

      // Send request
      const message: ToolRequestMessage = {
        type: "tool.request",
        payload: request,
      }

      this.roomManager.sendData(message, agentId).catch((error) => {
        clearTimeout(timeout)
        this.pendingRequests.delete(request.id)
        reject(error)
      })
    })
  }

  /**
   * Handle incoming data channel message
   */
  private async handleDataMessage(
    message: DataChannelMessage,
    participant: Participant,
  ): Promise<void> {
    switch (message.type) {
      case "tool.discovery":
        this.handleToolDiscovery(message.payload, participant)
        break

      case "tool.request":
        const response = await this.handleToolRequest(message.payload, participant)
        await this.sendToolResponse(participant.id, response)
        break

      case "tool.response":
        this.handleToolResponse(message.payload)
        break

      default:
        console.warn("Unknown message type:", message)
    }
  }

  /**
   * Handle tool discovery announcement
   */
  private handleToolDiscovery(
    payload: ToolDiscoveryMessage["payload"],
    participant: Participant,
  ): void {
    const tools: Tool[] = payload.tools.map((toolDef) => ({
      name: toolDef.name,
      description: toolDef.description,
      parameters: toolDef.parameters,
      execute: async (params: Record<string, any>) => {
        return await this.executeExternalTool(payload.agentId, toolDef.name, params)
      },
    }))

    this.registry.external.set(payload.agentId, tools)
    console.log(`Discovered ${tools.length} tools from agent: ${payload.agentId}`)
  }

  /**
   * Send tool response
   */
  private async sendToolResponse(participantId: string, response: ToolResponse): Promise<void> {
    const message: ToolResponseMessage = {
      type: "tool.response",
      payload: response,
    }

    await this.roomManager.sendData(message, participantId)
  }

  /**
   * Handle tool response
   */
  private handleToolResponse(response: ToolResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(response.id)

    if (response.error) {
      pending.reject(new Error(`Tool execution error: ${response.error.message}`))
    } else {
      pending.resolve(response.result)
    }
  }

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  /**
   * Check if request is within rate limit
   */
  private checkRateLimit(agentId: string): boolean {
    const now = Date.now()
    const limit = this.requestCounts.get(agentId)

    if (!limit || now > limit.resetAt) {
      this.requestCounts.set(agentId, {
        count: 1,
        resetAt: now + 60000, // 1 minute
      })
      return true
    }

    if (limit.count >= this.MAX_REQUESTS_PER_MINUTE) {
      return false
    }

    limit.count++
    return true
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Setup event handlers for room manager
   */
  private setupEventHandlers(): void {
    this.roomManager.on("dataReceived", (message, participant) => {
      this.handleDataMessage(message, participant)
    })

    this.roomManager.on("participantLeft", (participant) => {
      // Clean up external tools from departed participant
      this.registry.external.delete(participant.id)
    })
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Clear all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("Tool bridge shutting down"))
    }
    this.pendingRequests.clear()

    // Clear registries
    this.registry.local = []
    this.registry.external.clear()
    this.permissions.clear()
    this.requestCounts.clear()
  }
}

/**
 * Create a tool bridge instance
 */
export function createToolBridge(roomManager: RoomManager): ToolBridge {
  return new ToolBridge(roomManager)
}
