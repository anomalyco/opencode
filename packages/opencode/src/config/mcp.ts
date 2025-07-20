import { Log } from "../util/log";
import path from "path";
import { z } from "zod";
import { Global } from "../global";
import { mergeDeep } from "remeda";
import { NamedError } from "../util/error";
import os from "os";

export namespace McpConfig {
	const log = Log.create({ service: "mcp-config" });

	// Typed MCP servers with explicit transport type
	const McpServerTyped = z.discriminatedUnion("type", [
		z
			.object({
				type: z.literal("stdio").describe("Server transport type"),
				command: z
					.string()
					.or(z.array(z.string()))
					.describe("Command to run the MCP server"),
				args: z
					.array(z.string())
					.optional()
					.describe("Arguments for the command"),
				env: z
					.record(z.string(), z.string())
					.optional()
					.describe("Environment variables"),
				disabled: z
					.boolean()
					.optional()
					.describe("Whether the server is disabled"),
			})
			.strict(),
		z
			.object({
				type: z.literal("sse").describe("Server transport type"),
				url: z.string().describe("URL of the SSE MCP server"),
				headers: z
					.record(z.string(), z.string())
					.optional()
					.describe("HTTP headers for authentication"),
				disabled: z
					.boolean()
					.optional()
					.describe("Whether the server is disabled"),
			})
			.strict(),
		z
			.object({
				type: z.literal("http").describe("Server transport type"),
				url: z.string().describe("URL of the HTTP MCP server"),
				headers: z
					.record(z.string(), z.string())
					.optional()
					.describe("HTTP headers for authentication"),
				disabled: z
					.boolean()
					.optional()
					.describe("Whether the server is disabled"),
			})
			.strict(),
	]);

	// Legacy MCP servers without explicit type (for backward compatibility)
	const McpServerLegacy = z
		.object({
			command: z
				.string()
				.or(z.array(z.string()))
				.optional()
				.describe("Command to run the MCP server"),
			args: z
				.array(z.string())
				.optional()
				.describe("Arguments for the command"),
			env: z
				.record(z.string(), z.string())
				.optional()
				.describe("Environment variables"),
			url: z.string().optional().describe("URL of the remote MCP server"),
			disabled: z
				.boolean()
				.optional()
				.describe("Whether the server is disabled"),
		})
		.strict()
		.refine(
			(data) => (data.command && !data.url) || (!data.command && data.url),
			{
				message:
					"Legacy servers must have either 'command' (for stdio) or 'url' (for remote)",
			},
		);

	const McpServer = z.union([McpServerTyped, McpServerLegacy]);

	const McpServers = z
		.record(z.string(), McpServer)
		.describe("MCP server configurations");

	export const Schema = z
		.object({
			mcpServers: McpServers.optional().describe("MCP server configurations"),
		})
		.strict();

	export type Config = z.infer<typeof Schema>;
	export type Server = z.infer<typeof McpServer>;
	export type TypedServer = z.infer<typeof McpServerTyped>;
	export type LegacyServer = z.infer<typeof McpServerLegacy>;

	export const JsonError = NamedError.create(
		"McpConfigJsonError",
		z.object({
			path: z.string(),
		}),
	);

	export const InvalidError = NamedError.create(
		"McpConfigInvalidError",
		z.object({
			path: z.string(),
			issues: z.custom<z.ZodIssue[]>().optional(),
		}),
	);

	async function expandVariables(
		text: string,
		configDir: string,
	): Promise<string> {
		// Handle ${VAR} and ${VAR:-default} syntax
		let result = text.replace(/\$\{([^}]+)\}/g, (_, content) => {
			if (content.includes(":-")) {
				const [varName, defaultValue] = content.split(":-", 2);
				return process.env[varName] ?? defaultValue;
			}
			return process.env[content] ?? "";
		});

		// Handle legacy {env:VAR} syntax for backward compatibility
		result = result.replace(/\{env:([^}]+)\}/g, (_, varName) => {
			return process.env[varName] || "";
		});

		// Handle {file:path} syntax
		const fileMatches = result.match(/"?\{file:([^}]+)\}"?/g);
		if (fileMatches) {
			for (const match of fileMatches) {
				const filePath = match.replace(/^"?\{file:/, "").replace(/\}"?$/, "");
				const resolvedPath = path.isAbsolute(filePath)
					? filePath
					: path.resolve(configDir, filePath);
				const fileContent = await Bun.file(resolvedPath).text();
				result = result.replace(match, JSON.stringify(fileContent));
			}
		}

		// Handle tilde expansion
		result = result.replace(/~\//g, path.join(os.homedir(), "/"));

		return result;
	}

	async function load(configPath: string): Promise<Config> {
		let text = await Bun.file(configPath)
			.text()
			.catch((err) => {
				if (err.code === "ENOENT") return "";
				throw new JsonError({ path: configPath }, { cause: err });
			});

		if (!text) return {};

		text = await expandVariables(text, path.dirname(configPath));

		let data: any;
		try {
			data = JSON.parse(text);
		} catch (err) {
			throw new JsonError({ path: configPath }, { cause: err as Error });
		}

		const parsed = Schema.safeParse(data);
		if (parsed.success) {
			return parsed.data;
		}
		throw new InvalidError({ path: configPath, issues: parsed.error.issues });
	}

	export async function loadLocal(projectRoot?: string): Promise<Config> {
		let result: Config = {};

		const globalConfigPath = path.join(Global.Path.config, "mcp.json");
		log.info("loading global config", { path: globalConfigPath });
		result = mergeDeep(result, await load(globalConfigPath));

		if (projectRoot) {
			const localConfigPath = path.join(projectRoot, ".mcp.json");
			log.info("loading local config", { path: localConfigPath });
			result = mergeDeep(result, await load(localConfigPath));
		}

		log.info("loaded mcp config", result);
		return result;
	}

	export function convertToOpencodeFormat(config: Config): Record<string, any> {
		if (!config.mcpServers) return {};

		const converted: Record<string, any> = {};

		for (const [name, server] of Object.entries(config.mcpServers)) {
			const baseConfig = {
				enabled: !server.disabled,
			};

			if ("type" in server) {
				switch (server.type) {
					case "sse":
					case "http":
						converted[name] = {
							...baseConfig,
							type: "remote" as const,
							url: server.url,
							headers: server.headers,
						};
						break;
					case "stdio":
						const command =
							typeof server.command === "string"
								? [server.command]
								: server.command;
						const args = server.args || [];
						converted[name] = {
							...baseConfig,
							type: "local" as const,
							command: [...command, ...args],
							environment: server.env || {},
						};
						break;
				}
			} else {
				// Legacy format without explicit type - assume stdio/local
				if ("url" in server) {
					// Has URL but no type - assume remote
					converted[name] = {
						...baseConfig,
						type: "remote" as const,
						url: server.url,
					};
				} else {
					// Has command - assume local
					const command =
						typeof server.command === "string"
							? [server.command]
							: server.command;
					const args = server.args || [];
					converted[name] = {
						...baseConfig,
						type: "local" as const,
						command: [...command, ...args],
						environment: server.env || {},
					};
				}
			}
		}

		return converted;
	}
}
