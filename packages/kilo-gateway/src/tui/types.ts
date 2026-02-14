/**
 * Type definitions for required TUI dependencies from OpenCode
 * These are injected at runtime to avoid circular dependencies
 */

export interface TUIDependencies {
  // UI Hooks
  useCommandDialog: () => any
  useSync: () => any
  useDialog: () => any
  useToast: () => any
  useTheme: () => any
  useSDK: () => any

  // UI Components
  DialogAlert: any
  DialogSelect: any
  Link: any

  // Utilities
  Clipboard: any
  useKeyboard: any
  TextAttributes: any
}
