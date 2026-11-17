import { afterEach, describe, expect, it } from "bun:test"
import { pluginActivationTimeoutMs } from "../src/location"

const VARIABLE = "OPENCODE_PLUGIN_ACTIVATION_TIMEOUT"
const original = process.env[VARIABLE]

afterEach(() => {
	if (original === undefined) delete process.env[VARIABLE]
	else process.env[VARIABLE] = original
})

describe("pluginActivationTimeoutMs", () => {
	it("defaults to five seconds when the variable is unset", () => {
		delete process.env[VARIABLE]
		expect(pluginActivationTimeoutMs()).toBe(5_000)
	})

	it.each([
		["30 seconds", 30_000],
		["10s", 10_000],
		["500ms", 500],
		["2 minutes", 120_000],
		["750", 750],
	] as const)("parses %p as milliseconds", (raw, expected) => {
		process.env[VARIABLE] = raw
		expect(pluginActivationTimeoutMs()).toBe(expected)
	})

	it.each([["soon"], ["0 seconds"], ["-5 seconds"], ["5 fortune cookies"]] as const)(
		"keeps the default for the unreadable value %p",
		(raw) => {
			process.env[VARIABLE] = raw
			expect(pluginActivationTimeoutMs()).toBe(5_000)
		},
	)
})