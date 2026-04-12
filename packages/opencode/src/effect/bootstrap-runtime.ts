import { Layer, ManagedRuntime } from "effect"
import { memoMap } from "./run-service"

import { FileWatcher } from "@/file/watcher"
import { Format } from "@/format"
import { ShareNext } from "@/share/share-next"

export const BootstrapLayer = Layer.mergeAll(Format.defaultLayer, ShareNext.defaultLayer, FileWatcher.defaultLayer)

export const BootstrapRuntime = ManagedRuntime.make(BootstrapLayer, { memoMap })
