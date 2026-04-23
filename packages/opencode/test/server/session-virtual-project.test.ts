import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("Session.create with virtual project handle", () => {
  test("creates session successfully with virtual project handle", async () => {
    // Setup: Create a project in the database
    await using tmp = await tmpdir({ git: true })
    const projectResult = await Project.createForDirectory({
      directory: tmp.path,
      name: "virtual-project-test",
      tenantUserId: "user_test",
    })
    const project = projectResult.project

    // Simulate the request coming in with directory query param: /projects/<id>
    // This is how the web UI calls the API for DB-backed projects
    const virtualHandle = `/projects/${project.id}`

    await Instance.provide({
      directory: virtualHandle,
      project,
      fn: async () => {
        // Create a session - this should work without any directory field
        const session = await Session.create({
          title: "test-session-virtual-project",
        })

        // Verify the session was created successfully
        expect(session.id).toBeDefined()
        expect(session.projectID).toBe(project.id)
        
        // Sessions are stateless - no directory field anymore
        expect("directory" in session).toBe(false)
        
        // Verify we can retrieve the session
        const retrieved = await Session.get(session.id)
        expect(retrieved.id).toBe(session.id)
        expect("directory" in retrieved).toBe(false)
        
        // Verify session appears in list
        const sessions = await Array.fromAsync(Session.list())
        expect(sessions.some(s => s.id === session.id)).toBe(true)
      },
    })
  })

  test("creates session without directory (stateless)", async () => {
    // This verifies the general case: sessions no longer have a directory field
    await using tmp = await tmpdir({ git: true })
    const projectResult = await Project.createForDirectory({
      directory: tmp.path,
      name: "stateless-test",
      tenantUserId: "user_test",
    })
    const project = projectResult.project

    await Instance.provide({
      directory: tmp.path,
      project,
      fn: async () => {
        const session = await Session.create({
          title: "test-session-stateless",
        })

        // Sessions are stateless - no directory field anymore
        expect("directory" in session).toBe(false)
        
        // Session should still be fully functional
        expect(session.title).toBe("test-session-stateless")
        expect(session.slug).toBeDefined()
        expect(session.time.created).toBeGreaterThan(0)
      },
    })
  })

  test("fork session works without directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectResult = await Project.createForDirectory({
      directory: tmp.path,
      name: "fork-test",
      tenantUserId: "user_test",
    })
    const project = projectResult.project

    await Instance.provide({
      directory: tmp.path,
      project,
      fn: async () => {
        // Create parent session
        const parent = await Session.create({
          title: "parent-session",
        })
        expect("directory" in parent).toBe(false)

        // Fork the session
        const child = await Session.fork({
          sessionID: parent.id,
        })

        // Forked session also has no directory field
        expect("directory" in child).toBe(false)
        expect(child.parentID).toBeUndefined() // fork creates new root
        expect(child.title).toContain("fork")
      },
    })
  })

  test("session can have messages without directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const projectResult = await Project.createForDirectory({
      directory: tmp.path,
      name: "messages-test",
      tenantUserId: "user_test",
    })
    const project = projectResult.project

    await Instance.provide({
      directory: tmp.path,
      project,
      fn: async () => {
        const session = await Session.create({
          title: "test-messages",
        })

        expect("directory" in session).toBe(false)

        // Verify we can still interact with the session
        // (messages would normally go through the executor API in stateless mode)
        const sessions = await Array.fromAsync(Session.list())
        const found = sessions.find(s => s.id === session.id)
        expect(found).toBeDefined()
        expect("directory" in found!).toBe(false)
      },
    })
  })
})
