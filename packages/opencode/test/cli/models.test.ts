import { describe, expect, mock, test } from "bun:test"

let bootstrapCalls = 0
let pluginConfigApplied = false

mock.module("../../src/cli/bootstrap", () => ({
	bootstrap: async (_directory: string, cb: () => Promise<unknown>) => {
		bootstrapCalls += 1
		pluginConfigApplied = true
		return cb()
	},
}))

mock.module("../../src/provider/provider", () => ({
	Provider: {
		list: async () => {
			const providers: Record<string, { models: Record<string, unknown> }> = {
				openai: {
					models: {
						"gpt-5": {},
					},
				},
			}

			if (pluginConfigApplied) {
				providers["cliproxy-test"] = {
					models: {
						"proxy-model": {},
					},
				}
			}

			return providers
		},
	},
}))

const { ModelsCommand } = await import("../../src/cli/cmd/models")

describe("models command", () => {
	test("includes providers added via plugin config hooks", async () => {
		bootstrapCalls = 0
		pluginConfigApplied = false

		const output: string[] = []
		const originalWrite = process.stdout.write.bind(process.stdout)
		process.stdout.write = ((chunk: string | Uint8Array) => {
			output.push(typeof chunk === "string" ? chunk : chunk.toString())
			return true
		}) as typeof process.stdout.write

		try {
			await ModelsCommand.handler({
				refresh: false,
				verbose: false,
			} as any)
		} finally {
			process.stdout.write = originalWrite as typeof process.stdout.write
		}

		expect(bootstrapCalls).toBe(1)
		expect(output.join("")).toContain("cliproxy-test/proxy-model")
	})
})
