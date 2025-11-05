/**
 * Plugin UI Canvas
 *
 * This is the ONLY approved API for plugins to render UI in OpenCode TUI.
 *
 * ## IMPORTANT: Use lowercase JSX elements
 *
 * Plugins MUST use lowercase JSX elements directly:
 * - `<box>` not `<Box>`
 * - `<text>` not `<Text>`
 *
 * ## Example:
 * ```tsx
 * import { createSignal, For } from "../../src/plugin-ui"
 *
 * const MyComponent = () => {
 *   return (
 *     <box flexDirection="column" gap={0}>
 *       <text fg="#00ff00">Hello!</text>
 *     </box>
 *   )
 * }
 * ```
 *
 * ## Why lowercase?
 * Uppercase components (Box, Text, VStack, HStack) caused "No renderer found" errors because
 * their JSX gets compiled at module load time (outside renderer context).
 * Lowercase elements (<box>, <text>) are intrinsic JSX elements that compile at render time.
 *
 * ## Common Patterns:
 * - Vertical stack: `<box flexDirection="column" gap={1}>`
 * - Horizontal stack: `<box flexDirection="row" gap={1}>`
 * - Text with color: `<text fg="#00ff00">Hello</text>`
 */

/** @jsxImportSource @opentui/solid */

// Re-export SolidJS primitives (safe for plugins)
export { createSignal, createMemo, For, Show, Switch, Match, onMount, onCleanup } from "solid-js"

// Re-export OpenTUI elements (these are the primitives)
export type { BoxProps, TextProps } from "@opentui/solid"

// Re-export OpenTUI core utilities
export { TextAttributes } from "@opentui/core"
