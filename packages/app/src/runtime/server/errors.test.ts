import { describe, expect, test } from "bun:test"
import type {
  FileNotFoundError,
  LocationNotFoundError,
  LocationPermissionDeniedError,
  SessionNotFoundError,
} from "@opencode/client/promise"
import type { ConfigInvalidError, ProviderModelNotFoundError } from "./errors"
import {
  formatProjectLocationError,
  formatServerError,
  isSessionNotFoundError,
  parseReadableConfigInvalidError,
  projectLocationError,
} from "./errors"

function fill(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text
  return text.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => {
    const value = vars[key]
    if (value === undefined) return ""
    return String(value)
  })
}

function useLanguageMock() {
  const dict: Record<string, string> = {
    "error.chain.unknown": "Erro desconhecido",
    "error.chain.configInvalid": "Arquivo de config em {{path}} invalido",
    "error.chain.configInvalidWithMessage": "Arquivo de config em {{path}} invalido: {{message}}",
    "error.chain.modelNotFound": "Modelo nao encontrado: {{provider}}/{{model}}",
    "error.chain.didYouMean": "Voce quis dizer: {{suggestions}}",
    "error.chain.checkConfig": "Revise provider/model no config",
  }
  return {
    t(key: string, vars?: Record<string, string | number>) {
      const text = dict[key]
      if (!text) return key
      return fill(text, vars)
    },
  }
}

const language = useLanguageMock()

describe("parseReadableConfigInvalidError", () => {
  test("formats issues with file path", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "opencode.config.ts",
        issues: [
          { path: ["settings", "host"], message: "Required" },
          { path: ["mode"], message: "Invalid" },
        ],
      },
    } satisfies ConfigInvalidError

    const result = parseReadableConfigInvalidError(error, language.t)

    expect(result).toBe(
      ["Arquivo de config em opencode.config.ts invalido: settings.host: Required", "mode: Invalid"].join("\n"),
    )
  })
})

describe("formatServerError", () => {
  test("explains missing and denied project folders without misclassifying other failures", () => {
    const missing = {
      _tag: "LocationNotFoundError",
      location: { directory: "C:\\Users\\Test User\\Projects\\moved-project" },
      message: "Location not found",
    } satisfies LocationNotFoundError
    const denied = {
      _tag: "LocationPermissionDeniedError",
      location: { directory: "/Users/example/Documents/private-project" },
      message: "Location access denied",
    } satisfies LocationPermissionDeniedError
    for (const error of [missing, new Error("Request failed", { cause: { body: missing, status: 404 } })]) {
      expect(projectLocationError(error)).toEqual({ type: "missing", directory: missing.location.directory })
      expect(formatServerError(error)).toContain(`${missing.location.directory} was moved`)
    }
    const info = projectLocationError(new Error("Request failed", { cause: { body: denied, status: 403 } }))
    expect(info).toEqual({ type: "denied", directory: denied.location.directory })
    expect(formatServerError(denied)).toContain(`permission to open ${denied.location.directory}`)
    expect(formatServerError(denied)).not.toContain("Privacy & Security")
    if (info) expect(formatProjectLocationError(info, undefined, true)).toContain("Privacy & Security")
    expect(
      projectLocationError({ _tag: "FileNotFoundError", path: "file.txt", message: "File not found" }),
    ).toBeUndefined()
    expect(projectLocationError(new Error("HTTP 500"))).toBeUndefined()
  })

  test.each([
    {
      name: "trimmed config message without issues",
      error: {
        name: "ConfigInvalidError",
        data: { path: "config", message: "  Bad value  " },
      } satisfies ConfigInvalidError,
      expected: "Arquivo de config em config invalido: Bad value",
    },
    {
      name: "config invalid error without a path",
      error: { name: "ConfigInvalidError", data: { message: "Missing host" } } satisfies ConfigInvalidError,
      expected: "Arquivo de config em config invalido: Missing host",
    },
    {
      name: "error message",
      error: new Error("Request failed with status 503"),
      expected: "Request failed with status 503",
    },
    {
      name: "typed server error message",
      error: {
        _tag: "FileNotFoundError",
        path: "deleted.txt",
        message: "File not found: deleted.txt",
      } satisfies FileNotFoundError,
      expected: "File not found: deleted.txt",
    },
    { name: "string error", error: "Failed to connect to server", expected: "Failed to connect to server" },
    { name: "unknown value", error: 0, expected: "Erro desconhecido" },
    {
      name: "unknown error object",
      error: { name: "ServerTimeoutError", data: { seconds: 30 } },
      expected: "Erro desconhecido",
    },
    {
      name: "provider model error",
      error: {
        name: "ProviderModelNotFoundError",
        data: { providerID: "openai", modelID: "gpt-4.1" },
      } satisfies ProviderModelNotFoundError,
      expected: ["Modelo nao encontrado: openai/gpt-4.1", "Revise provider/model no config"].join("\n"),
    },
    {
      name: "provider model error with suggestions",
      error: {
        name: "ProviderModelNotFoundError",
        data: { providerID: "x", modelID: "y", suggestions: ["x/y2", "x/y3"] },
      } satisfies ProviderModelNotFoundError,
      expected: ["Modelo nao encontrado: x/y", "Voce quis dizer: x/y2, x/y3", "Revise provider/model no config"].join(
        "\n",
      ),
    },
    {
      name: "SDK-wrapped error from cause.body",
      error: new Error("ConfigInvalidError", {
        cause: { body: { name: "ConfigInvalidError", data: { message: "Missing host" } }, status: 400 },
      }),
      expected: "Arquivo de config em config invalido: Missing host",
    },
  ])("formats a $name", ({ error, expected }) => {
    expect(formatServerError(error, language.t)).toBe(expected)
  })
})

describe("isSessionNotFoundError", () => {
  const body = {
    _tag: "SessionNotFoundError",
    sessionID: "ses_missing",
    message: "Session not found",
  } satisfies SessionNotFoundError

  test("matches an SDK-wrapped or direct structured error for the requested session", () => {
    expect(isSessionNotFoundError(new Error(body.message, { cause: { body, status: 404 } }), body.sessionID)).toBe(true)
    expect(isSessionNotFoundError(new Error("Unknown error", { cause: body }), body.sessionID)).toBe(true)
  })

  test("rejects errors for other sessions and other 404 responses", () => {
    expect(isSessionNotFoundError(new Error(body.message, { cause: { body, status: 404 } }), "ses_tab")).toBe(false)
    expect(
      isSessionNotFoundError(
        new Error("Provider not found", {
          cause: { body: { _tag: "ProviderNotFoundError", providerID: "missing" }, status: 404 },
        }),
        "ses_tab",
      ),
    ).toBe(false)
  })
})
