import { Badge } from "@opencode/ui/badge"
import { useDialog } from "@opencode/ui/context/dialog"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { Option, Schema } from "effect"
import { createMemo, Show } from "solid-js"
import { BasicTool } from "../../components/basic-tool"
import { executeToolCounts } from "../../message/current-tool-state"
import { ExecuteDetails, executeResult, toolInput, type ToolProps } from "../../tools/tool-renderer"

const decodeDescription = Schema.decodeUnknownOption(Schema.NonEmptyString)

/**
 * A Code Mode script is one row that doesn't open: Execute, then what the script does in the model's words, or else
 * the tools it called and how often. Its code, output and error open in a dialog from the code button. How it ended
 * sits at the end of the row when it did not succeed.
 */
export function ExecuteTool(props: ToolProps & { stopped?: boolean }) {
  const i18n = useI18n()
  const dialog = useDialog()
  const pending = () => props.status === "streaming" || props.status === "running"
  const code = createMemo(() => (toolInput(props.input).code ?? "").trimEnd())
  const result = createMemo(() => executeResult(props, i18n))

  const label = createMemo(
    () =>
      (Option.getOrUndefined(decodeDescription(props.input.description))?.trim() || undefined) ??
      (executeToolCounts(props.metadata)
        .map((item) => i18n.t("ui.tool.execute.toolCount", { count: item.count, tool: item.tool }))
        .join(", ") ||
        undefined),
  )

  const outcome = createMemo(() => {
    if (props.stopped) return { tone: "neutral" as const, label: i18n.t("ui.timeline.shell.stopped") }

    if (result().error) return { tone: "danger" as const, label: i18n.t("ui.toolErrorCard.failed") }
  })

  // The script is complete once the call leaves streaming, so the dialog can show it while it runs.
  const viewable = () => props.status !== "streaming" && !!code()

  const openDetails = () =>
    dialog.show(() => (
      <ExecuteDetails
        code={code()}
        output={result().output}
        error={result().error}
        status={props.status}
      />
    ))

  return (
    <BasicTool
      {...props}
      icon="terminal"
      rail={false}
      hasContent={false}
      locked
      compact
      trigger={
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text={i18n.t("ui.tool.execute")} active={pending()} />
            </span>
            <Show when={label()}>{(text) => <span data-slot="basic-tool-tool-subtitle">{text()}</span>}</Show>
            <Show when={outcome()}>{(value) => <Badge variant={value().tone}>{value().label}</Badge>}</Show>
          </div>
        </div>
      }
      action={
        viewable() ? (
          <Tooltip value={i18n.t("ui.tool.execute.viewCode")} placement="top">
            <IconButton
              icon={<Icon name="code" />}
              size="normal"
              variant="ghost"
              aria-label={i18n.t("ui.tool.execute.viewCode")}
              aria-haspopup="dialog"
              onClick={openDetails}
            />
          </Tooltip>
        ) : undefined
      }
    />
  )
}
