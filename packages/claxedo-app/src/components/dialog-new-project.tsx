/**
 * Dialog for choosing between Local and Cloud project types.
 *
 * This dialog is shown when sandboxEnabled is true, allowing users to choose
 * between creating a local directory project or a cloud sandbox project.
 */

import { Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { useConfigOptional } from "../context/config"

export interface DialogNewProjectProps {
  onLocal: () => void
  onCloud: () => void
  onClose?: () => void
}

/**
 * Project type selection dialog.
 * Shows Local and Cloud options based on configuration.
 */
export function DialogNewProject(props: DialogNewProjectProps) {
  const config = useConfigOptional()

  // Check if cloud is available (either via auth or direct Daytona key)
  const isCloudAvailable = () => {
    if (!config) return false
    return config.authEnabled || !!config.daytonaApiKey
  }

  return (
    <Dialog title="New Project">
      <div class="p-4 min-w-[400px]">
        <p class="text-sm text-text-weak mb-4">
          Choose where to create your project
        </p>

        <div class="flex flex-col gap-3">
          {/* Local option */}
          <button
            type="button"
            class="flex items-start gap-4 p-4 rounded-lg border border-border-base hover:bg-surface-base-hover transition-colors text-left"
            onClick={props.onLocal}
          >
            <div class="shrink-0 p-2 rounded-md bg-surface-base">
              <Icon name="folder" size="normal" class="text-icon-base" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-14-medium text-text-strong">Local</span>
              <span class="text-13-regular text-text-weak">
                Open a directory on this machine
              </span>
            </div>
          </button>

          {/* Cloud option */}
          <button
            type="button"
            class="flex items-start gap-4 p-4 rounded-lg border border-border-base hover:bg-surface-base-hover transition-colors text-left"
            classList={{
              "opacity-60 cursor-not-allowed": !isCloudAvailable(),
            }}
            onClick={() => isCloudAvailable() && props.onCloud()}
            disabled={!isCloudAvailable()}
          >
            <div class="shrink-0 p-2 rounded-md bg-surface-base">
              <Icon name="cloud-upload" size="normal" class="text-icon-base" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-14-medium text-text-strong">Cloud Sandbox</span>
              <span class="text-13-regular text-text-weak">
                Isolated cloud environment
              </span>
              <Show when={!isCloudAvailable()}>
                <span class="text-12-regular text-icon-warning-base mt-1">
                  Requires authentication or Daytona API key
                </span>
              </Show>
            </div>
          </button>
        </div>

        <div class="flex justify-end mt-4">
          <Button variant="secondary" onClick={props.onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
