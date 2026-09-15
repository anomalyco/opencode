import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useNavigate } from "@solidjs/router"
import { For, type Component } from "solid-js"
import type { DesktopMod, DesktopModConflict } from "@/context/platform"
import { useLanguage } from "@/context/language"

export const DialogModConflictV2: Component<{
  mod: DesktopMod
  directory: string
  conflicts: DesktopModConflict[]
  onResolve: (resolution: "candidate" | "existing") => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const navigate = useNavigate()
  const language = useLanguage()

  const resolve = (resolution: "candidate" | "existing") => {
    void props.onResolve(resolution).then(() => dialog.close())
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("settings.mods.conflict.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-4 px-4 pt-4 pb-2">
        <p class="text-14-regular text-text-weak">
          {language.t("settings.mods.conflict.description", { mod: props.mod.name })}
        </p>
        <div class="flex min-w-0 flex-col gap-2">
          <For each={props.conflicts}>
            {(conflict) => (
              <div class="flex min-w-0 flex-col gap-1 border border-border-weak px-3 py-2">
                <span class="text-14-medium text-text-strong">
                  {conflict.modName} ·{" "}
                  {language.t(conflict.certain ? "settings.mods.conflict.declared" : "settings.mods.conflict.potential")}
                </span>
                <span class="text-13-regular text-text-weak">{conflict.detail}</span>
              </div>
            )}
          </For>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("settings.mods.conflict.cancel")}
        </ButtonV2>
        <ButtonV2
          variant="neutral"
          onClick={() => {
            dialog.close()
            navigate(
              `/${base64Encode(props.directory)}/session?${new URLSearchParams({
                prompt: `Resolve MOD loading conflicts for ${props.mod.name}. Review mod.json and the MOD source, then implement a compatibility patch. Conflicts: ${props.conflicts.map((conflict) => `${conflict.modName}: ${conflict.detail}`).join(" ")}`,
              })}`,
            )
          }}
        >
          {language.t("settings.mods.conflict.repair")}
        </ButtonV2>
        <ButtonV2 variant="outline" onClick={() => resolve("existing")}>
          {language.t("settings.mods.conflict.keepPriority")}
        </ButtonV2>
        <ButtonV2 variant="contrast" onClick={() => resolve("candidate")}>
          {language.t("settings.mods.conflict.prioritize", { mod: props.mod.name })}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
