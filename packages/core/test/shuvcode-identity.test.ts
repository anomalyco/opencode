import { describe, expect } from "bun:test"
import { SystemPart } from "@opencode/ai/effect"
import { Agent } from "@opencode/core/agent"
import { App } from "@opencode/core/app"
import { AutomationCode } from "@opencode/core/automation/code"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Generate } from "@opencode/core/generate"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginInternal } from "@opencode/core/plugin/internal"
import { OptimizePlugin } from "@opencode/core/plugin/optimize"
import { SkillPlugin } from "@opencode/core/plugin/skill"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionSystemPrompt } from "@opencode/core/session/system-prompt"
import { Skill } from "@opencode/core/skill"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Model } from "@opencode/schema/model"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { Effect, Layer } from "effect"
import PROMPT_AUTOMATION from "../src/plugin/command/automation.txt"
import PROMPT_INITIALIZE from "../src/plugin/command/initialize.txt"
import PROMPT_REVIEW from "../src/plugin/command/review.txt"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { emptyMcpLayer } from "./fixture/mcp"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { codeModeListings } from "./lib/tool"

const expectedShuvcodeTools = [
  "session_rename",
  "session_move",
  "worktree_create",
  "worktree_list",
  "worktree_remove",
  "models",
  "automation_create",
  "automation_list",
  "automation_pause",
  "automation_resume",
  "automation_delete",
  "artifact_create",
  "artifact_read",
  "artifact_update",
  "artifact_delete",
  "list_mcp_resources",
  "read_mcp_resource",
  "watch_mcp_event",
] as const

const expectedMcpPermissions = {
  shuvcode_list_mcp_resources: "opencode_list_mcp_resources",
  shuvcode_read_mcp_resource: "opencode_read_mcp_resource",
  shuvcode_watch_mcp_event: "opencode_watch_mcp_event",
} as const

const forbiddenAutomationTools = [
  "shuvcode.automation_create",
  "shuvcode.automation_pause",
  "shuvcode.automation_resume",
  "shuvcode.automation_delete",
  "shuvcode.session_move",
  "shuvcode.session_rename",
  "shuvcode.worktree_create",
  "shuvcode.worktree_remove",
] as const

const allowedOpencodeSubstrings = [
  "https://opencode.ai",
  "@opencode/",
  "opencode.jsonc",
  "opencode.json",
  ".opencode",
  "opencode.db",
  "opencode.log",
  "OPENCODE_CLI_CONFIG_CONTENT",
  "OPENCODE_LOG_LEVEL",
  "services/site/",
  "fork of OpenCode",
  "OpenCode V1",
  "OpenCode V2",
  "OpenCode SDK",
] as const

const configEntries = [
  new Document({
    type: "document",
    info: new Info({
      experimental: new ConfigExperimental.Info({
        automations: true,
        artifacts: true,
        mcp_events: true,
      }),
    }),
  }),
]

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: "", name }),
    resolve: (name) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: "", name }),
    which: () => Effect.undefined,
  }),
)

const generateLayer = Layer.succeed(
  Generate.Service,
  Generate.Service.of({
    text: () => Effect.succeed(""),
    image: () => Effect.die("unused"),
    decisions: () => Effect.die("unused"),
    video: {
      start: () => Effect.die("unused"),
      status: () => Effect.die("unused"),
      result: () => Effect.die("unused"),
    },
  }),
)

const appConfig = { name: "shuvcode", version: "1.2.3", channel: "beta" } as const

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Plugin.node, PluginHost.requirements, PluginInternal.requirements, McpTool.node]),
    [
      App.node.replace(App.configured(appConfig)),
      Config.node.replace(Config.testLayer(configEntries)),
      Flag.node.replace(
        Flag.testLayer(configEntries, { app: appConfig, overrides: "automations,artifacts,mcp_events" }),
      ),
      Global.node.replace(tempGlobalLayer),
      Location.node.replace(tempLocationLayer),
      Image.node.replace(imagePassthrough),
      Mcp.node.replace(emptyMcpLayer),
      McpTool.node.replace(Layer.mock(McpTool.Service, { flush: Effect.void })),
      Generate.node.replace(generateLayer),
      Npm.node.replace(npmLayer),
      Permission.node.replace(permissionLayer()),
      offlineModels,
    ],
  ),
)

function stripAllowed(text: string) {
  return allowedOpencodeSubstrings.reduce((current, allowed) => current.replaceAll(allowed, ""), text)
}

function assertCleanIdentityText(label: string, text: string) {
  expect(text, `${label} still has unrendered OPENCODE_TOOL_GUIDANCE`).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
  expect(text, `${label} still mentions tools.opencode`).not.toContain("tools.opencode")
  expect(text, `${label} still mentions namespace: "opencode"`).not.toContain('namespace: "opencode"')
  expect(stripAllowed(text), `${label} has stray opencode reference`).not.toMatch(/opencode/i)
}

