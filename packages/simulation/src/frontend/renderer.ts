import type { CliRenderer, CliRendererConfig } from "@opentui/core"
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"

const setups = new WeakMap<CliRenderer, TestRendererSetup>()

/**
 * Creates the headless simulation renderer: a real CliRenderer backed by an
 * in-memory screen buffer instead of a terminal. The TestRendererSetup is
 * kept module-side (keyed by renderer) so the harness can use the supported
 * testing APIs without app code carrying it around.
 */
export async function create(options: CliRendererConfig): Promise<CliRenderer> {
  const setup = await createTestRenderer({
    ...options,
    width: 100,
    height: 40,
  })
  setups.set(setup.renderer, setup)
  return setup.renderer
}

export function setupFor(renderer: CliRenderer): TestRendererSetup | undefined {
  return setups.get(renderer)
}

export * as SimulationRenderer from "./renderer"
