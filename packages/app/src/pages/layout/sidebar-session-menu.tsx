import type { Session } from "@opencode-ai/sdk/v2/client"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { Accessor, JSX } from "solid-js"
import { useLanguage } from "@/context/language"

export const SessionMenu = (props: {
  mobile?: boolean
  sidebarHovering: Accessor<boolean>
  session: Session
  archive: (session: Session) => Promise<void>
}): JSX.Element => {
  const language = useLanguage()

  return (
    <div
      class="shrink-0 overflow-hidden transition-[width,opacity]"
      classList={{
        "w-6 opacity-100 pointer-events-auto": !!props.mobile,
        "w-0 opacity-0 pointer-events-none": !props.mobile,
        "group-hover/session:w-6 group-hover/session:opacity-100 group-hover/session:pointer-events-auto": true,
        "group-focus-within/session:w-6 group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto": true,
      }}
    >
      <DropdownMenu modal={!props.sidebarHovering()} placement="bottom-end" gutter={4}>
        <Tooltip value={language.t("common.moreOptions")} placement="top">
          <DropdownMenu.Trigger
            as={IconButton}
            icon="dot-grid"
            variant="ghost"
            class="size-6 rounded-md"
            aria-label={language.t("common.moreOptions")}
          />
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={() => void props.archive(props.session)}>
              <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}
