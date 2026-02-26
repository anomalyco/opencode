# Fix: Add Missing Redo/Undo Slash Commands

## Problem
The `/redo` and `/undo` commands were not appearing in slash command autocomplete, 
even though they are configured with keyboard shortcuts (`<leader>r`/`<leader>u`). 
This made the functionality discoverable only through documentation.

## Solution
1. Created a centralized slash command registry (`packages/opencode/src/slash-commands.ts`)
2. Integrated the registry with console autocomplete (`packages/console/app/src/lib/slash-commands.ts`)
3. Updated the Autocomplete component to show command descriptions and shortcuts

## Changes
- **New file**: `packages/opencode/src/slash-commands.ts` - Central command registry
- **New file**: `packages/console/app/src/lib/slash-commands.ts` - Console integration
- **Modified**: `packages/console/app/src/components/Autocomplete.tsx` - Enhanced UI

## Testing
1. Type `/` in console → should show all commands including `/undo` and `/redo`
2. Type `/re` → should filter to show `/redo`
3. Selecting a command should insert it into the input field

Fixes #ISSUE_NUMBER (replace with actual issue number)