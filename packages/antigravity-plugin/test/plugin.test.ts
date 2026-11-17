import { describe, expect, test } from "bun:test"
import plugin, { GoogleAntigravityOAuth, GoogleAntigravityPlugin, GoogleAntigravityWire, ID } from "../src/index"
import { OauthCallbackPage } from "../src/page"

const nativeBody = {
  contents: [{ role: "user", parts: [{ text: "hello" }] }],
  systemInstruction: { parts: [{ text: "be brief" }] },
  tools: [
    {
      functionDeclarations: [
        {
          name: "read",
          description: "Read a file",
          parameters: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: {
              path: { type: "string", default: ".", const: "README.md" },
            },
            $defs: { unused: { type: "string" } },
            $ref: "#/$defs/unused",
          },
        },
      ],
    },
  ],
  generationConfig: { maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 1000 } },
}

describe("GoogleAntigravityPlugin package", () => {
  test("default export is the Effect plugin", () => {
    expect(plugin).toBe(GoogleAntigravityPlugin)
    expect(plugin.id).toBe(ID)
    expect(plugin.id).toBe("opencode.provider.google-antigravity")
    expect(typeof plugin.effect).toBe("function")
  })

  test("builds an official CLI user agent and authorize URL", () => {
    const pkce = GoogleAntigravityOAuth.pkce()
    const url = new URL(GoogleAntigravityOAuth.authorizeURL(pkce.challenge, "state-1"))
    expect(GoogleAntigravityOAuth.userAgent()).toMatch(
      /^antigravity\/cli\/1\.3\.6 \(aidev_client; os_type=(linux|darwin|windows); arch=(amd64|arm64); auth_method=consumer\)$/,
    )
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(url.searchParams.get("client_id")).toBe(GoogleAntigravityOAuth.clientID)
    expect(url.searchParams.get("redirect_uri")).toBe(GoogleAntigravityOAuth.redirectURI)
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(url.searchParams.get("prompt")).toBe("consent")
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...GoogleAntigravityOAuth.scopes])
  })

  test("keeps the current refresh token when Google omits a new one", () => {
    expect(GoogleAntigravityOAuth.nextRefresh("1//current", undefined)).toBe("1//current")
    expect(GoogleAntigravityOAuth.nextRefresh("1//current", "1//next")).toBe("1//next")
  })
})

