import Session from "../../session/index.js"
import { getCurrentSession, loadSession } from "../../session/index.js"
import bus from "../../bus/index.js"
import id from "../../id/index.js"
import project from "../../project/index.js"
import util from "../../util/index.js"
import replay from "./replay.js"
import { z } from "zod"
import { getProvider } from "../../provider/index.js"
import permission from "../../permission/index.js"
import { getUserConfig } from "../../config/index.js"
import { getEnv } from "../../env/index.js"
import os from "../../os/index.js"
import { getFlags } from "../../flag/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { IncomingMessage, ServerResponse } from "http"
import { Readable } from "stream"
import type {
	CallToolResult,
	ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js"
import { getDefaultModel } from "../../agent/model.js"
import { zodToJsonSchema } from "zod-to-json-schema"
import fs from "fs"
import path from "path"
import compaction from "../../session/compaction.js"
import revert from "../../session/revert.js"

const acpToolParameterSchema = z.object({
	name: z.string(),
	description: z.string(),
	inputSchema: z.object({
		type: z.literal("object"),
		properties: z.record(z.any()),
		required: z.array(z.string()).optional(),
	}),
})

type AcpTool = z.infer<typeof acpToolParameterSchema>

const acpToolResultSchema = z.object({
	name: z.string(),
	description: z.string(),
	inputSchema: z.object({
		type: z.literal("object"),
		properties: z.record(z.any()),
		required: z.array(z.string()).optional(),
	}),
})

async function getAgentTools(agent: Agent): Promise<AcpTool[]> {
	const result: AcpTool[] = []

	const tools = await agent.getTools()

	const toolCategories = [
		{
			prefix: "Read",
			tools: tools.filter((tool) => tool.category === "read"),
		},
		{
			prefix: "Edit",
			tools: tools.filter((tool) => tool.category === "edit"),
		},
		{
			prefix: "Grep",
			tools: tools.filter((tool) => tool.category === "grep"),
		},
		{
			prefix: "List",
			tools: tools.filter((tool) => tool.category === "list"),
		},
		{
			prefix: "Glob",
			tools: tools.filter((tool) => tool.category === "glob"),
		},
		{
			prefix: "Think",
			tools: tools.filter((tool) => tool.category === "think"),
		},
	]

	for (const category of toolCategories) {
		if (category.tools.length > 0) {
			for (const tool of category.tools) {
				const schema = tool.parameters
					? zodToJsonSchema(tool.parameters)
					: {
							type: "object",
							properties: {},
						}

				const inputSchema = {
					type: "object",
					properties: (schema as any).properties ?? {},
					...(Array.isArray((schema as any).required)
						? { required: (schema as any).required }
						: {}),
				}

				result.push({
					name: `${category.prefix}::${tool.name}`,
					description: tool.description,
					inputSchema,
				})
			}
		}
	}

	return result
}

export async function createAgentServer(agent: Agent): Promise<McpServer> {
	const server = new McpServer({ name: "opencode-agent", version: "1.0.0" })

	server.listTools = async (): Promise<ListToolsResult> => {
		const tools = await getAgentTools(agent)

		return {
			tools: tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			})),
		}
	}

	server.callTool = async (
		name: string,
		arguments_: any,
	): Promise<CallToolResult> => {
		const [prefix, toolName] = name.split("::")

		if (!toolName) {
			return {
				content: [
					{
						type: "text",
						text: `Invalid tool name: ${name}`,
					},
				],
				isError: true,
			}
		}

		const session = getCurrentSession()

		if (!session) {
			return {
				content: [
					{
						type: "text",
						text: "No active session. Please start a new session.",
					},
				],
				isError: true,
			}
		}

		const result = await session.agent.execute({
			action: toolName,
			...(arguments_ ?? {}),
		})

		if (result.success) {
			if (result.content) {
				return {
					content: [
						{
							type: "text",
							text: result.content,
						},
					],
				}
			} else {
				return {
					content: [
						{
							type: "text",
							text: `Successfully executed ${toolName}`,
						},
					],
				}
			}
		} else {
			return {
				content: [
					{
						type: "text",
						text: result.message ?? "Something went wrong",
					},
				],
				isError: true,
			}
		}
	}

	return server
}

