/**
 * OpenCode Plugin UI Library
 *
 * This is the official API for building plugin UIs.
 *
 * ## Usage in Plugins
 *
 * ```tsx
 * import { Box, Text, VStack, HStack, For, Show } from "@opencode/plugin-ui"
 *
 * export const MyPlugin = async () => {
 *   return {
 *     "ui.render": async (input, output) => {
 *       output.component = (
 *         <VStack gap={1}>
 *           <Text fg="#00ff00">Hello from plugin!</Text>
 *         </VStack>
 *       )
 *     }
 *   }
 * }
 * ```
 *
 * ## Why This Exists
 *
 * - Plugins MUST use these components to ensure they work in TUI renderer context
 * - Direct use of OpenTUI elements may not work due to renderer context issues
 * - These components are tested and guaranteed to work
 * - This provides a stable API that won't break plugins
 */

export * from "./canvas"
