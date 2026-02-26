/**
 * Console Slash Commands Integration
 * 
 * This file integrates the slash commands registry with the console UI.
 */

import { SLASH_COMMANDS } from '@opencode-ai/opencode/src/slash-commands';

export interface AutocompleteItem {
  label: string;
  detail?: string;
  documentation?: string;
}

export function getSlashCommandSuggestions(): AutocompleteItem[] {
  return SLASH_COMMANDS.map(cmd => ({
    label: `/${cmd.name}`,
    detail: cmd.description,
    documentation: cmd.shortcut ? `快捷键: ${cmd.shortcut}` : undefined
  }));
}

// Export for testing
export { SLASH_COMMANDS };