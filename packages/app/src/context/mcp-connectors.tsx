/**
 * MCP Connectors Context
 *
 * Manages MCP (Model Context Protocol) server configurations in `.mcp.json` file.
 * Feature: 004-mcp-connectors
 */

import { createStore } from "solid-js/store"
import { createSignal, createEffect, onMount } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"
import { z } from "zod"
import type {
	McpConfig,
	McpServer,
	McpInput,
	OperationResult,
	ValidationError,
} from "@/types/mcp-connectors"

// =============================================================================
// Validation Schema (Zod)
// =============================================================================

const McpServerSchema = z.object({
	command: z.string().min(1, "Command is required"),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
})

const McpInputSchema = z.object({
	type: z.string().min(1, "Input type is required"),
})

const McpConfigSchema = z.object({
	inputs: z.array(McpInputSchema).optional().default([]),
	servers: z.record(
		z.string().regex(/^[a-zA-Z0-9_-]+$/, "Server name must be alphanumeric with hyphens/underscores"),
		McpServerSchema
	),
})

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: McpConfig = {
	inputs: [],
	servers: {},
}

// Helper function to write text files
// NOTE: File write support requires platform-specific implementation.
// For desktop (Tauri), the invoke function should be injected at runtime.
// This approach avoids compile-time dependency on @tauri-apps/api in the app package.
async function writeTextFile(path: string, content: string): Promise<void> {
	// Check if Tauri's invoke is available on window (set by desktop app)
	const tauriInvoke = (window as any).__TAURI_INTERNALS__?.invoke
	if (tauriInvoke) {
		try {
			await tauriInvoke("write_file", { path, content })
			return
		} catch (err) {
			// Tauri command may not exist, fall through to other options
			console.warn("Tauri write_file command not available:", err)
		}
	}

	// Fallback: Try using globalThis if platform provides write capability
	const platform = (globalThis as any).__OPENCODE_PLATFORM__
	if (platform?.writeFile) {
		await platform.writeFile(path, content)
		return
	}

	// If no write mechanism is available, throw a descriptive error
	throw new Error("File write not available. This feature requires the desktop app with proper file system access.")
}

// =============================================================================
// Context Implementation
// =============================================================================

