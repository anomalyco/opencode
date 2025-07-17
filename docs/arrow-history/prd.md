# Feature: Universal Prompt History with Attachments

## Overview & Goals

Enable users to cycle through a universal prompt history using the up/down arrow keys, similar to terminal command history (e.g., fish shell). This history should persist across all projects/workspaces for a given user, and include any file references ("attachments") that were part of the original prompt. Users should be able to clear their history, and the maximum number of stored entries should be configurable (default: 100).

## User Stories

### 1. Universal Prompt History Navigation

**As a** user  
**I want** to use the up/down arrow keys to cycle through my previous prompts across all projects  
**So that** I can easily reuse or edit past prompts without retyping them

**Acceptance Criteria:**
- Pressing the up arrow in the prompt input cycles backward through the user's universal prompt history.
- Pressing the down arrow cycles forward (toward more recent prompts).
- History is shared across all projects/workspaces for the user.
- History persists across application restarts (stored on disk).
- Only the current user's history is accessible (not shared across users on the same machine).

### 2. Restoring Prompts with Attachments

**As a** user  
**I want** prompt history to restore any file references ("attachments") that were present in the original prompt  
**So that** I can accurately reuse prompts that depend on specific files

**Acceptance Criteria:**
- When cycling to a previous prompt, any file references attached to that prompt are restored in the input.
- The restored prompt appears exactly as it was when originally submitted, including file references.

### 3. History Management

**As a** user  
**I want** to be able to clear my prompt history and configure how many entries are stored  
**So that** I can manage my privacy and storage

**Acceptance Criteria:**
- There is a command (e.g., `/clear-history`) to clear all prompt history for the user.
- The maximum number of stored history entries is configurable (default: 100).
- When the maximum is reached, the oldest entries are discarded as new ones are added.

### 4. Accessibility

**As a** user with accessibility needs  
**I want** prompt history navigation to be usable with a keyboard and compatible with screen readers  
**So that** I can use the feature regardless of my abilities

**Acceptance Criteria:**
- All history navigation is fully keyboard accessible (up/down arrows).
- Prompts and file references are announced in a way compatible with screen readers (where possible in a TUI).
- No visual-only cues are required to use the feature.

## Success Metrics

- 100% of prompts (with or without file references) are restorable from history.
- Users can clear their history and see it is empty upon next navigation.
- No history is accessible between different users on the same machine.
- No regressions in prompt input usability or accessibility.

## Out of Scope

- Filtering history by current input (e.g., fish-style search) — may be considered in a future update.
- Support for attachments other than file references (e.g., images, code snippets).
- Sharing history between different users.
- Visual UI for managing history beyond the clear command and arrow navigation.
