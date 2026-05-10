import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"

type BrowserPanelController = {
  opened: () => boolean
  toggle: () => void
}

export function SessionHeaderBrowserToggle(props: { browserPanel: BrowserPanelController }) {
  return (
    <Tooltip placement="bottom" value="Browser">
      <Button
        variant="ghost"
        class="group/browser-toggle titlebar-icon w-8 h-6 p-0 box-border"
        onClick={() => props.browserPanel.toggle()}
        aria-label="Browser"
        aria-expanded={props.browserPanel.opened()}
        aria-controls="browser-panel"
        title="Browser"
      >
        <Icon
          size="small"
          name="browser"
          classList={{
            "text-icon-strong": props.browserPanel.opened(),
            "text-icon-weak": !props.browserPanel.opened(),
          }}
        />
      </Button>
    </Tooltip>
  )
}