export const { use: useMcpConnectors, provider: McpConnectorsProvider } = createSimpleContext({
	name: "McpConnectors",
	init: () => {
		const sdk = useSDK()
		const MCP_JSON_PATH = ".mcp.json"

		// State
		const [config, setConfig] = createStore<McpConfig>(DEFAULT_CONFIG)
		const [isLoading, setIsLoading] = createSignal(false)
		const [error, setError] = createSignal<string | null>(null)
		const [hasUnsavedChanges, setHasUnsavedChanges] = createSignal(false)

		// =============================================================================
		// Validation
		// =============================================================================

		function validateConfig(data: unknown): OperationResult<McpConfig> {
			try {
				const validated = McpConfigSchema.parse(data)
				return { success: true, data: validated }
			} catch (err) {
				if (err instanceof z.ZodError) {
					const validationErrors: ValidationError[] = err.issues.map((e: z.ZodIssue) => ({
						field: e.path.join("."),
						message: e.message,
					}))
					return {
						success: false,
						error: "Validation failed",
						validationErrors,
					}
				}
				return { success: false, error: "Unknown validation error" }
			}
		}

		function validateServer(name: string, server: McpServer): OperationResult {
			// Validate server name pattern
			const nameRegex = /^[a-zA-Z0-9_-]+$/
			if (!nameRegex.test(name)) {
				return {
					success: false,
					error: "Invalid server name",
					validationErrors: [
						{
							field: "name",
							message: "Server name must contain only alphanumeric characters, hyphens, and underscores",
						},
					],
				}
			}

			// Validate server config
			try {
				McpServerSchema.parse(server)
				return { success: true }
			} catch (err) {
				if (err instanceof z.ZodError) {
					const validationErrors: ValidationError[] = err.issues.map((e: z.ZodIssue) => ({
						field: e.path.join("."),
						message: e.message,
					}))
					return { success: false, error: "Invalid server configuration", validationErrors }
				}
				return { success: false, error: "Unknown validation error" }
			}
		}

		// =============================================================================
		// File I/O Operations
		// =============================================================================

		async function reload(force = false): Promise<OperationResult> {
			if (!force && hasUnsavedChanges()) {
				return {
					success: false,
					error: "Cannot reload with unsaved changes. Use force=true to discard changes.",
				}
			}

			setIsLoading(true)
			setError(null)

			try {
				const result = await sdk.client.file.read({ path: MCP_JSON_PATH })
				if (!result.data) {
					throw new Error("File read returned no data")
				}
				const parsed = JSON.parse(result.data.content)

				// Validate parsed config
				const validation = validateConfig(parsed)
				if (!validation.success) {
					setError(validation.error || "Invalid configuration file")
					setIsLoading(false)
					return { success: false, error: validation.error, validationErrors: validation.validationErrors }
				}

				setConfig(validation.data!)
				setHasUnsavedChanges(false)
				setIsLoading(false)
				return { success: true }
			} catch (err: unknown) {
				const errorMessage = err instanceof Error ? err.message : "Unknown error"

				// Check if file doesn't exist or is empty/invalid JSON - auto-initialize
				if (
					errorMessage.includes("not found") ||
					errorMessage.includes("ENOENT") ||
					errorMessage.includes("Unexpected EOF") ||
					errorMessage.includes("Unexpected end of JSON")
				) {
					// Auto-create default config
					return await initializeDefaultConfig()
				}

				setError(`Failed to read .mcp.json: ${errorMessage}`)
				setIsLoading(false)
				return { success: false, error: `Failed to read file: ${errorMessage}` }
			}
		}

		async function save(): Promise<OperationResult> {
			setIsLoading(true)
			setError(null)

			try {
				// Validate before saving
				const validation = validateConfig(config)
				if (!validation.success) {
					setError(validation.error || "Invalid configuration")
					setIsLoading(false)
					return { success: false, error: validation.error, validationErrors: validation.validationErrors }
				}

				const content = JSON.stringify(config, null, 2)
				await writeTextFile(MCP_JSON_PATH, content)

				setHasUnsavedChanges(false)
				setIsLoading(false)
				return { success: true }
			} catch (err: unknown) {
				const errorMessage = err instanceof Error ? err.message : "Unknown error"
				setError(`Failed to save .mcp.json: ${errorMessage}`)
				setIsLoading(false)
				return { success: false, error: `Failed to save file: ${errorMessage}` }
			}
		}

		async function initializeDefaultConfig(): Promise<OperationResult> {
			try {
				const content = JSON.stringify(DEFAULT_CONFIG, null, 2)
				await writeTextFile(MCP_JSON_PATH, content)
				setConfig(DEFAULT_CONFIG)
				setHasUnsavedChanges(false)
				setIsLoading(false)
				return { success: true }
			} catch (err: unknown) {
				const errorMessage = err instanceof Error ? err.message : "Unknown error"
				setError(`Failed to create .mcp.json: ${errorMessage}`)
				setIsLoading(false)
				return { success: false, error: `Failed to create file: ${errorMessage}` }
			}
		}

		// =============================================================================
		// Server Management Operations
		// =============================================================================

		function getServer(name: string): McpServer | undefined {
			return config.servers[name]
		}

		function getServerNames(): string[] {
			return Object.keys(config.servers)
		}

		function hasServer(name: string): boolean {
			return name in config.servers
		}

		async function addServer(name: string, server: McpServer): Promise<OperationResult> {
			// Check for duplicate name
			if (hasServer(name)) {
				return {
					success: false,
					error: "Server name already exists",
					validationErrors: [{ field: "name", message: "Server name must be unique" }],
				}
			}

			// Validate server
			const validation = validateServer(name, server)
			if (!validation.success) {
				return validation
			}

			// Add to config
			setConfig("servers", name, server)
			setHasUnsavedChanges(true)

			// Auto-save
			return await save()
		}

		async function updateServer(name: string, server: McpServer): Promise<OperationResult> {
			// Check server exists
			if (!hasServer(name)) {
				return { success: false, error: "Server not found" }
			}

			// Validate server
			const validation = validateServer(name, server)
			if (!validation.success) {
				return validation
			}

			// Update config
			setConfig("servers", name, server)
			setHasUnsavedChanges(true)

			// Auto-save
			return await save()
		}

		async function renameServer(oldName: string, newName: string): Promise<OperationResult> {
			// Check old server exists
			if (!hasServer(oldName)) {
				return { success: false, error: "Server not found" }
			}

			// Check new name is different
			if (oldName === newName) {
				return { success: true } // No-op
			}

			// Check new name doesn't exist
			if (hasServer(newName)) {
				return {
					success: false,
					error: "New server name already exists",
					validationErrors: [{ field: "name", message: "Server name must be unique" }],
				}
			}

			// Validate new name
			const nameRegex = /^[a-zA-Z0-9_-]+$/
			if (!nameRegex.test(newName)) {
				return {
					success: false,
					error: "Invalid server name",
					validationErrors: [
						{
							field: "name",
							message: "Server name must contain only alphanumeric characters, hyphens, and underscores",
						},
					],
				}
			}

			// Get old server config
			const server = config.servers[oldName]

			// Remove old, add new
			setConfig("servers", (servers) => {
				const newServers = { ...servers }
				delete newServers[oldName]
				newServers[newName] = server
				return newServers
			})

			setHasUnsavedChanges(true)

			// Auto-save
			return await save()
		}

		async function removeServer(name: string): Promise<OperationResult> {
			// Check server exists
			if (!hasServer(name)) {
				return { success: false, error: "Server not found" }
			}

			// Remove from config
			setConfig("servers", (servers) => {
				const newServers = { ...servers }
				delete newServers[name]
				return newServers
			})

			setHasUnsavedChanges(true)

			// Auto-save
			return await save()
		}

		// =============================================================================
		// Input Management Operations
		// =============================================================================

		function getInputs(): McpInput[] {
			return config.inputs || []
		}

		async function addInput(input: McpInput): Promise<OperationResult> {
			try {
				McpInputSchema.parse(input)
			} catch (err) {
				if (err instanceof z.ZodError) {
					return {
						success: false,
						error: "Invalid input configuration",
						validationErrors: err.issues.map((e: z.ZodIssue) => ({ field: e.path.join("."), message: e.message })),
					}
				}
			}

			setConfig("inputs", (inputs) => [...(inputs || []), input])
			setHasUnsavedChanges(true)
			return await save()
		}

		async function updateInput(index: number, input: McpInput): Promise<OperationResult> {
			const inputs = config.inputs || []
			if (index < 0 || index >= inputs.length) {
				return { success: false, error: "Invalid input index" }
			}

			try {
				McpInputSchema.parse(input)
			} catch (err) {
				if (err instanceof z.ZodError) {
					return {
						success: false,
						error: "Invalid input configuration",
						validationErrors: err.issues.map((e: z.ZodIssue) => ({ field: e.path.join("."), message: e.message })),
					}
				}
			}

			setConfig("inputs", index, input)
			setHasUnsavedChanges(true)
			return await save()
		}

		async function removeInput(index: number): Promise<OperationResult> {
			const inputs = config.inputs || []
			if (index < 0 || index >= inputs.length) {
				return { success: false, error: "Invalid input index" }
			}

			setConfig("inputs", (inputs) => inputs!.filter((_, i) => i !== index))
			setHasUnsavedChanges(true)
			return await save()
		}

		// =============================================================================
		// Utilities
		// =============================================================================

		function isSensitiveEnvVar(key: string): boolean {
			return /KEY|TOKEN|SECRET|PASSWORD|API|CREDENTIAL/i.test(key)
		}

		function getServerCount(): number {
			return Object.keys(config.servers).length
		}

		function toJSON(pretty = false): string {
			return pretty ? JSON.stringify(config, null, 2) : JSON.stringify(config)
		}

		async function fromJSON(json: string): Promise<OperationResult> {
			try {
				const parsed = JSON.parse(json)
				const validation = validateConfig(parsed)

				if (!validation.success) {
					return { success: false, error: validation.error, validationErrors: validation.validationErrors }
				}

				setConfig(validation.data!)
				setHasUnsavedChanges(true)
				return await save()
			} catch (err: unknown) {
				const errorMessage = err instanceof Error ? err.message : "Unknown error"
				return { success: false, error: `Invalid JSON: ${errorMessage}` }
			}
		}

		async function reset(confirm: boolean): Promise<OperationResult> {
			if (!confirm) {
				return { success: false, error: "Reset requires confirmation" }
			}

			setConfig(DEFAULT_CONFIG)
			setHasUnsavedChanges(true)
			return await save()
		}

		// =============================================================================
		// Initialization
		// =============================================================================

		onMount(async () => {
			await reload()
		})

		// =============================================================================
		// Public API
		// =============================================================================

		return {
			// State accessors
			config: () => config,
			isLoading,
			error,
			hasUnsavedChanges,

			// Server management
			getServer,
			getServerNames,
			hasServer,
			addServer,
			updateServer,
			renameServer,
			removeServer,

			// Input management
			getInputs,
			addInput,
			updateInput,
			removeInput,

			// File operations
			reload,
			save,
			toJSON,
			fromJSON,

			// Validation
			validateServer,
			validateConfig,

			// Utilities
			isSensitiveEnvVar,
			getServerCount,
			reset,
		}
	},
})
