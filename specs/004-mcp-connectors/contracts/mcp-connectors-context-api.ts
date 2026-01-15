/**
 * MCP Connectors Context API Contract
 *
 * This file defines the public API contract for the McpConnectorsContext.
 * All components using useMcpConnectors() hook will interact through this interface.
 *
 * @package @opencode-ai/app
 * @version 1.0.0
 */

import type { Accessor } from 'solid-js';

// ============================================================================
// Data Types
// ============================================================================

/**
 * MCP Server configuration
 */
export interface McpServer {
  /** Command to execute (e.g., "npx", "node", "python") */
  command: string;

  /** Command-line arguments array */
  args?: string[];

  /** Environment variables for the server process */
  env?: Record<string, string>;

  /** Additional metadata (extensible) */
  [key: string]: any;
}

/**
 * MCP Input definition
 */
export interface McpInput {
  /** Type of input (e.g., "promptString") */
  type: string;

  /** Additional properties based on input type */
  [key: string]: any;
}

/**
 * Complete MCP configuration structure
 */
export interface McpConfig {
  /** Array of input definitions */
  inputs?: McpInput[];

  /** Map of server name to server configuration */
  servers: Record<string, McpServer>;
}

/**
 * Validation error details
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Operation result type
 */
export interface OperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  validationErrors?: ValidationError[];
}

// ============================================================================
// Context API Interface
// ============================================================================

/**
 * Public API for MCP Connectors management
 *
 * Accessed via: const connectors = useMcpConnectors()
 */
export interface McpConnectorsContextAPI {
  // -------------------------------------------------------------------------
  // State Accessors (Reactive)
  // -------------------------------------------------------------------------

  /**
   * Get current MCP configuration
   * @returns Reactive accessor to the current config
   */
  config: Accessor<McpConfig>;

  /**
   * Get loading state
   * @returns true if loading/saving in progress
   */
  isLoading: Accessor<boolean>;

  /**
   * Get error state
   * @returns Current error message, or null if no error
   */
  error: Accessor<string | null>;

  /**
   * Get unsaved changes flag
   * @returns true if there are unsaved changes in memory
   */
  hasUnsavedChanges: Accessor<boolean>;

  /**
   * Get currently editing server name
   * @returns Server name being edited, or null
   */
  editingServer: Accessor<string | null>;

  // -------------------------------------------------------------------------
  // Server Management Operations
  // -------------------------------------------------------------------------

  /**
   * Get a specific server configuration by name
   *
   * @param name - Server name (key in servers object)
   * @returns Server configuration, or undefined if not found
   *
   * @example
   * const server = connectors.getServer("serper-search")
   * if (server) {
   *   console.log(server.command) // "npx"
   * }
   */
  getServer(name: string): McpServer | undefined;

  /**
   * Get all server names
   *
   * @returns Array of server names
   *
   * @example
   * const names = connectors.getServerNames()
   * // ["serper-search", "mobile-mcp"]
   */
  getServerNames(): string[];

  /**
   * Check if a server name already exists
   *
   * @param name - Server name to check
   * @returns true if server exists
   *
   * @example
   * if (connectors.hasServer("my-server")) {
   *   console.log("Server already exists!")
   * }
   */
  hasServer(name: string): boolean;

  /**
   * Add a new server configuration
   *
   * @param name - Unique server name
   * @param server - Server configuration object
   * @returns Operation result with validation errors if any
   *
   * @example
   * const result = await connectors.addServer("my-server", {
   *   command: "npx",
   *   args: ["-y", "my-mcp-package"],
   *   env: { "API_KEY": "xxx" }
   * })
   *
   * if (result.success) {
   *   console.log("Server added successfully")
   * } else {
   *   console.error(result.error)
   * }
   */
  addServer(name: string, server: McpServer): Promise<OperationResult>;

  /**
   * Update an existing server configuration
   *
   * @param name - Server name to update
   * @param server - Updated server configuration
   * @returns Operation result with validation errors if any
   *
   * @example
   * await connectors.updateServer("my-server", {
   *   command: "node",
   *   args: ["./custom-server.js"]
   * })
   */
  updateServer(name: string, server: McpServer): Promise<OperationResult>;

  /**
   * Rename a server (change its key in the servers object)
   *
   * @param oldName - Current server name
   * @param newName - New server name
   * @returns Operation result
   *
   * @example
   * await connectors.renameServer("old-name", "new-name")
   */
  renameServer(oldName: string, newName: string): Promise<OperationResult>;

  /**
   * Remove a server configuration
   *
   * @param name - Server name to remove
   * @returns Operation result
   *
   * @example
   * await connectors.removeServer("my-server")
   */
  removeServer(name: string): Promise<OperationResult>;

  // -------------------------------------------------------------------------
  // Input Management Operations (P4 - Advanced)
  // -------------------------------------------------------------------------

  /**
   * Get all input definitions
   *
   * @returns Array of input definitions
   */
  getInputs(): McpInput[];

  /**
   * Add an input definition
   *
   * @param input - Input definition object
   * @returns Operation result
   */
  addInput(input: McpInput): Promise<OperationResult>;

  /**
   * Update an input definition by index
   *
   * @param index - Index in inputs array
   * @param input - Updated input definition
   * @returns Operation result
   */
  updateInput(index: number, input: McpInput): Promise<OperationResult>;

  /**
   * Remove an input definition by index
   *
   * @param index - Index in inputs array
   * @returns Operation result
   */
  removeInput(index: number): Promise<OperationResult>;

  // -------------------------------------------------------------------------
  // File Operations
  // -------------------------------------------------------------------------

