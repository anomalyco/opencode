import { Watcher } from "@opencode/core/filesystem/watcher"

// The default Watcher node watches config and skill directories natively. On Windows,
// @parcel/watcher frees a subscription while its pending read can still complete into
// it (parcel-bundler/watcher#262), so each unsubscribe can segfault the whole suite.
// Real-Location fixtures that do not test watching opt out here.
export const disabledWatcher = Watcher.node.replace(Watcher.configured({ enabled: false }))