export async function createAcpServer(
	agent: Agent,
): Promise<{
	server: McpServer
	connect: (request: IncomingMessage, response: ServerResponse) => void
}> {
	const server = await createAgentServer(agent)

	const connect = (request: IncomingMessage, response: ServerResponse) => {
		let transport: SSEServerTransport | StreamableHTTPServerTransport

		const protocol = request.headers["sec-websocket-protocol"]

		const usingStreamableHttp = request.method === "POST"

		if (usingStreamableHttp) {
			transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => id.generate(),
			})

			transport.onsessionidgenerator = () => {
				return id.generate()
			}
		} else {
			transport = new SSEServerTransport("/message", response)
		}

		const sessionToken = request.headers["x-session-token"] as string

		if (sessionToken) {
			Global.state.sessionToken = sessionToken
		}

		const cleanup = server.connect(transport, {
			async init(request) {
				const env = getEnv()

				const headers = {
					...request.headers,
					...env,
				}

				const { capabilities } = request

				const instruction = getUserConfig().agent?.instruction

				if (instruction) {
					bus.publish({
						type: "agent-instruction-set",
						instruction,
					})
				}

				if (
					capabilities?.roots?.listChanged &&
					env.OPENCODE_AUTOMATICALLY_ADD_GIT_ROOT !== "false"
				) {
					const projectPaths = await project.getRepositories()

					const roots = projectPaths.map((projectPath) => ({
						uri: `file://${projectPath}`,
						name: path.basename(projectPath),
					}))

					if (roots.length > 0) {
						return {
							capabilities: {
								roots: {
									listChanged: true,
								},
							},
							protocolVersion: "2024-11-05",
							serverInfo: {
								name: "opencode",
								version: "0.0.0",
							},
							instructions: `You can access the user's project at ${
								roots.length === 1
									? roots[0].uri
									: JSON.stringify(
											roots.map((root) => root.uri),
										)
							}. ${instruction}`,
							roots,
						}
					}
				}

				return {
					capabilities: {
						roots: {
							listChanged: true,
						},
					},
					protocolVersion: "2024-11-05",
					serverInfo: {
						name: "opencode",
						version: "0.0.0",
					},
					instructions: instruction,
				}
			},
		})

		response.on("close", () => {
			cleanup()
		})
	}

	return { server, connect }
}

