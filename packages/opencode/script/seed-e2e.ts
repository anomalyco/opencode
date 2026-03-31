const dir = process.env.OPENCODE_E2E_PROJECT_DIR ?? process.cwd()
const title = process.env.OPENCODE_E2E_SESSION_TITLE ?? "E2E Session"
const text = process.env.OPENCODE_E2E_MESSAGE ?? "Seeded for UI e2e"
const model = process.env.OPENCODE_E2E_MODEL ?? "opencode/gpt-5-nano"
const requirePaid = process.env.OPENCODE_E2E_REQUIRE_PAID === "true"
const parts = model.split("/")
const providerID = parts[0] ?? "opencode"
const modelID = parts[1] ?? "gpt-5-nano"
const now = Date.now()

const seed = async () => {
  const { Instance } = await import("../src/project/instance")
  const { InstanceBootstrap } = await import("../src/project/bootstrap")
  const { Config } = await import("../src/config/config")
  const { Provider } = await import("../src/provider/provider")
  const { Session } = await import("../src/session")
  const { MessageID, PartID } = await import("../src/session/schema")
  const { Project } = await import("../src/project/project")
  const { ModelID, ProviderID } = await import("../src/provider/schema")
  const { ToolRegistry } = await import("../src/tool/registry")

  try {
    await Instance.provide({
      directory: dir,
      init: InstanceBootstrap,
      fn: async () => {
        await Config.waitForDependencies()
        await ToolRegistry.ids()

        if (requirePaid && providerID === "opencode" && !process.env.OPENCODE_API_KEY) {
          throw new Error("OPENCODE_API_KEY is required when OPENCODE_E2E_REQUIRE_PAID=true")
        }

        const info = await Provider.getModel(ProviderID.make(providerID), ModelID.make(modelID))
        if (requirePaid) {
          const paid =
            info.cost.input > 0 || info.cost.output > 0 || info.cost.cache.read > 0 || info.cost.cache.write > 0
          if (!paid) {
            throw new Error(`OPENCODE_E2E_MODEL must resolve to a paid model: ${providerID}/${modelID}`)
          }
        }

        const session = await Session.create({ title })
        const messageID = MessageID.ascending()
        const partID = PartID.ascending()
        const message = {
          id: messageID,
          sessionID: session.id,
          role: "user" as const,
          time: { created: now },
          agent: "build",
          model: {
            providerID: ProviderID.make(providerID),
            modelID: ModelID.make(modelID),
          },
        }
        const part = {
          id: partID,
          sessionID: session.id,
          messageID,
          type: "text" as const,
          text,
          time: { start: now },
        }
        await Session.updateMessage(message)
        await Session.updatePart(part)
        await Project.update({ projectID: Instance.project.id, name: "E2E Project" })
      },
    })
  } finally {
    await Instance.disposeAll().catch(() => {})
  }
}

await seed()
