import Agent from "../../agent/index.js"
import Global from "../../global/index.js"
import * as Type from "../../type/index.js"
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
import type {
	CallToolResult,
	ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js"
import { getDefaultModel } from "../../agent/model.js"
import { zodToJsonSchema } from "zod-to-json-schema"
import {
	listSessions,
	switchSession,
	createSession,
	forkSession,
	renameSession,
	deleteSession,
	getSessionInfo,
	undoMessage,
	redoMessage,
	compactSession,
	exportSession,
	jumpToMessage,
	duplicateSession,
} from "./session-handlers.js"

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

async function getSessionManagementTools(): Promise<AcpTool[]> {
	return [
		{
			name: "Session::list",
			description:
				"List all available sessions. Returns a list of sessions with their metadata including id, title, createdAt, updatedAt, projectPath, and messageCount.",
			inputSchema: {
				type: "object",
				properties: {
					limit: {
						type: "integer",
						description: "Maximum number of sessions to return (default: 50)",
					},
					projectPath: {
						type: "string",
						description: "Filter sessions by project path",
					},
				},
			},
		},
		{
			name: "Session::switch",
			description:
				"Switch to an existing session by ID. The agent will continue the conversation from where it left off.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the session to switch to",
					},
				},
				required: ["sessionId"],
			},
		},
		{
			name: "Session::create",
			description:
				"Create a new session. Returns the created session's metadata.",
			inputSchema: {
				type: "object",
				properties: {
					title: {
						type: "string",
						description: "Optional title for the new session",
					},
					projectPath: {
						type: "string",
						description: "Optional project path for the session",
					},
				},
			},
		},
		{
			name: "Session::fork",
			description:
				"Fork a session from a specific message. Creates a new session with messages up to and including the specified message.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the source session",
					},
					messageId: {
						type: "string",
						description: "The ID of the message to fork from",
					},
					title: {
						type: "string",
						description: "Optional title for the forked session",
					},
				},
				required: ["sessionId", "messageId"],
			},
		},
		{
			name: "Session::rename",
			description: "Rename an existing session.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the session to rename",
					},
					title: {
						type: "string",
						description: "The new title for the session",
					},
				},
				required: ["sessionId", "title"],
			},
		},
		{
			name: "Session::delete",
			description:
				"Delete an existing session. This action cannot be undone.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the session to delete",
					},
				},
				required: ["sessionId"],
			},
		},
		{
			name: "Session::info",
			description: "Get detailed information about a specific session.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the session",
					},
				},
				required: ["sessionId"],
			},
		},
		{
			name: "Session::undo",
			description:
				"Undo the last user message and its response in the session.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the session (uses current session if not provided)",
					},
				},
			},
		},
		{
			name: "Session::redo",
			description: "Redo a previously undone message.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the session (uses current session if not provided)",
					},
				},
			},
		},
		{
			name: "Session::compact",
			description:
				"Compact a session by summarizing older messages to reduce context size.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the session (uses current session if not provided)",
					},
				},
			},
		},
		{
			name: "Session::export",
			description: "Export a session in the specified format.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the session (uses current session if not provided)",
					},
					format: {
						type: "string",
						enum: ["text", "json", "markdown"],
						description: "Export format (default: markdown)",
					},
				},
			},
		},
		{
			name: "Session::jump",
			description:
				"Jump to a specific message in a session. Limits the context to messages up to that point.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the session",
					},
					messageId: {
						type: "string",
						description: "The ID of the message to jump to",
					},
				},
				required: ["sessionId", "messageId"],
			},
		},
		{
			name: "Session::duplicate",
			description: "Create a copy of an existing session.",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "The ID of the session to duplicate",
					},
					title: {
						type: "string",
						description: "Optional title for the duplicated session",
					},
				},
				required: ["sessionId"],
			},
		},
	]
}

export async function createAgentServer(agent: Agent): Promise<McpServer> {
	const server = new McpServer({ name: "opencode-agent", version: "1.0.0" })

	server.listTools = async (): Promise<ListToolsResult> => {
		const [agentTools, sessionTools] = await Promise.all([
			getAgentTools(agent),
			getSessionManagementTools(),
		])

		return {
			tools: [...agentTools, ...sessionTools].map((tool) => ({
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

		// Handle session management tools
		if (prefix === "Session") {
			return handleSessionTool(toolName, arguments_)
		}

		// Handle agent tools
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

async function handleSessionTool(
	toolName: string,
	arguments_: any,
): Promise<CallToolResult> {
	try {
		switch (toolName) {
			case "list": {
				const result = await listSessions(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result, null, 2),
						},
					],
				}
			}

			case "switch": {
				const result = await switchSession(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: `Successfully switched to session ${result.sessionId}`,
						},
					],
				}
			}

			case "create": {
				const result = await createSession(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result, null, 2),
						},
					],
				}
			}

			case "fork": {
				const result = await forkSession(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result, null, 2),
						},
					],
				}
			}

			case "rename": {
				const result = await renameSession(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: `Successfully renamed session ${result.sessionId}`,
						},
					],
				}
			}

			case "delete": {
				const result = await deleteSession(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: `Successfully deleted session ${result.sessionId}`,
						},
					],
				}
			}

			case "info": {
				const result = await getSessionInfo(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result, null, 2),
						},
					],
				}
			}

			case "undo": {
				const result = await undoMessage(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: `Successfully undid message in session ${result.sessionId}`,
						},
					],
				}
			}

			case "redo": {
				const result = await redoMessage(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: `Successfully redid message in session ${result.sessionId}`,
						},
					],
				}
			}

			case "compact": {
				const result = await compactSession(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: `Successfully compacted session ${result.sessionId}`,
						},
					],
				}
			}

			case "export": {
				const result = await exportSession(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: result.content,
						},
					],
				}
			}

			case "jump": {
				const result = await jumpToMessage(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: `Successfully jumped to message in session ${result.sessionId}`,
						},
					],
				}
			}

			case "duplicate": {
				const result = await duplicateSession(arguments_ ?? {})
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result, null, 2),
						},
					],
				}
			}

			default: {
				return {
					content: [
						{
							type: "text",
							text: `Unknown session tool: ${toolName}`,
						},
					],
					isError: true,
				}
			}
		}
	} catch (error) {
		return {
			content: [
				{
					type: "text",
					text: error instanceof Error ? error.message : "Unknown error",
				},
			],
			isError: true,
		}
	}
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

export default {
	createAcpServer,
	createRepl,
}