describe("GoogleAntigravityWire", () => {
  test("wraps a native Gemini body in the Cloud Code envelope", () => {
    const wrapped = GoogleAntigravityWire.wrapGenerateRequest({
      body: nativeBody,
      projectId: "canvas-wallaby-dvmxc",
      model: "gemini-3.7-flash-low",
      sessionID: "ses_test",
      modelEnum: "MODEL_PLACEHOLDER_M300",
      now: 1_700_000_000_000,
      trajectory: "traj-1",
    }) as {
      project: string
      requestId: string
      model: string
      userAgent: string
      requestType: string
      request: {
        systemInstruction: { role: string }
        toolConfig: { functionCallingConfig: { mode: string } }
        tools: Array<{ functionDeclarations: Array<{ parameters: Record<string, unknown> }> }>
        labels: Record<string, string>
        generationConfig: { thinkingConfig: { includeThoughts: boolean; thinkingBudget: number } }
      }
    }
    expect(wrapped.project).toBe("canvas-wallaby-dvmxc")
    expect(wrapped.model).toBe("gemini-3.7-flash-low")
    expect(wrapped.userAgent).toBe("antigravity")
    expect(wrapped.requestType).toBe("agent")
    expect(wrapped.requestId).toBe("agent/ses_test/1700000000000/traj-1/2")
    expect(wrapped.request.systemInstruction.role).toBe("user")
    expect(wrapped.request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED")
    expect(wrapped.request.labels).toEqual({
      last_step_index: "1",
      model_enum: "MODEL_PLACEHOLDER_M300",
      request_id: "traj-1-0",
      trajectory_id: "traj-1",
      used_claude: "false",
      used_claude_conservative: "false",
      used_non_gemini_model: "false",
    })
    expect(wrapped.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 1000 })
    expect(wrapped.request.tools[0]?.functionDeclarations[0]?.parameters).toEqual({
      type: "object",
      properties: { path: { type: "string", enum: ["README.md"] } },
    })
  })

  test("maps the deprecated 3.1 Pro alias and never marks Claude usage", () => {
    const wrapped = GoogleAntigravityWire.wrapGenerateRequest({
      body: { contents: [] },
      projectId: "proj",
      model: "gemini-3.1-pro-high",
      sessionID: "ses_x",
      trajectory: "t",
      now: 1,
    }) as { model: string; request: { labels: Record<string, string> } }
    expect(wrapped.model).toBe("gemini-pro-agent")
    expect(wrapped.request.labels.used_claude).toBe("false")
    expect(wrapped.request.labels.used_non_gemini_model).toBe("false")
  })

  test("unwraps Cloud Code SSE response envelopes", () => {
    const native = { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] } }] }
    const text = `data: ${JSON.stringify({ response: native, traceId: "tr", metadata: {} })}\n\ndata: [DONE]\n`
    expect(GoogleAntigravityWire.unwrapSSEText(text)).toBe(`data: ${JSON.stringify(native)}\n\ndata: [DONE]\n`)
  })

  test("reads the keyed live catalog and preserves availability and enum overrides", async () => {
    const parsed = await GoogleAntigravityOAuth.fetchAvailableModels("fixture", "project", async (_url, init) => {
      expect(new Headers(init?.headers).get("user-agent")).toBe(GoogleAntigravityOAuth.userAgent())
      return Response.json({
        models: {
          "gemini-4-argon-high": {
            displayName: "Gemini 4 Argon (High)",
            model: "MODEL_ARGON_CURRENT",
            modelProvider: "MODEL_PROVIDER_GOOGLE",
            recommended: true,
          },
          "gemini-4-argon-disabled": { model: "MODEL_PLACEHOLDER_M421", disabled: true },
          chat_internal: { isInternal: true },
          invalid: null,
        },
      })
    })
    expect(parsed.map((model) => model.id)).toEqual(["gemini-4-argon-high", "gemini-4-argon-disabled", "chat_internal"])
    expect(GoogleAntigravityWire.filterGoogleModels(parsed)).toMatchObject([
      { id: "gemini-4-argon-high", name: "Gemini 4 Argon (High)", recommended: true },
    ])
    expect(
      GoogleAntigravityWire.modelEnumsFrom(parsed.filter((model) => !model.disabled)).get("gemini-4-argon-high"),
    ).toBe("MODEL_ARGON_CURRENT")
    expect([...GoogleAntigravityWire.disabledModelsFrom(parsed)]).toContain("gemini-4-argon-high")
  })

  test("filters Claude, GPT, tab, image, and disabled models out of the Cloud Code catalog", () => {
    const parsed = GoogleAntigravityOAuth.parseCatalogModels({
      models: [
        {
          id: "gemini-4-argon-high",
          displayName: "Gemini 4 Argon (High)",
          model: "MODEL_PLACEHOLDER_M417",
          modelProvider: "MODEL_PROVIDER_GOOGLE",
          recommended: true,
        },
        {
          id: "gemini-4-argon-medium",
          displayName: "Gemini 4 Argon (Medium)",
          model: "MODEL_PLACEHOLDER_M418",
          modelProvider: "MODEL_PROVIDER_GOOGLE",
          recommended: true,
        },
        {
          id: "gemini-4-argon-low",
          displayName: "Gemini 4 Argon (Low)",
          model: "MODEL_PLACEHOLDER_M419",
          modelProvider: "MODEL_PROVIDER_GOOGLE",
          recommended: true,
        },
        {
          id: "gemini-4-argon-disabled",
          displayName: "Gemini 4 Argon",
          model: "MODEL_PLACEHOLDER_M421",
          modelProvider: "MODEL_PROVIDER_GOOGLE",
          disabled: true,
          recommended: true,
        },
        { id: "gemini-3.8-flash-high", modelProvider: "MODEL_PROVIDER_GOOGLE", recommended: true },
        { id: "gemini-3.8-flash-medium", modelProvider: "MODEL_PROVIDER_GOOGLE", recommended: true },
        { id: "gemini-3.8-flash-low", modelProvider: "MODEL_PROVIDER_GOOGLE", recommended: true },
        { id: "gemini-3.7-flash-high", modelProvider: "MODEL_PROVIDER_GOOGLE", recommended: true },
        { id: "claude-sonnet-4-6", modelProvider: "MODEL_PROVIDER_ANTHROPIC", recommended: true },
        { id: "gpt-oss-120b-medium", modelProvider: "MODEL_PROVIDER_OPENAI", recommended: true },
        { id: "tab_flash_lite_preview", modelProvider: "MODEL_PROVIDER_GOOGLE" },
        { id: "gemini-3.1-flash-image", modelProvider: "MODEL_PROVIDER_GOOGLE" },
        { id: "chat_20706", modelProvider: "MODEL_PROVIDER_GOOGLE", isInternal: true },
      ],
    })
    const filtered = GoogleAntigravityWire.filterGoogleModels(parsed)
    expect(filtered.map((model) => model.id)).toEqual([
      "gemini-4-argon-high",
      "gemini-4-argon-medium",
      "gemini-4-argon-low",
      "gemini-3.8-flash-high",
      "gemini-3.8-flash-medium",
      "gemini-3.8-flash-low",
      "gemini-3.7-flash-high",
    ])
    expect(GoogleAntigravityWire.isBlockedModelID("gemini-4-argon-disabled")).toBe(true)
    const disabled = GoogleAntigravityWire.disabledModelsFrom(parsed)
    expect(disabled.has("gemini-4-argon-high")).toBe(true)
    expect(disabled.has("gemini-4-argon-medium")).toBe(true)
    expect(disabled.has("gemini-4-argon-low")).toBe(true)
    expect(disabled.has("gemini-3.8-flash-high")).toBe(false)
    const enums = GoogleAntigravityWire.modelEnumsFrom(parsed)
    expect(enums.has("gemini-4-argon-high")).toBe(false)
    expect(enums.has("gemini-4-argon-medium")).toBe(false)
    expect(enums.has("gemini-4-argon-low")).toBe(false)
    expect(enums.get("gemini-3.8-flash-high")).toBe("MODEL_PLACEHOLDER_M318")
  })

  test("suppresses every shipped Carbon and Hydrogen variant from their disabled catalog entries", () => {
    const disabled = GoogleAntigravityWire.disabledModelsFrom([
      {
        id: "gemini-4-carbon-disabled",
        modelEnum: "MODEL_PLACEHOLDER_M670",
        provider: "MODEL_PROVIDER_GOOGLE",
        disabled: true,
      },
      {
        id: "gemini-4-hydrogen-disabled",
        modelEnum: "MODEL_PLACEHOLDER_M529",
        provider: "MODEL_PROVIDER_GOOGLE",
        disabled: true,
      },
    ])
    const gemini4 = GoogleAntigravityWire.shippedModels
      .map((model) => model.id)
      .filter((id) => id.startsWith("gemini-4-carbon-") || id.startsWith("gemini-4-hydrogen-"))
    expect(gemini4).toHaveLength(7)
    expect(gemini4.filter((id) => !disabled.has(id))).toEqual([])
    expect(disabled.has("gemini-4-argon-high")).toBe(false)
  })

  test("ships the Gemini 4 and gemini-3.8-flash variants with authoritative enums and forwards IDs unchanged", () => {
    const ids = GoogleAntigravityWire.shippedModels.map((model) => model.id)
    expect(ids).not.toContain("gemini-4-argon")
    expect(ids).not.toContain("gemini-4-carbon")
    expect(ids).not.toContain("gemini-4-hydrogen")
    expect(
      Object.fromEntries(
        ["carbon", "hydrogen"].flatMap((family) =>
          ids
            .filter((id) => id.startsWith(`gemini-4-${family}-`))
            .map((id) => [id, GoogleAntigravityWire.modelEnumDefaults.get(id)]),
        ),
      ),
    ).toEqual({
      "gemini-4-carbon-high": "MODEL_PLACEHOLDER_M427",
      "gemini-4-carbon-medium": "MODEL_PLACEHOLDER_M437",
      "gemini-4-carbon-low": "MODEL_PLACEHOLDER_M438",
      "gemini-4-hydrogen-xhigh": "MODEL_PLACEHOLDER_M528",
      "gemini-4-hydrogen-high": "MODEL_PLACEHOLDER_M525",
      "gemini-4-hydrogen-medium": "MODEL_PLACEHOLDER_M526",
      "gemini-4-hydrogen-low": "MODEL_PLACEHOLDER_M527",
    })
    expect(ids).not.toContain("gemini-3.8-flash")
    expect(GoogleAntigravityWire.modelEnumDefaults.get("gemini-4-argon-high")).toBe("MODEL_PLACEHOLDER_M417")
    expect(GoogleAntigravityWire.modelEnumDefaults.get("gemini-4-argon-medium")).toBe("MODEL_PLACEHOLDER_M418")
    expect(GoogleAntigravityWire.modelEnumDefaults.get("gemini-4-argon-low")).toBe("MODEL_PLACEHOLDER_M419")
    expect(GoogleAntigravityWire.modelEnumDefaults.get("gemini-3.8-flash-high")).toBe("MODEL_PLACEHOLDER_M318")
    expect(GoogleAntigravityWire.modelEnumDefaults.get("gemini-3.8-flash-medium")).toBe("MODEL_PLACEHOLDER_M319")
    expect(GoogleAntigravityWire.modelEnumDefaults.get("gemini-3.8-flash-low")).toBe("MODEL_PLACEHOLDER_M320")
    for (const [model, level] of [
      ["gemini-4-argon-high", "high"],
      ["gemini-4-argon-medium", "medium"],
      ["gemini-4-argon-low", "low"],
      ["gemini-3.8-flash-high", "high"],
      ["gemini-3.8-flash-medium", "medium"],
      ["gemini-3.8-flash-low", "low"],
    ] as const) {
      expect(ids).toContain(model)
      const wrapped = GoogleAntigravityWire.wrapGenerateRequest({
        body: {
          ...nativeBody,
          generationConfig: { maxOutputTokens: 65536, thinkingConfig: { thinkingLevel: level } },
        },
        projectId: "canvas-wallaby-dvmxc",
        model,
        sessionID: "ses_test",
        modelEnum: GoogleAntigravityWire.modelEnumDefaults.get(model),
        now: 1_700_000_000_000,
        trajectory: "traj-argon",
      }) as {
        model: string
        project: string
        request: {
          labels: Record<string, string>
          generationConfig: { thinkingConfig: { includeThoughts: boolean; thinkingLevel: string } }
        }
      }
      expect(wrapped.model).toBe(model)
      expect(wrapped.project).toBe("canvas-wallaby-dvmxc")
      expect(wrapped.request.labels.model_enum).toBe(GoogleAntigravityWire.modelEnumDefaults.get(model)!)
      expect(wrapped.request.generationConfig.thinkingConfig).toEqual({
        includeThoughts: true,
        thinkingLevel: level,
      })
    }
  })
})

describe("OAuth callback HTML", () => {
  test("vendors success and error pages without Core oauth/page", () => {
    const ok = OauthCallbackPage.success({ provider: "Google AI Pro" })
    const fail = OauthCallbackPage.error("denied", { provider: "Google AI Pro" })
    expect(ok).toContain("Authorization successful")
    expect(ok).toContain("Google AI Pro")
    expect(fail).toContain("Authorization failed")
    expect(fail).toContain("denied")
  })
})
