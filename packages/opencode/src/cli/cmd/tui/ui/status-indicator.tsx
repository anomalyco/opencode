import { type ParentProps, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { STATUS_COLORS, type StatusType, statusColorToRgba } from "../context/status-colors"

/**
 * Status Indicator Component
 *
 * Displays a colored indicator with icon and text for task states.
 * Follows WCAG 1.4.1 accessibility guidelines - color + icon + text.
 *
 * Usage:
 * ```tsx
 * <StatusIndicator status="running" showLabel />
 * <StatusIndicator status="error" />
 * ```
 */
export function StatusIndicator(props: ParentProps<{
  status: StatusType
  showLabel?: boolean
  showIcon?: boolean
  size?: "small" | "medium" | "large"
}>) {
  const { theme } = useTheme()

  const config = () => STATUS_COLORS[props.status]
  const size = () => props.size ?? "medium"

  const padding = () => {
    switch (size()) {
      case "small":
        return 0
      case "large":
        return 2
      default:
        return 1
    }
  }

  const iconSize = () => {
    switch (size()) {
      case "small":
        return 12
      case "large":
        return 16
      default:
        return 14
    }
  }

  const textSize = () => {
    switch (size()) {
      case "small":
        return 10
      case "large":
        return 14
      default:
        return 12
    }
  }

  return (
    <box
      flexDirection="row"
      alignItems="center"
      gap={1}
      paddingLeft={padding()}
      paddingRight={padding()}
      paddingTop={padding() / 2}
      paddingBottom={padding() / 2}
      backgroundColor={statusColorToRgba(config().color, 0.15)}
      borderColor={statusColorToRgba(config().color, 0.5)}
      border={["left"]}
    >
      <Show when={props.showIcon !== false}>
        <text
          fg={statusColorToRgba(config().color)}
          fontSize={iconSize()}
        >
          {config().icon}
        </text>
      </Show>

      <Show when={props.showLabel !== false}>
        <text
          fg={statusColorToRgba(config().color)}
          attributes={TextAttributes.BOLD}
          fontSize={textSize()}
        >
          {config().text}
        </text>
      </Show>

      {props.children}
    </box>
  )
}

/**
 * Project Status Badge
 *
 * Shows project name with status indicator.
 * Useful for multi-project views.
 */
export function ProjectStatusBadge(props: {
  projectName: string
  status: StatusType
  onClick?: () => void
}) {
  const { theme } = useTheme()
  const config = () => STATUS_COLORS[props.status]

  return (
    <box
      flexDirection="row"
      alignItems="center"
      gap={1}
      paddingLeft={1}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={statusColorToRgba(config().color, 0.2)}
      borderColor={statusColorToRgba(config().color, 0.6)}
      border={["left"]}
    >
      <text
        fg={statusColorToRgba(config().color)}
        fontSize={14}
      >
        {config().icon}
      </text>

      <text
        fg={statusColorToRgba(config().color)}
        attributes={TextAttributes.BOLD}
        fontSize={12}
      >
        [{props.projectName}]
      </text>

      <text fg={theme.textMuted} fontSize={12}>
        {config().text}
      </text>
    </box>
  )
}

/**
 * Session State Banner
 *
 * Full-width banner for session state changes.
 * Appears at top of session view to indicate current state.
 */
export function SessionStateBanner(props: {
  status: StatusType
  projectName?: string
}) {
  const { theme } = useTheme()
  const config = () => STATUS_COLORS[props.status]

  return (
    <box
      width="100%"
      justifyContent="center"
      alignItems="center"
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={statusColorToRgba(config().color, 0.1)}
      borderColor={statusColorToRgba(config().color, 0.3)}
      border={["bottom"]}
    >
      <text
        fg={statusColorToRgba(config().color)}
        attributes={TextAttributes.BOLD}
        fontSize={14}
      >
        {config().icon} {props.projectName ? `[${props.projectName}] ` : ""}{config().text}
      </text>
    </box>
  )
}
