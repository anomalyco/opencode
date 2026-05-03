import { describe, expect, test, afterAll } from "bun:test"
import { Log } from "../../src/util/log"
import { withFullStack, cleanupFullStack } from "../fixture/fullstack-testcontainer"

Log.init({ print: false })

// Long timeout for container startup (Postgres + Server + Migrations)
const TEST_TIMEOUT = 300000 // 5 minutes

describe.skipIf(process.env.OPENCODE_FULL_STACK_TEST !== "1")(
  "Full Stack Integration (Postgres + Server + Client SDK)",
  () => {
  // Cleanup after all tests
  afterAll(async () => {
    await cleanupFullStack()
  })

  test("health check returns ok", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      const health = await client.health()
      expect(health.ok).toBe(true)
    })
  })

  test("server is available", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      const available = await client.isAvailable()
      expect(available).toBe(true)
    })
  })

  test("creates a project", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      const project = await client.createProject({
        name: "Integration Test Project",
      })

      expect(project.id).toBeDefined()
      expect(project.name).toBe("Integration Test Project")
      expect(project.time.created).toBeGreaterThan(0)
      expect(project.time.updated).toBeGreaterThan(0)
    })
  })

  test("lists projects after creation", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      // Create a project
      await client.createProject({ name: "List Test Project" })

      // List projects
      const projects = await client.listProjects()

      expect(projects.length).toBeGreaterThanOrEqual(1)
      expect(projects.some(p => p.name === "List Test Project")).toBe(true)
    })
  })

  test("gets project by ID", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      // Create a project
      const created = await client.createProject({ name: "Get Test Project" })

      // Get by ID
      const fetched = await client.getProject(created.id)

      expect(fetched.id).toBe(created.id)
      expect(fetched.name).toBe(created.name)
    })
  })

  test("creates a session for a project", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      // Create project first
      const project = await client.createProject({
        name: "Session Test Project",
      })

      // Create session
      const session = await client.createSession({
        projectId: project.id,
        title: "Test Session",
      })

      expect(session.id).toBeDefined()
      expect(session.projectID).toBe(project.id)
      expect(session.title).toBe("Test Session")
      expect(session.slug).toBeDefined()
      // Sessions are stateless - no directory field anymore
      expect("directory" in session).toBe(false)
      expect(session.time.created).toBeGreaterThan(0)
    })
  })

  test("lists sessions for a project", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      // Create project and session
      const project = await client.createProject({
        name: "List Sessions Project",
      })

      await client.createSession({
        projectId: project.id,
        title: "Session 1",
      })

      await client.createSession({
        projectId: project.id,
        title: "Session 2",
      })

      // List sessions
      const sessions = await client.listSessions(project.id)

      expect(sessions.length).toBeGreaterThanOrEqual(2)
      expect(sessions.some(s => s.title === "Session 1")).toBe(true)
      expect(sessions.some(s => s.title === "Session 2")).toBe(true)
    })
  })

  test("gets session by ID", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      const project = await client.createProject({
        name: "Get Session Project",
      })

      const created = await client.createSession({
        projectId: project.id,
        title: "Session to Get",
      })

      const fetched = await client.getSession(created.id)

      expect(fetched.id).toBe(created.id)
      expect(fetched.title).toBe(created.title)
      expect(fetched.projectID).toBe(project.id)
    })
  })

  test("creates child session (fork)", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      const project = await client.createProject({
        name: "Fork Test Project",
      })

      const parent = await client.createSession({
        projectId: project.id,
        title: "Parent Session",
      })

      const child = await client.createSession({
        projectId: project.id,
        title: "Child Session",
        parentId: parent.id,
      })

      expect(child.parentID).toBe(parent.id)
      expect(child.projectID).toBe(project.id)
    })
  })

  test("sends a message in a session", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      const project = await client.createProject({
        name: "Message Test Project",
      })

      const session = await client.createSession({
        projectId: project.id,
        title: "Message Session",
      })

      // Send a message
      const message = await client.sendMessage({
        sessionId: session.id,
        content: "Hello, this is a test message from the integration test!",
      })

      expect(message.info.id).toBeDefined()
      expect(message.info.sessionID).toBe(session.id)
      expect(message.info.role).toBe("user")
      expect(message.info.content).toBe("Hello, this is a test message from the integration test!")
    })
  })

  test("lists messages in a session", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      const project = await client.createProject({
        name: "List Messages Project",
      })

      const session = await client.createSession({
        projectId: project.id,
        title: "List Messages Session",
      })

      // Send multiple messages
      await client.sendMessage({
        sessionId: session.id,
        content: "Message 1",
      })

      await client.sendMessage({
        sessionId: session.id,
        content: "Message 2",
      })

      // List messages
      const messages = await client.listMessages(session.id)

      expect(messages.length).toBeGreaterThanOrEqual(2)
      expect(messages.some(m => m.info.content === "Message 1")).toBe(true)
      expect(messages.some(m => m.info.content === "Message 2")).toBe(true)
    })
  })

  test("sends 'hi' to Big Pickle (AI)", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      const project = await client.createProject({
        name: "Big Pickle Test Project",
      })

      const session = await client.createSession({
        projectId: project.id,
        title: "Big Pickle Session",
      })

      // Send greeting to Big Pickle
      const message = await client.sendMessage({
        sessionId: session.id,
        content: "Hi Big Pickle! This is an automated integration test saying hello!",
      })

      expect(message.info.id).toBeDefined()
      expect(message.info.content).toContain("Big Pickle")
      
      // The message should be stored
      const messages = await client.listMessages(session.id)
      expect(messages.some(m => m.info.content.includes("Big Pickle"))).toBe(true)
    })
  })

  test("deletes a session", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      const project = await client.createProject({
        name: "Delete Session Project",
      })

      const session = await client.createSession({
        projectId: project.id,
        title: "Session to Delete",
      })

      // Delete the session
      const result = await client.deleteSession(session.id)
      expect(result).toBe(true)

      // Session should no longer be listable
      const sessions = await client.listSessions(project.id)
      expect(sessions.some(s => s.id === session.id)).toBe(false)
    })
  })

  test("full workflow: project → session → message → verify", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      // Step 1: Create project
      const project = await client.createProject({
        name: "Full Workflow Project",
      })
      expect(project.id).toBeDefined()

      // Step 2: Create session
      const session = await client.createSession({
        projectId: project.id,
        title: "Full Workflow Session",
      })
      expect(session.projectID).toBe(project.id)

      // Step 3: Send messages
      const msg1 = await client.sendMessage({
        sessionId: session.id,
        content: "First message in full workflow test",
      })
      expect(msg1.info.sessionID).toBe(session.id)

      const msg2 = await client.sendMessage({
        sessionId: session.id,
        content: "Second message - hi from integration test!",
      })
      expect(msg2.info.sessionID).toBe(session.id)

      // Step 4: Verify messages are stored
      const messages = await client.listMessages(session.id)
      expect(messages.length).toBeGreaterThanOrEqual(2)
      
      // Step 5: Verify session is in list
      const sessions = await client.listSessions(project.id)
      expect(sessions.some(s => s.id === session.id)).toBe(true)

      // Step 6: Verify project is in list
      const projects = await client.listProjects()
      expect(projects.some(p => p.id === project.id)).toBe(true)

      log.info("Full workflow test completed successfully!")
    })
  })

  test("session isolation: sessions don't share data", { timeout: TEST_TIMEOUT }, async () => {
    await withFullStack(async ({ client }) => {
      const project = await client.createProject({
        name: "Isolation Test Project",
      })

      // Create two sessions
      const session1 = await client.createSession({
        projectId: project.id,
        title: "Session 1",
      })

      const session2 = await client.createSession({
        projectId: project.id,
        title: "Session 2",
      })

      // Send message in session 1
      await client.sendMessage({
        sessionId: session1.id,
        content: "Message in session 1",
      })

      // Session 2 should not have session 1's messages
      const session2Messages = await client.listMessages(session2.id)
      expect(session2Messages.some(m => m.info.content === "Message in session 1")).toBe(false)

      // Session 1 should have its message
      const session1Messages = await client.listMessages(session1.id)
      expect(session1Messages.some(m => m.info.content === "Message in session 1")).toBe(true)
    })
  })
})
