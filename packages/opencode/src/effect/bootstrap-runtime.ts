import { Layer, ManagedRuntime } from "effect"
import { memoMap } from "./run-service"

import { Plugin } from "@/plugin"
import { LSP } from "@/lsp"
import { FileWatcher } from "@/file/watcher"
import { Format } from "@/format"
import { ShareNext } from "@/share"
import { File } from "@/file"
import { Vcs } from "@/project"
import { Snapshot } from "@/snapshot"
import { Bus } from "@/bus"
import { Config } from "@/config"
import * as Observability from "./observability"

export const BootstrapLayer = Layer.mergeAll(
  Config.defaultLayer,
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
