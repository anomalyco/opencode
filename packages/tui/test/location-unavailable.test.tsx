import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

// The session lives in another directory than the client's own location, so the client syncs
// that location instead of the default one.
const session = {
  id: "ses_test",
  title: "Location sync",
  projectID: "proj_test",
  location: { directory: "/tmp/opencode/other-clone" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

const unavailable = "Session location unavailable"

async function waitFor(predicate: () => boolean, timeout = 20_000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(20)
  }
}

function sessionRoutes(url: URL) {
  if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
  if (url.pathname === "/api/session/ses_test") return json({ data: session })
  if (url.pathname === "/api/session/ses_test/message") return json({ data: [], cursor: {} })
  if (url.pathname === "/api/session/ses_test/inbox") return json({ data: [] })
  if (url.pathname === "/api/session/ses_test/permission") return json({ data: [] })
  return undefined
}

function isSessionLocation(url: URL) {
  return url.searchParams.get("location[directory]") === session.location.directory
}

function locationFound() {
  return json({
    location: {
      directory: session.location.directory,
      project: { id: session.projectID, directory: session.location.directory, canonical: session.location.directory },
    },
  })
}

test("a transient location failure keeps the composer", async () => {
  let attempts = 0
  await using setup = await createAppFixture({
    args: { sessionID: session.id },
    fetch: (url) => {
      const routed = sessionRoutes(url)
      if (routed) return routed
      if (url.pathname === "/api/location" && isSessionLocation(url)) return locationFound()
      // The plugin-activation gate answers 503 while the catalog is still coming up.
      if (url.pathname === "/api/model" && isSessionLocation(url)) {
        attempts++
        return json({ message: "Location plugins did not finish activating" }, { status: 503 })
      }
      return undefined
    },
  })
  await setup.ready
  // The retry gives up after three attempts.
  await waitFor(() => attempts >= 3)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  // The folder may still be there, so the client does not offer to move the session.
  expect(frame).not.toContain(unavailable)
  expect(frame).not.toContain("Choose another directory to continue this session.")
})

test("a location the server reports as missing asks for another directory", async () => {
  await using setup = await createAppFixture({
    args: { sessionID: session.id },
    fetch: (url) => {
      const routed = sessionRoutes(url)
      if (routed) return routed
      if (url.pathname === "/api/location" && isSessionLocation(url)) {
        return json(
          {
            _tag: "LocationNotFoundError",
            location: { directory: session.location.directory },
            message: `Location not found: ${session.location.directory}`,
          },
          { status: 404 },
        )
      }
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes(unavailable))
  const frame = setup.captureCharFrame()
  expect(frame).toContain(session.location.directory)
  expect(frame).toContain("Choose another directory to continue this session.")
})
