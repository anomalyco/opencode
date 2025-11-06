/**
 * Core Message Widget Configurations
 * 
 * Built-in widget patterns and system prompts
 * Rendering is handled by the existing plugin system
 */

import type { MessageWidgetDefinition } from "../types"
import {
  STEERING_QUESTIONS_PATTERN,
  STEERING_QUESTIONS_SYSTEM_PROMPT,
} from "./steering-questions"

/**
 * Core built-in message widget definitions
 * These provide patterns and prompts but use plugin rendering
 */
export const CORE_MESSAGE_WIDGETS: MessageWidgetDefinition[] = [
  {
    id: "steering-question",
    pattern: STEERING_QUESTIONS_PATTERN,
    systemPrompt: STEERING_QUESTIONS_SYSTEM_PROMPT,
  },
]

/**
 * Get all core message widgets
 */
export function getCoreMessageWidgets(): MessageWidgetDefinition[] {
  return CORE_MESSAGE_WIDGETS
}

/**
 * Find a core widget by ID
 */
export function getCoreWidget(widgetId: string): MessageWidgetDefinition | null {
  return CORE_MESSAGE_WIDGETS.find((w) => w.id === widgetId) || null
}

/**
 * Get system prompts from all core widgets
 */
export function getCoreWidgetSystemPrompts(): string[] {
  return CORE_MESSAGE_WIDGETS.map((w) => w.systemPrompt).filter(Boolean) as string[]
}
