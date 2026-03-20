import { BenchmarkCatalog } from "./catalog"
import { BenchmarkSmoke } from "./smoke"

export namespace BenchmarkFullflow {
  export const GATE = "fullflow smoke"

  export async function load(input?: string) {
    return BenchmarkCatalog.load("fullflow", input)
  }

  export async function list(input?: string) {
    return (await load(input)).cases
  }

  export async function run(input?: {
    jobs?: string
    repo?: string
    root?: string
    now?: Date
    tag?: string
    name?: string
  }) {
    const man = await load(input?.jobs)
    return BenchmarkSmoke.run({
      ...input,
      gate: GATE,
      manifest: man,
      name: input?.name ?? man.smoke?.job ?? man.smoke?.name,
    })
  }
}
