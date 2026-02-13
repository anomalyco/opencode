/**
 * Account Settings Section for Cloud Mode
 *
 * Provides the account/logout section in the settings panel.
 * This is registered as a settings extension when claxedo is loaded.
 */

import { Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import type { SettingsSectionProps } from "@opencode-ai/app-shared"
import { useAuth } from "../utils/auth-client"

/**
 * Settings row component matching the pattern in settings-general.tsx
 */
const SettingsRow: Component<{
  title: string
  description: string
  children: any
}> = (props) => {
  return (
    <div class="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}

/**
 * Account Settings Section component.
 * Displays account information and logout button.
 */
export const AccountSettingsSection: Component<SettingsSectionProps> = (props) => {
  const { signOut } = useAuth()

  return (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">
        {props.t("settings.general.section.account")}
      </h3>

      <div class="bg-surface-raised-base px-4 rounded-lg">
        <SettingsRow
          title={props.t("settings.general.account.logout.title")}
          description={props.t("settings.general.account.logout.description")}
        >
          <Button size="small" variant="secondary" onClick={() => void signOut()}>
            {props.t("settings.general.account.logout.button")}
          </Button>
        </SettingsRow>
      </div>
    </div>
  )
}
