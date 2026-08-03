import { AppIcon } from "@opencode-ai/ui/app-icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { createMemo, createSignal, For, onCleanup, onMount, Show, type ParentProps } from "solid-js"
import { useOpenInApp } from "@/components/session/open-in-app"
import { useLanguage } from "@/context/language"
import { reviewFilePath } from "@/pages/session/v2/review-diff-kinds"

export function ReviewFileContextMenu(
  props: ParentProps<{ root: string; target: { path: string; type: "file" | "directory"; deleted: boolean } }>,
) {
  const language = useLanguage()
  const [rowTarget, setRowTarget] = createSignal(false)
  const absolute = createMemo(() => (props.target.path ? reviewFilePath(props.root, props.target.path) : ""))
  const open = useOpenInApp({ directory: absolute })
  const defaultOption = createMemo(() => open.options().find((item) => item.id === "finder"))
  const options = createMemo(() =>
    open
      .options()
      .filter((item) => item.id !== "finder")
      .filter((item) => props.target.type === "directory" || !("directoryOnly" in item && item.directoryOnly)),
  )
  let trigger!: HTMLDivElement

  onMount(() => {
    const guard = (event: MouseEvent) =>
      setRowTarget(event.target instanceof Element && !!event.target.closest('[data-slot="file-tree-v2-row"]'))
    trigger.addEventListener("contextmenu", guard, true)
    onCleanup(() => trigger.removeEventListener("contextmenu", guard, true))
  })

  return (
    <MenuV2.Context gutter={4}>
      <MenuV2.Context.Trigger
        as="div"
        ref={trigger}
        class="contents"
        disabled={!rowTarget()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {props.children}
      </MenuV2.Context.Trigger>
      <MenuV2.Context.Portal>
        <MenuV2.Context.Content>
          <Show when={open.canOpen() && !props.target.deleted}>
            <MenuV2.Sub gutter={0}>
              <MenuV2.SubTrigger>{language.t("session.header.openIn")}</MenuV2.SubTrigger>
              <MenuV2.Portal>
                <MenuV2.SubContent>
                  <MenuV2.Item onSelect={() => open.openDir("finder")}>
                    <Show
                      when={props.target.type === "directory" && defaultOption()}
                      fallback={<span class="size-5 shrink-0" />}
                    >
                      {(item) => <AppIcon id={item().icon} class="size-5 shrink-0" />}
                    </Show>
                    {props.target.type === "directory"
                      ? defaultOption()?.label
                      : language.t("session.review.context.openDefault")}
                  </MenuV2.Item>
                  <For each={options()}>
                    {(item) => (
                      <MenuV2.Item onSelect={() => open.openDir(item.id)}>
                        <AppIcon id={item.icon} class="size-5 shrink-0" />
                        {item.label}
                      </MenuV2.Item>
                    )}
                  </For>
                </MenuV2.SubContent>
              </MenuV2.Portal>
            </MenuV2.Sub>
            <MenuV2.Separator />
          </Show>
          <MenuV2.Item onSelect={() => open.copyPath(props.target.path)}>
            {language.t("session.review.context.copyRelative")}
          </MenuV2.Item>
          <MenuV2.Item onSelect={() => open.copyPath(absolute())}>
            {language.t("session.review.context.copyAbsolute")}
          </MenuV2.Item>
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}
