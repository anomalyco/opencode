// IMPORTANT: Set env vars BEFORE any imports from src/ directory
import { afterAll } from "bun:test"
import { installTestEnv } from "./preload-setup"

const teardown = await installTestEnv()

afterAll(async () => {
  await teardown()
})