  /**
   * Reload configuration from .mcp.json file
   *
   * Discards any unsaved changes in memory.
   *
   * @param force - If true, reload even if there are unsaved changes
   * @returns Operation result
   *
   * @example
   * // User clicked "Reload" button
   * await connectors.reload(true)
   */
  reload(force?: boolean): Promise<OperationResult>;

  /**
   * Save current configuration to .mcp.json file
   *
   * @returns Operation result
   *
   * @example
   * // Auto-save on changes
   * createEffect(() => {
   *   if (connectors.hasUnsavedChanges()) {
   *     debouncedSave()
   *   }
   * })
   */
  save(): Promise<OperationResult>;

  /**
   * Get raw JSON representation of current config
   *
   * @param pretty - If true, format with indentation
   * @returns JSON string
   *
   * @example
   * const json = connectors.toJSON(true)
   * console.log(json)
   */
  toJSON(pretty?: boolean): string;

  /**
   * Load configuration from raw JSON string
   *
   * @param json - JSON string to parse and load
   * @returns Operation result with validation errors if any
   *
   * @example
   * // User edited raw JSON and clicked "Apply"
   * const result = await connectors.fromJSON(jsonString)
   * if (!result.success) {
   *   alert(result.error)
   * }
   */
  fromJSON(json: string): Promise<OperationResult>;

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validate a server configuration without saving
   *
   * @param name - Server name to validate
   * @param server - Server configuration to validate
   * @returns Validation result with specific field errors
   *
   * @example
   * const result = connectors.validateServer("my-server", {
   *   command: "",  // Invalid: empty command
   *   args: []
   * })
   *
   * if (!result.success) {
   *   result.validationErrors.forEach(err => {
   *     console.error(`${err.field}: ${err.message}`)
   *   })
   * }
   */
  validateServer(name: string, server: McpServer): OperationResult;

  /**
   * Validate the entire configuration
   *
   * @param config - Configuration to validate
   * @returns Validation result
   */
  validateConfig(config: McpConfig): OperationResult;

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /**
   * Check if an environment variable looks sensitive
   *
   * @param key - Environment variable name
   * @returns true if key contains patterns like KEY, TOKEN, SECRET, etc.
   *
   * @example
   * connectors.isSensitiveEnvVar("API_KEY")  // true
   * connectors.isSensitiveEnvVar("DEBUG")    // false
   */
  isSensitiveEnvVar(key: string): boolean;

  /**
   * Get server count
   *
   * @returns Number of configured servers
   */
  getServerCount(): number;

  /**
   * Reset to default empty configuration
   *
   * Useful for testing or clearing all connectors.
   *
   * @param confirm - Safety check to prevent accidental resets
   * @returns Operation result
   */
  reset(confirm: boolean): Promise<OperationResult>;
}

// ============================================================================
// Event Types (for file watcher)
// ============================================================================

/**
 * File change event from watcher
 */
export interface FileChangeEvent {
  type: 'modify' | 'create' | 'delete';
  path: string;
  timestamp: number;
}

/**
 * File change handler type
 */
export type FileChangeHandler = (event: FileChangeEvent) => void;

// ============================================================================
// Provider Props
// ============================================================================

/**
 * Props for McpConnectorsProvider component
 */
export interface McpConnectorsProviderProps {
  children: any;

  /**
   * Optional: Custom .mcp.json file path (defaults to ".mcp.json")
   */
  configPath?: string;

  /**
   * Optional: Auto-save debounce delay in milliseconds (defaults to 500)
   */
  autoSaveDelay?: number;

  /**
   * Optional: Enable file watcher for external changes (defaults to true)
   */
  watchFile?: boolean;
}

// ============================================================================
// Usage Examples
// ============================================================================

/*

Example 1: Basic usage in a component
--------------------------------------

import { useMcpConnectors } from '@/context/mcp-connectors'

export function ConnectorsList() {
  const connectors = useMcpConnectors()

  return (
    <For each={connectors.getServerNames()}>
      {(name) => {
        const server = connectors.getServer(name)
        return (
          <div>
            <span>{name}</span>
            <span>{server?.command}</span>
          </div>
        )
      }}
    </For>
  )
}


Example 2: Add server with validation
--------------------------------------

async function handleAddServer(formData: { name: string; command: string; args: string[] }) {
  const connectors = useMcpConnectors()

  // Validate first
  const validation = connectors.validateServer(formData.name, {
    command: formData.command,
    args: formData.args
  })

  if (!validation.success) {
    // Show validation errors
    validation.validationErrors?.forEach(err => {
      showError(`${err.field}: ${err.message}`)
    })
    return
  }

  // Add server
  const result = await connectors.addServer(formData.name, {
    command: formData.command,
    args: formData.args
  })

  if (result.success) {
    showSuccess("Server added successfully!")
  } else {
    showError(result.error || "Failed to add server")
  }
}


Example 3: Auto-save on changes
--------------------------------

import { createEffect } from 'solid-js'
import { debounce } from '@solid-primitives/scheduled'

const connectors = useMcpConnectors()

const debouncedSave = debounce(async () => {
  await connectors.save()
}, 500)

createEffect(() => {
  if (connectors.hasUnsavedChanges()) {
    debouncedSave()
  }
})


Example 4: Handle external file changes
----------------------------------------

// In McpConnectorsProvider implementation

const handleFileChange = async (event: FileChangeEvent) => {
  if (event.type === 'modify') {
    if (hasUnsavedChanges()) {
      // Prompt user
      const shouldReload = await showConfirmDialog(
        "File changed externally",
        "Reload and lose unsaved changes?"
      )

      if (shouldReload) {
        await reload(true)
      }
    } else {
      // Silent reload
      await reload()
    }
  }
}

*/
