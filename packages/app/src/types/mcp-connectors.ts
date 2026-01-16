/**
 * MCP Connectors Type Definitions
 *
 * Types for managing MCP (Model Context Protocol) server configurations
 * in the `.mcp.json` file.
 */

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
	[key: string]: unknown;
}

/**
 * MCP Input definition
 */
export interface McpInput {
	/** Type of input (e.g., "promptString") */
	type: string;

	/** Additional properties based on input type */
	[key: string]: unknown;
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

/**
 * Form data type for add/edit operations
 */
export interface ConnectorFormData {
	/** Server name */
	name: string;

	/** Command to execute */
	command: string;

	/** Command arguments */
	args: string[];

	/** Environment variables */
	env: Record<string, string>;
}

/**
 * Form mode type
 */
export type FormMode = "add" | "edit";

/**
 * Individual env var entry (for form state)
 */
export interface EnvVarEntry {
	id: string; // Unique ID for Solid.js keying
	key: string;
	value: string;
}
