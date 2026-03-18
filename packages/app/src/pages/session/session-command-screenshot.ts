import type { Accessor } from "solid-js"
import type { CommandOption } from "@/context/command"

type Lang = {
  t: (key: string) => string
}

type Input = {
  command: (option: Omit<CommandOption, "category">) => CommandOption
  language: Lang
  ready: Accessor<boolean>
  shot: () => Promise<void>
}

export const createSessionScreenshotCommand = (input: Input) =>
  input.command({
    id: "session.screenshot",
    title: input.language.t("command.session.screenshot"),
    description: input.language.t("command.session.screenshot.description"),
    slash: "screenshot",
    disabled: !input.ready(),
    onSelect: () => void input.shot(),
  })
