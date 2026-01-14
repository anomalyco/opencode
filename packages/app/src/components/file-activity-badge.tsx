/**
 * File Activity Badge Component
 *
 * Displays a colored dot indicating the type of AI activity on a file.
 * Shows label on hover via tooltip.
 * Feature: 003-file-activity-highlight
 */

import { type FileActivityType, ACTIVITY_VISUAL_CONFIG } from "@/types/file-activity"
import { Tooltip } from "@opencode-ai/ui/tooltip"

export interface FileActivityBadgeProps {
  /** The type of activity to display */
  type: FileActivityType
  /** Optional additional CSS classes */
  class?: string
}

/**
 * Dot indicator showing file activity type (read, edited, created).
 * Shows label on hover.
 */
export function FileActivityBadge(props: FileActivityBadgeProps) {
  const config = () => ACTIVITY_VISUAL_CONFIG[props.type]

  return (
    <Tooltip value={config().label} placement="top" openDelay={300}>
      <span
        class={`size-2 rounded-full shrink-0 ${config().badgeBackground} ${props.class ?? ""}`}
      />
    </Tooltip>
  )
}
