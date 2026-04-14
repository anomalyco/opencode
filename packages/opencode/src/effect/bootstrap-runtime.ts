import { Layer, ManagedRuntime } from "effect"
import { memoMap } from "./run-service"

import { Plugin } from "@/plugin"
import { LSP } from "@/lsp"
import { FileWatcher } from "@/file/watcher"
import { Format } from "@/format"
import { ShareNext } from "@/share/share-next"
import { File } from "@/file"
import { Vcs } from "@/project/vcs"
import { Snapshot } from "@/snapshot"
import { Bus } from "@/bus"
import { Observability } from "./oltp"

export const BootstrapLayer = Layer.mergeAll(
  Plugin.defaultLayer,
  ShareNext.defaultLayer,
  Format.defaultLayer,
  LSP.defaultLayer,
  File.defaultLayer,
  FileWatcher.defaultLayer,
  Vcs.defaultLayer,
  Snapshot.defaultLayer,
  Bus.defaultLayer,
).pipe(Layer.provide(Observability.layer))

export const BootstrapRuntime = ManagedRuntime.make(BootstrapLayer, { memoMap })
