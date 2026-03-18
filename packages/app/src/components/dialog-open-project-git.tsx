import { Button } from "@opencode-ai/ui/button"
import { Progress } from "@opencode-ai/ui/progress"
import { TextField } from "@opencode-ai/ui/text-field"
import { type JSX, Show, createEffect, onMount } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { type Platform, usePlatform } from "@/context/platform"
import { parseProjectInput, resolveCloneRepositoryUrl, suggestCloneTargetPath } from "./dialog-open-project.helpers"

type Props = {
  title: string
  lockMode?: boolean
  value: string
  target: string
  targetRoot: string
  targetManual: boolean
  busy: boolean
  setValue: (value: string) => void
  setTarget: (value: string, manual?: boolean) => void
  setTargetRoot: (value: string) => void
  clearError: () => void
}

type CloneOpts = {
  input: string
  target: string
  platform: Platform
  sdk: ReturnType<typeof useGlobalSDK>
  language: ReturnType<typeof useLanguage>
  onSelect: (dir: string) => void
}

export async function cloneProject(opts: CloneOpts) {
  const url = resolveCloneRepositoryUrl(opts.input)
  if (!url) {
    throw new Error(opts.language.t("dialog.project.open.error.gitInvalid"))
  }
  if (!opts.platform.cloneGitRepository) throw new Error(opts.language.t("common.requestFailed"))

  const dir = parseProjectInput(opts.target)
  const next = await opts.platform.cloneGitRepository(
    url,
    dir ? (opts.platform.normalizeProjectPath ? await opts.platform.normalizeProjectPath(dir) : dir) : undefined,
  )

  await opts.sdk.client.file.list({ directory: next, path: "" })
  opts.onSelect(next)
}

export function DialogOpenProjectGit(props: Props) {
  const language = useLanguage()
  const platform = usePlatform()

  onMount(() => {
    if (!platform.getDefaultCloneDirectory) return
    void platform.getDefaultCloneDirectory().then((root: string | null) => {
      if (!root) return
      props.setTargetRoot(root)
    })
  })

  createEffect(() => {
    if (props.targetManual) return
    const root = parseProjectInput(props.targetRoot)
    if (!root) return
    props.setTarget(suggestCloneTargetPath(props.value, root))
  })

  const browse = async () => {
    if (!platform.openDirectoryPickerDialog) return
    const res = await platform.openDirectoryPickerDialog({
      title: props.title,
      multiple: false,
    })

    const path = Array.isArray(res) ? res[0] : res
    if (!path) return
    props.setTarget(path, true)
  }

  return (
    <>
      <Show when={props.lockMode}>
        <div class="flex flex-col gap-2">
          <div class="text-14-medium text-text-strong">
            {language.t("dialog.project.open.git.label")}
            <span class="text-text-muted"> ({language.t("dialog.project.open.git.helper")})</span>
          </div>
          <TextField
            autofocus
            type="text"
            value={props.value}
            label=""
            placeholder={language.t("dialog.project.open.git.placeholder")}
            onChange={(value: string) => {
              props.setValue(value)
              props.clearError()
            }}
          />
        </div>
      </Show>

      <div class="flex flex-col gap-2 -mt-1 rounded-md border border-border-base bg-surface-raised-base px-3 py-2.5">
        <div class="text-14-medium text-text-strong">Local Path</div>
        <div class="flex items-center gap-2">
          <input
            type="text"
            class="flex-1 h-9 rounded-md border border-border-base bg-surface-base px-3 text-14-regular text-text-strong"
            value={props.target}
            placeholder={props.targetRoot || "~/Documents/code"}
            onInput={(event: JSX.InputEventUnion<HTMLInputElement, InputEvent>) =>
              props.setTarget(event.currentTarget.value, true)
            }
          />
          <Button type="button" variant="secondary" size="large" class="min-w-24" onClick={browse}>
            Choose...
          </Button>
        </div>
        <div class="text-12-regular text-text-weak">{language.t("dialog.project.open.path.hint")}</div>
      </div>

      <Show when={!props.lockMode}>
        <TextField
          autofocus
          type="text"
          value={props.value}
          label={language.t("dialog.project.open.git.label")}
          placeholder={language.t("dialog.project.open.git.placeholder")}
          onChange={(value: string) => {
            props.setValue(value)
            props.clearError()
          }}
        />
      </Show>

      <Show when={props.busy}>
        <Progress
          indeterminate
          aria-label={language.t("dialog.project.open.submit.cloning")}
          class={
            props.lockMode
              ? "-mt-2 gap-1 [&_[data-slot='progress-label']]:text-12-regular [&_[data-slot='progress-track']]:h-1"
              : "-mt-1 [&_[data-slot='progress-track']]:h-1"
          }
        >
          {language.t("dialog.project.open.submit.cloning")}
        </Progress>
      </Show>
    </>
  )
}
