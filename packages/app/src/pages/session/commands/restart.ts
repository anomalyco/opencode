import type { Part, UserMessage } from "@opencode-ai/sdk/v2"
import type { CommandOption } from "@/context/command"
import type { Prompt } from "@/context/prompt"
import { promptLength } from "@/components/prompt-input/history"
import { extractPromptFromParts } from "@/utils/prompt"

type Cmd = (option: Omit<CommandOption, "category">) => CommandOption

type Deps = {
  session: Cmd
  language: {
    t: (key: string) => string
  }
  id?: string
  dir?: string
  directory: string
  userMessages: () => UserMessage[]
  parts: (id: string) => Part[]
  set: (value: Prompt, cursor?: number, opts?: { dir: string; id?: string }) => void
  navigate: (path: string) => void
}

export const restart = async (deps: Deps) => {
  if (!deps.dir) return
  const msg = deps.userMessages()[0]
  if (!msg) return
  const value = extractPromptFromParts(deps.parts(msg.id), {
    directory: deps.directory,
    attachmentName: deps.language.t("common.attachment"),
  })

  deps.set(value, promptLength(value), { dir: deps.dir })
  deps.navigate(`/${deps.dir}/session`)
}

export const restartCommand = (deps: Deps) => {
  return deps.session({
    id: "session.restart",
    title: deps.language.t("command.session.restart"),
    description: deps.language.t("command.session.restart.description"),
    slash: "restart",
    disabled: !deps.id || deps.userMessages().length === 0,
    onSelect: () => restart(deps),
  })
}