export async function createRepl(agent: Agent): Promise<void> {
	if (!os.isInteractive()) {
		return
	}

	const prompts = getUserConfig().agent?.repl?.prompts

	const model = getDefaultModel()

	const tools = await getAgentTools(agent)

	let systemPrompt = prompts?.system

	if (!systemPrompt) {
		const provider = getProvider(model)

		if (provider) {
			systemPrompt = provider.systemPrompt
		}
	}

	let workingDirectory = process.cwd()

	const session = await loadSession({
		createdAt: new Date(),
		updatedAt: new Date(),
		title: "REPL Session",
		id: id.generate(),
		agent: await agent.clone(),
		workingDirectory,
	})

	let isWatching = false

	let abortController = new AbortController()

	const prompt = async () => {
		const flags = getFlags()

		if (flags.watch && !isWatching) {
			isWatching = true

			// TODO: Implement watching logic
		}

		const messages: Type.Message[] = session.messages

		const providers = await permission.getProviders()

		const lastMessage = messages[messages.length - 1]

		const input = lastMessage?.content === "" ? lastMessage : undefined

		if (input) {
			const message = await replay({
				agent,
				message: input,
				session,
				abortController: abortController.signal,
				providers,
			})

			if (message) {
				session.messages = [...session.messages, message]
			}
		}

		const answer = await util.prompt(
			`${workingDirectory} ${model} `,
			{
				history: true,
				suggestions: tools.map((tool) => ({
					value: `${tool.name} `,
					description: tool.description,
				})),
			},
		)

		if (answer === null) {
			return
		}

		workingDirectory = process.cwd()

		const message = await replay({
			agent,
			message: {
				content: answer,
				role: "user",
			},
			session,
			abortController: abortController.signal,
			providers,
		})

		if (message) {
			session.messages = [...session.messages, message]
		}
	}

	const promptBar = async (diff: boolean) => {
		let index = 0

		while (true) {
			const { exit, index: index2 } = await util.promptBar({
				title: diff ? "diff" : "repl",
				options: [
					{
						value: "prompt",
						label: "Prompt",
						key: "p",
					},
					{
						value: "continue",
						label: "Continue",
						key: "enter",
					},
					{
						value: "stop",
						label: "Stop",
						key: "q",
					},
					{
						value: "reset",
						label: "Reset",
						key: "r",
					},
				],
				default: diff ? "prompt" : "continue",
			})

			index = index2

			switch (exit) {
				case "stop": {
					abortController.abort()

					abortController = new AbortController()

					return
				}

				case "reset": {
					const session2 = await loadSession({
						createdAt: new Date(),
						updatedAt: new Date(),
						title: "REPL Session",
						id: id.generate(),
						agent: await agent.clone(),
						workingDirectory,
					})

					// eslint-disable-next-line require-atomic-updates
					session.messages = session2.messages

					return
				}

				case "prompt": {
					await prompt()

					return
				}

				case "continue": {
					const messages = session.messages

					const lastMessage = messages[messages.length - 1]

					const continueMessage: Type.Message = {
						content: "Continue",
						role: "user",
						...(!lastMessage || lastMessage.role === "assistant"
							? {}
							: {
									parentId: lastMessage.id,
								}),
					}

					const message = await replay({
						agent,
						message: continueMessage,
						session,
						abortController: abortController.signal,
					})

					if (message) {
						session.messages = [...session.messages, message]
					}

					return
				}
			}
		}

		// TODO: diff
	}

	while (true) {
		const { exit, value } = await util.promptBar({
			title: "repl",
			options: [
				{
					value: "prompt",
					label: "Prompt",
					key: "p",
					selected: true,
				},
				{
					value: "continue",
					label: "Continue",
					key: "c",
				},
				{
					value: "reset",
					label: "Reset",
					key: "r",
				},
				{
					value: "exit",
					label: "Exit",
					key: "q",
				},
			],
			default: "prompt",
		})

		switch (exit) {
			case "prompt": {
				await prompt()

				break
			}

			case "continue": {
				const messages = session.messages

				const lastMessage = messages[messages.length - 1]

				const continueMessage: Type.Message = {
					content: "Continue",
					role: "user",
					...(!lastMessage || lastMessage.role === "assistant"
						? {}
						: {
								parentId: lastMessage.id,
							}),
				}

				const message = await replay({
					agent,
					message: continueMessage,
					session,
					abortController: abortController.signal,
				})

				if (message) {
					session.messages = [...session.messages, message]
				}

				break
			}

			case "reset": {
				const session2 = await loadSession({
					createdAt: new Date(),
					updatedAt: new Date(),
					title: "REPL Session",
					id: id.generate(),
					agent: await agent.clone(),
					workingDirectory,
				})

				// eslint-disable-next-line require-atomic-updates
				session.messages = session2.messages

				break
			}

			case "exit": {
				return
			}
		}
	}
}

// SESSION MANAGEMENT TYPES FOR ACP
// Issue #8931: Expose TUI Session Management Commands via ACP

export interface SessionInfo {
	id: string
	title: string
	createdAt: string
	updatedAt: string
	projectPath?: string
	messageCount: number
}

export interface SessionListParams {
	limit?: number
	projectPath?: string
}

export interface SessionListResult {
	sessions: SessionInfo[]
}

export interface SessionSwitchParams {
	sessionId: string
}

export interface SessionCreateParams {
	title?: string
	projectPath?: string
}

export interface SessionForkParams {
	sessionId: string
	messageId: string
	title?: string
}

export interface SessionRenameParams {
	sessionId: string
	title: string
}

export interface SessionDeleteParams {
	sessionId: string
}

export interface SessionInfoParams {
	sessionId: string
}

export interface SessionUndoParams {
	sessionId?: string
}

export interface SessionRedoParams {
	sessionId?: string
}

export interface SessionCompactParams {
	sessionId?: string
}

export interface SessionExportParams {
	sessionId?: string
	format?: "text" | "json" | "markdown"
}

export interface SessionExportResult {
	content: string
	filename: string
}

export interface SessionJumpParams {
	sessionId: string
	messageId: string
}

export interface SessionDuplicateParams {
	sessionId: string
	title?: string
}

