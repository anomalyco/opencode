export { BrowserManager } from "./manager"
export type { BrowserManager as BrowserManagerType } from "./manager"
export { ScreenshotAnnotator } from "./annotate"

// Re-export types
export type { BrowserConfig, PageInfo, ElementBounds, InteractiveElement } from "./manager"

export type { AnnotationOptions, AnnotationResult } from "./annotate"

// Register cleanup on module load if browser features are enabled
import { Flag } from "@/flag/flag"
import { BrowserManager } from "./manager"

if (Flag.OPENCODE_ENABLE_BROWSER) {
  BrowserManager.registerCleanup()
}
