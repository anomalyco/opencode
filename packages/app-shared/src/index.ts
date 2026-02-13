/**
 * @opencode-ai/app-shared
 *
 * Shared extension point system for OpenCode.
 * This package defines the interfaces and registry for extending OpenCode
 * without modifying core files.
 */

export {
  // Types
  type AppExtensions,
  type ServerExtensions,
  type PersistExtensions,
  type SyncExtensions,
  type Extensions,
  type ExtensionPlugin,
  type WebProjectDialogProps,
  type SettingsSectionProps,
  // Functions
  registerExtensions,
  unregisterExtensions,
  getExtensions,
  hasExtensions,
  getRegisteredExtensionIds,
} from "./extension-points"