// Session storage location reference
export const SESSION_STORAGE_PATH = "~/.local/share/opencode/storage/session/"

// Helper to format session for API response
function formatSessionInfo(session: any): SessionInfo {
	return {
		id: session.id,
		title: session.title ?? `Session ${session.id?.slice(0, 8) ?? "unknown"}`,
		createdAt: session.createdAt ?? new Date().toISOString(),
		updatedAt: session.updatedAt ?? new Date().toISOString(),
		projectPath: session.projectPath,
		messageCount: session.messages?.length ?? 0,
	}
}

// SESSION MANAGEMENT HANDLERS

/**
 * List all available sessions
 */
export async function listSessions(
	params: SessionListParams = {},
): Promise<SessionListResult> {
	const sessionDir = path.join(
		os.home(),
		".local/share/opencode/storage/session",
	)

	const sessions: SessionInfo[] = []

	if (fs.existsSync(sessionDir)) {
		const entries = fs.readdirSync(sessionDir)

		const limit = params.limit ?? 50

		for (const entry of entries.slice(0, limit)) {
			const sessionPath = path.join(sessionDir, entry)

			if (fs.statSync(sessionPath).isDirectory()) {
				try {
					const sessionFile = path.join(sessionPath, "session.json")

					if (fs.existsSync(sessionFile)) {
						const content = fs.readFileSync(sessionFile, "utf-8")
						const sessionData = JSON.parse(content)

						// Filter by projectPath if specified
						if (
							params.projectPath &&
							sessionData.projectPath !== params.projectPath
						) {
							continue
						}

						sessions.push(formatSessionInfo(sessionData))
					}
				} catch {
					// Skip invalid sessions
				}
			}
		}

		// Sort by updatedAt descending (most recent first)
		sessions.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		)
	}

	return { sessions }
}

/**
 * Switch to an existing session
 */
export async function switchSession(
	params: SessionSwitchParams,
): Promise<{ success: boolean; sessionId: string }> {
	const { sessionId } = params

	if (!sessionId) {
		throw new Error("sessionId is required")
	}

	const sessionPath = path.join(
		os.home(),
		".local/share/opencode/storage/session",
		sessionId,
		"session.json",
	)

	if (!fs.existsSync(sessionPath)) {
		throw new Error(`Session ${sessionId} not found`)
	}

	const content = fs.readFileSync(sessionPath, "utf-8")
	const sessionData = JSON.parse(content)

	// Store the session ID to switch to in a way the agent can pick it up
	// The actual switching happens when the agent initializes
	process.env.OPENCODE_SESSION_ID = sessionId

	return { success: true, sessionId }
}

/**
 * Create a new session
 */
export async function createSession(
	params: SessionCreateParams = {},
): Promise<SessionInfo> {
	const { title, projectPath } = params

	const session = await loadSession({
		createdAt: new Date(),
		updatedAt: new Date(),
		title: title ?? "New Session",
		id: id.generate(),
		agent: undefined,
		workingDirectory: projectPath ?? process.cwd(),
	})

	return formatSessionInfo(session)
}

/**
 * Fork a session from a specific message
 */
export async function forkSession(
	params: SessionForkParams,
): Promise<SessionInfo> {
	const { sessionId, messageId, title } = params

	// Load the source session
	const sessionPath = path.join(
		os.home(),
		".local/share/opencode/storage/session",
		sessionId,
		"session.json",
	)

	if (!fs.existsSync(sessionPath)) {
		throw new Error(`Session ${sessionId} not found`)
	}

	const content = fs.readFileSync(sessionPath, "utf-8")
	const sessionData = JSON.parse(content)

	// Find the message to fork from
	let forkIndex = -1

	if (messageId) {
		forkIndex = sessionData.messages?.findIndex(
			(m: any) => m.id === messageId,
		) ?? -1
	}

	// Create a new session with messages up to the fork point
	const messages = forkIndex >= 0
		? sessionData.messages.slice(0, forkIndex + 1)
		: [...(sessionData.messages ?? [])]

	const newSession = await loadSession({
		createdAt: new Date(),
		updatedAt: new Date(),
		title:
			title ??
			`${sessionData.title ?? "Fork"} (${new Date().toLocaleDateString()})`,
		id: id.generate(),
		agent: undefined,
		workingDirectory: sessionData.projectPath ?? process.cwd(),
		messages: messages.map((m: any) => ({
			...m,
			id: m.id,
			role: m.role,
			content: m.content,
		})),
	})

	return formatSessionInfo(newSession)
}

