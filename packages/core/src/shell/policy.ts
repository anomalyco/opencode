export * as ShellPolicy from "./policy.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Layer } from "effect"
import { State } from "../state.js"

type Data = {
  portableScanner: boolean
}

export type Draft = {
  configure: (portableScanner: boolean) => void
}

export interface Interface extends State.Transformable<Draft> {
  readonly portableScanner: () => boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ShellPolicy") {}

const layer = Layer.sync(Service, () => {
  const state = State.create<Data, Draft>({
    name: "shell-policy",
    initial: () => ({ portableScanner: false }),
    draft: (draft) => ({
      configure: (portableScanner) => {
        draft.portableScanner = portableScanner
      },
    }),
  })
  return Service.of({
    transform: state.transform,
    reload: state.reload,
    portableScanner: () => state.get().portableScanner,
  })
})

export const node = makeLocationNode({ service: Service, layer, deps: [] })
