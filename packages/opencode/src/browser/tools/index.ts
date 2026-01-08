/**
 * Browser Tools - All browser automation tools
 * Organized for efficient context and token usage
 */

export { BrowserNavigateTool } from "./navigate"
export { BrowserScreenshotTool } from "./screenshot"
export { BrowserClickTool } from "./click"
export { BrowserTypeTool } from "./type"
export { BrowserSearchTool } from "./search"
export { BrowserScrollTool } from "./scroll"
export { BrowserContentTool } from "./content"
export { BrowserWaitTool } from "./wait"
export { BrowserHoverTool } from "./hover"
export { BrowserDragTool } from "./drag"
export { BrowserPressKeyTool } from "./press-key"
export { BrowserSelectOptionTool } from "./select-option"
export { BrowserFillFormTool } from "./fill-form"
export { BrowserEvaluateTool } from "./evaluate"
export { BrowserSnapshotTool } from "./snapshot"
export { BrowserTabsTool } from "./tabs"
export { BrowserCloseTool } from "./close"
export { BrowserInitTool } from "./init"
export { BrowserConsoleMessagesTool } from "./console-messages"
export { BrowserNetworkRequestsTool } from "./network-requests"
export { BrowserHandleDialogTool } from "./handle-dialog"
export { BrowserFileUploadTool } from "./file-upload"
export { BrowserResizeTool } from "./resize"
export { BrowserRunCodeTool } from "./run-code"
export { BrowserNavigateBackTool, BrowserNavigateForwardTool } from "./navigate-back"

// New tools
export { BrowserGetPageTool } from "./get-page"
export { BrowserGetElementAtTool } from "./get-element-at"
export { BrowserGetElementBoundsTool } from "./get-element-bounds"
export { BrowserCheckTool } from "./check-element"
export { BrowserClosePageTool } from "./close-page"

// Testing assertions
export { BrowserVerifyElementVisibleTool } from "./verify-element-visible"
export { BrowserVerifyTextVisibleTool } from "./verify-text-visible"
export { BrowserGenerateLocatorTool } from "./generate-locator"

// Import all tools for the registry
import { BrowserNavigateTool } from "./navigate"
import { BrowserScreenshotTool } from "./screenshot"
import { BrowserClickTool } from "./click"
import { BrowserTypeTool } from "./type"
import { BrowserSearchTool } from "./search"
import { BrowserScrollTool } from "./scroll"
import { BrowserContentTool } from "./content"
import { BrowserWaitTool } from "./wait"
import { BrowserHoverTool } from "./hover"
import { BrowserDragTool } from "./drag"
import { BrowserPressKeyTool } from "./press-key"
import { BrowserSelectOptionTool } from "./select-option"
import { BrowserFillFormTool } from "./fill-form"
import { BrowserEvaluateTool } from "./evaluate"
import { BrowserSnapshotTool } from "./snapshot"
import { BrowserTabsTool } from "./tabs"
import { BrowserCloseTool } from "./close"
import { BrowserInitTool } from "./init"
import { BrowserConsoleMessagesTool } from "./console-messages"
import { BrowserNetworkRequestsTool } from "./network-requests"
import { BrowserHandleDialogTool } from "./handle-dialog"
import { BrowserFileUploadTool } from "./file-upload"
import { BrowserResizeTool } from "./resize"
import { BrowserRunCodeTool } from "./run-code"
import { BrowserNavigateBackTool, BrowserNavigateForwardTool } from "./navigate-back"
import { BrowserGetPageTool } from "./get-page"
import { BrowserGetElementAtTool } from "./get-element-at"
import { BrowserGetElementBoundsTool } from "./get-element-bounds"
import { BrowserCheckTool } from "./check-element"
import { BrowserClosePageTool } from "./close-page"
import { BrowserVerifyElementVisibleTool } from "./verify-element-visible"
import { BrowserVerifyTextVisibleTool } from "./verify-text-visible"
import { BrowserGenerateLocatorTool } from "./generate-locator"

/**
 * All browser tools for the registry
 */
export const BrowserTools = [
  // Core navigation & page management
  BrowserInitTool,
  BrowserNavigateTool,
  BrowserNavigateBackTool,
  BrowserNavigateForwardTool,
  BrowserGetPageTool,

  // Visual/Screenshot
  BrowserScreenshotTool,
  BrowserSnapshotTool,

  // Interaction & Discovery
  BrowserClickTool,
  BrowserHoverTool,
  BrowserTypeTool,
  BrowserSearchTool,
  BrowserDragTool,
  BrowserScrollTool,
  BrowserPressKeyTool,
  BrowserCheckTool,

  // Element inspection
  BrowserGetElementAtTool,
  BrowserGetElementBoundsTool,

  // Forms
  BrowserFillFormTool,
  BrowserSelectOptionTool,
  BrowserFileUploadTool,

  // Content & Context
  BrowserContentTool,
  BrowserEvaluateTool,
  BrowserRunCodeTool,

  // Page state
  BrowserWaitTool,
  BrowserConsoleMessagesTool,
  BrowserNetworkRequestsTool,
  BrowserHandleDialogTool,

  // Window/Tab management
  BrowserTabsTool,
  BrowserResizeTool,
  BrowserCloseTool,
  BrowserClosePageTool,

  // Testing assertions
  BrowserVerifyElementVisibleTool,
  BrowserVerifyTextVisibleTool,
  BrowserGenerateLocatorTool,
]