/**
 * Rename a session
 */
export async function renameSession(
	params: SessionRenameParams,
): Promise<{ success: boolean; sessionId: string }> {
	const { sessionId, title } = params

	if (!sessionId) {
		throw new Error("sessionId is required")
	}

	if (!title) {
		throw new Error("title is required")
	}

	const sessionPath = path.join(
		os.home(),
		".local/share/opencode/storage/session",
		sessionId,
		"session.json",
	)

	if (!fs.existsSync(sessionPath)) {
		throw new Error(`Session ${sessionId} not found`)
	}

	const content = fs.readFileSync(sessionPath, "utf-8")
	const sessionData = JSON.parse(content)

	sessionData.title = title
	sessionData.updatedAt = new Date().toISOString()

	fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2))

	return { success: true, sessionId }
}

/**
 * Delete a session
 */
export async function deleteSession(
	params: SessionDeleteParams,
): Promise<{ success: boolean; sessionId: string }> {
	const { sessionId } = params

	if (!sessionId) {
		throw new Error("sessionId is required")
	}

	const sessionPath = path.join(
		os.home(),
		".local/share/opencode/storage/session",
		sessionId,
	)

	if (!fs.existsSync(sessionPath)) {
		throw new Error(`Session ${sessionId} not found`)
	}

	// Recursively delete the session directory
	fs.rmSync(sessionPath, { recursive: true })

	return { success: true, sessionId }
}

/**
 * Get information about a specific session
 */
export async function getSessionInfo(
	params: SessionInfoParams,
): Promise<SessionInfo> {
	const { sessionId } = params

	if (!sessionId) {
		throw new Error("sessionId is required")
	}

	const sessionPath = path.join(
		os.home(),
		".local/share/opencode/storage/session",
		sessionId,
		"session.json",
	)

	if (!fs.existsSync(sessionPath)) {
		throw new Error(`Session ${sessionId} not found`)
	}

	const content = fs.readFileSync(sessionPath, "utf-8")
	const sessionData = JSON.parse(content)

	return formatSessionInfo(sessionData)
}

/**
 * Undo the last message in a session
 */
export async function undoMessage(
	params: SessionUndoParams = {},
): Promise<{ success: boolean; sessionId: string }> {
	const { sessionId } = params

	const currentSession = getCurrentSession()

	const targetSessionId = sessionId ?? currentSession?.id

	if (!targetSessionId) {
		throw new Error("No active session")
	}

	const sessionPath = path.join(
		os.home(),
		".local/share/opencode/storage/session",
		targetSessionId,
		"session.json",
	)

	if (!fs.existsSync(sessionPath)) {
		throw new Error(`Session ${targetSessionId} not found`)
	}

	const content = fs.readFileSync(sessionPath, "utf-8")
	const sessionData = JSON.parse(content)

	// Remove the last user message and its following assistant message
	const messages = sessionData.messages ?? []

	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			messages.splice(i)
			break
		}
	}

	sessionData.messages = messages
	sessionData.updatedAt = new Date().toISOString()

	fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2))

	return { success: true, sessionId: targetSessionId }
}

/**
 * Redo a message in a session
 */
export async function redoMessage(
	params: SessionRedoParams = {},
): Promise<{ success: boolean; sessionId: string }> {
	const { sessionId } = params

	const currentSession = getCurrentSession()

	const targetSessionId = sessionId ?? currentSession?.id

	if (!targetSessionId) {
		throw new Error("No active session")
	}

	// Note: This is a placeholder implementation
	// A full implementation would need to store redo history
	throw new Error("Redo is not yet implemented")
}

/**
 * Compact a session
 */
