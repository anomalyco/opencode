/**
 * Seed script for E2E tests - Stateless Architecture
 * 
 * In the new architecture:
 * - Creates a database project (not a filesystem directory)
 * - Seeds a session in that project
 * - All files are virtual (no local filesystem persistence)
 */

const title = process.env.OPENCODE_E2E_SESSION_TITLE ?? "E2E Session"
const text = process.env.OPENCODE_E2E_MESSAGE ?? "Seeded for UI e2e"
const model = process.env.OPENCODE_E2E_MODEL ?? "openai/llama3.2:1b"
const parts = model.split("/")
const providerID = parts[0] ?? "openai"
const modelID = parts[1] ?? "llama3.2:1b"
const now = Date.now()

/** Must match the WorkOS `user_…` id for whoever is signed in during E2E (see Playwright `storageState` / wos-session). */
const tenantUserId =
  process.env["OPENCODE_E2E_TENANT_USER_ID"]?.trim() || "e2e_test_user"

const seed = async () => {
  const { Instance } = await import("../src/project/instance")
  const { InstanceBootstrap } = await import("../src/project/bootstrap")
  const { Session } = await import("../src/session")
  const { MessageID, PartID } = await import("../src/session/schema")
  const { Project } = await import("../src/project/project")

  // Create a database project (not a filesystem project)
  // Use a fixed seed ID so tests can reference it
  const { project } = await Project.createSimple({
    name: "E2E Seed Project",
    tenantUserId,
  })

  console.log(`[Seed] Created project: ${project.id} (tenantUserId=${tenantUserId})`)

  // Provide instance with virtual project path
  await Instance.provide({
    project: { ...project }, // No local filesystem
    init: InstanceBootstrap,
    fn: async () => {
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
          providerID,
          modelID,
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
      
      console.log(`[Seed] Created session: ${session.id}`)
    },
  })

  console.log(`[Seed] Seeded project ${project.id} with session`)
}

await seed()