describe("shuvcode fork identity", () => {
  it.effect("registers built-in tools under shuvcode namespace and preserves MCP permissions", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const toolService = yield* Tool.Service
      const hooks = yield* PluginHooks.Service
      const sessions = yield* Session.Service
      const location = yield* Location.Service
      const internal = yield* PluginInternal.list()
      yield* plugins.activate([...internal.pre, ...internal.post])

      const registered = yield* toolService.list()
      expect(registered.filter((tool) => tool.options?.namespace === "opencode")).toEqual([])

      const shuvcodeTools = registered.filter((tool) => tool.options?.namespace === "shuvcode")
      expect(shuvcodeTools.map((tool) => tool.name).toSorted()).toEqual([...expectedShuvcodeTools].toSorted())

      for (const [toolID, expectedPermission] of Object.entries(expectedMcpPermissions)) {
        const tool = registered.find((item) => item.id === toolID)
        expect(tool).toBeDefined()
        expect(tool?.options?.permission).toBe(expectedPermission)
      }

      const snapshot = yield* toolService.snapshot()
      expect(snapshot.codeModeCatalog).toBeDefined()
      const summary = CodeModeCatalog.summarize(snapshot.codeModeCatalog!, { budget: Infinity })
      const namespaceNames = summary.namespaces.map((namespace) => namespace.name)
      expect(namespaceNames).not.toContain("opencode")
      expect(namespaceNames).toContain("shuvcode")
      const catalogPaths = codeModeListings(snapshot.codeModeCatalog!).map((entry) => entry.path)
      expect(catalogPaths).toEqual(expect.arrayContaining(expectedShuvcodeTools.map((name) => `shuvcode.${name}`)))

      const session = yield* sessions.create({
        location: Location.Ref.make({ directory: location.directory }),
      })
      const event: SessionHooks["context"] = {
        sessionID: session.id,
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("gpt-5") }),
        system: [SystemPart.make(SessionSystemPrompt.make(["shell", "write", "edit"]))],
        messages: [],
        tools: {},
        options: {},
      }
      yield* hooks.trigger("session", "context", event)
      const combinedSystem = event.system.map((part) => part.text).join("\n")
      expect(combinedSystem).toContain("tools.shuvcode.session_move")
      expect(combinedSystem).not.toContain("tools.opencode")
    }),
  )

  it.effect("forbids all shuvcode state-mutating tools inside automations", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const location = yield* Location.Service
      const session = yield* sessions.create({
        location: Location.Ref.make({ directory: location.directory }),
      })
      for (const toolPath of forbiddenAutomationTools) {
        const failure = yield* Effect.flip(
          AutomationCode.authorize(
            session,
            `guard-${toolPath}`,
            { type: "every", every: "1 hour" },
            { type: "code", code: `await tools.${toolPath}({})` },
          ),
        )
        expect(failure).toBe(`Tool ${toolPath} cannot be used inside an automation`)
      }
    }),
  )

  it.effect("uses Shuvcode identity across system prompts, commands, and built-in skills", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const catalog = yield* Provider.Service
      const hooks = yield* PluginHooks.Service
      const plugins = yield* Plugin.Service
      const skills = yield* Skill.Service

      yield* agents.transform((editor) => editor.update(Agent.ID.make("build"), () => {}))
      yield* catalog.transform((editor) => {
        editor.models.update(Provider.ID.make("test"), Model.ID.make("meta/muse-spark-1.1"), (model) => {
          model.name = "Muse Spark"
        })
      })

      const pluginHost = yield* PluginHost.make(plugins, "test")
      yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), { discard: true })
      yield* SkillPlugin.Plugin.effect(pluginHost)

      const basePrompt = SessionSystemPrompt.make(["shell", "write", "edit"])
      expect(basePrompt).toContain("Shuvcode")
      assertCleanIdentityText("SessionSystemPrompt.make", basePrompt)

      const models = ["gpt-5", "gpt-6-astra", "claude-sonnet-4", "kimi-k2", "trinity", "meta/muse-spark-1.1"] as const
      for (const modelID of models) {
        const event: SessionHooks["context"] = {
          sessionID: Session.ID.make(`ses_prompt_${modelID}`),
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make(modelID) }),
          system: [SystemPart.make(basePrompt)],
          messages: [],
          tools: {
            shell: { description: "shell", input: { type: "object" } },
            write: { description: "write", input: { type: "object" } },
            edit: { description: "edit", input: { type: "object" } },
          },
          options: {},
        }
        yield* hooks.trigger("session", "context", event)
        const rendered = event.system.map((part) => part.text).join("\n")
        expect(rendered, `OptimizePlugin(${modelID})`).toContain(modelID === "trinity" ? "shuvcode" : "Shuvcode")
        assertCleanIdentityText(`OptimizePlugin(${modelID})`, rendered)
      }

      const commands = [
        ["command/automation.txt", PROMPT_AUTOMATION],
        ["command/initialize.txt", PROMPT_INITIALIZE],
        ["command/review.txt", PROMPT_REVIEW],
      ] as const
      for (const [label, template] of commands) {
        assertCleanIdentityText(label, template)
      }

      const registeredSkills = yield* skills.list()
      expect(registeredSkills.find((item) => item.id === "opencode")).toBeUndefined()

      const shuvcodeSkill = registeredSkills.find((item) => item.id === "shuvcode")
      expect(shuvcodeSkill).toBeDefined()
      expect(shuvcodeSkill?.name).toBe(Skill.Name.make("Shuvcode"))
      expect(shuvcodeSkill?.path).toBe(AbsolutePath.make("skill://shuvcode/SKILL.md"))
      expect(shuvcodeSkill?.description).toBeDefined()
      assertCleanIdentityText("skill:shuvcode:description", shuvcodeSkill!.description!)
      assertCleanIdentityText("skill:shuvcode:content", shuvcodeSkill!.content)

      const reportSkill = registeredSkills.find((item) => item.id === "report")
      expect(reportSkill).toBeDefined()
      expect(reportSkill?.description).toBeDefined()
      expect(reportSkill?.content).toContain("--repo shuv1337/shuvcode")
      expect(reportSkill?.content).toContain("shuvcode --version")
      assertCleanIdentityText("skill:report:description", reportSkill!.description!)
      assertCleanIdentityText("skill:report:content", reportSkill!.content)
    }),
  )
})
