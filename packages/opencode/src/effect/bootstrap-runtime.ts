import { Layer, ManagedRuntime } from "effect"

import { Plugin } from "@/plugin"
import { LSP } from "@/lsp/lsp"
import { Format } from "@/format"
import { ShareNext } from "@/share/share-next"
import { Vcs } from "@/project/vcs"
import { Snapshot } from "@/snapshot"
import { Config } from "@/config/config"
import * as Observability from "@cedric/core/effect/observability"
import { memoMap } from "@cedric/core/effect/memo-map"

export const BootstrapLayer = Layer.mergeAll(
  Config.defaultLayer,
  Plugin.defaultLayer,
  ShareNext.defaultLayer,
  Format.defaultLayer,
  LSP.defaultLayer,
  Vcs.defaultLayer,
  Snapshot.defaultLayer,
).pipe(Layer.provide(Observability.layer))

export const BootstrapRuntime = ManagedRuntime.make(BootstrapLayer, { memoMap })