export async function compactSession(
	params: SessionCompactParams = {},
): Promise<{ success: boolean; sessionId: string }> {
	const { sessionId } = params

	const currentSession = getCurrentSession()

	const targetSessionId = sessionId ?? currentSession?.id

	if (!targetSessionId) {
		throw new Error("No active session")
	}

	const sessionPath = path.join(
		os.home(),
		".local/share/opencode/storage/session",
		targetSessionId,
		"session.json",
	)

	if (!fs.existsSync(sessionPath)) {
		throw new Error(`Session ${targetSessionId} not found`)
	}

	const content = fs.readFileSync(sessionPath, "utf-8")
	const sessionData = JSON.parse(content)

	// Compact the session using the compaction module
	const compacted = await compaction(sessionData)

	fs.writeFileSync(sessionPath, JSON.stringify(compacted, null, 2))

	return { success: true, sessionId: targetSessionId }
}

/**
 * Export a session
 */
export async function exportSession(
	params: SessionExportParams = {},
): Promise<SessionExportResult> {
	const { sessionId, format = "markdown" } = params

	const currentSession = getCurrentSession()

	const targetSessionId = sessionId ?? currentSession?.id

	if (!targetSessionId) {
		throw new Error("No active session")
	}

	const sessionPath = path.join(
		os.home(),
		".local/share/opencode/storage/session",
		targetSessionId,
		"session.json",
	)

	if (!fs.existsSync(sessionPath)) {
		throw new Error(`Session ${targetSessionId} not found`)
	}

	const content = fs.readFileSync(sessionPath, "utf-8")
	const sessionData = JSON.parse(content)

	let output = ""
	let filename = `session-${targetSessionId.slice(0, 8)}`

	switch (format) {
		case "text": {
			for (const message of sessionData.messages ?? []) {
				output += `${message.role.toUpperCase()}: ${message.content}\n\n`
			}

			filename += ".txt"

			break
		}

		case "json": {
			output = JSON.stringify(sessionData, null, 2)
			filename += ".json"

			break
		}

		case "markdown": {
			output += `# ${sessionData.title ?? "Session"}\n\n`
			output += `Created: ${sessionData.createdAt}\n\n`

			for (const message of sessionData.messages ?? []) {
				output += `## ${message.role.toUpperCase()}\n\n`
				output += `${message.content}\n\n`
			}

			filename += ".md"

			break
		}
	}

	return { content: output, filename }
}

/**
 * Jump to a specific message in a session
 */
export async function jumpToMessage(
	params: SessionJumpParams,
): Promise<{ success: boolean; sessionId: string }> {
	const { sessionId, messageId } = params

	if (!sessionId) {
		throw new Error("sessionId is required")
	}

	if (!messageId) {
		throw new Error("messageId is required")
	}

	const sessionPath = path.join(
		os.home(),
		".local/share/opencode/storage/session",
		sessionId,
		"session.json",
	)

	if (!fs.existsSync(sessionPath)) {
		throw new Error(`Session ${sessionId} not found`)
	}

	const content = fs.readFileSync(sessionPath, "utf-8")
	const sessionData = JSON.parse(content)

	// Verify message exists
	const messageIndex = sessionData.messages?.findIndex(
		(m: any) => m.id === messageId,
	)

	if (messageIndex === -1) {
		throw new Error(`Message ${messageId} not found in session`)
	}

	// Mark the message as the current position
	// The agent will use this to limit context to messages up to this point
	process.env.OPENCODE_MESSAGE_ID = messageId

	return { success: true, sessionId }
}

/**
 * Duplicate a session
 */
export async function duplicateSession(
	params: SessionDuplicateParams,
): Promise<SessionInfo> {
	const { sessionId, title } = params

	if (!sessionId) {
		throw new Error("sessionId is required")
	}

	const sessionPath = path.join(
		os.home(),
		".local/share/opencode/storage/session",
		sessionId,
		"session.json",
	)

	if (!fs.existsSync(sessionPath)) {
		throw new Error(`Session ${sessionId} not found`)
	}

	const content = fs.readFileSync(sessionPath, "utf-8")
	const sessionData = JSON.parse(content)

	// Create a new session with the same messages
	const newSession = await loadSession({
		createdAt: new Date(),
		updatedAt: new Date(),
		title:
			title ??
			`${sessionData.title ?? "Copy"} (${new Date().toLocaleDateString()})`,
		id: id.generate(),
		agent: undefined,
		workingDirectory: sessionData.projectPath ?? process.cwd(),
		messages: sessionData.messages ?? [],
	})

	return formatSessionInfo(newSession)
}
