import { Match, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { pathFromGitDiffTab } from "@/components/git-changes"

export function GitDiffTabContent(props: { tab: string }) {
  const sdk = useSDK()
  const language = useLanguage()
  const fileComponent = useFileComponent()

  const path = createMemo(() => pathFromGitDiffTab(props.tab))

  const [before, setBefore] = createSignal<string | undefined>(undefined)
  const [after, setAfter] = createSignal<string | undefined>(undefined)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const encodedDirectory = encodeURIComponent(sdk.directory)

  async function fetchShow(filePath: string): Promise<string> {
    const res = await fetch(`${sdk.url}/vcs/show?file=${encodeURIComponent(filePath)}`, {
      headers: {
        "Content-Type": "application/json",
        "x-opencode-directory": encodedDirectory,
        ...sdk.authHeaders,
      },
    })
    if (!res.ok) return ""
    const data = await res.json()
    return data.content ?? ""
  }

  createEffect(() => {
    const p = path()
    if (!p) return

    setLoading(true)
    setError(undefined)

    const aborted = { current: false }
    onCleanup(() => {
      aborted.current = true
    })

    Promise.all([
      fetchShow(p),
      sdk.client.file
        .read({ path: p })
        .then((r) => r.data?.content ?? "")
        .catch(() => ""),
    ])
      .then(([headContent, currentContent]) => {
        if (aborted.current) return
        setBefore(headContent)
        setAfter(currentContent)
        setLoading(false)
      })
      .catch((err) => {
        if (aborted.current) return
        setError(String(err))
        setLoading(false)
      })
  })

  return (
    <Tabs.Content value={props.tab} class="mt-3 relative h-full">
      <ScrollView class="h-full">
        <Switch>
          <Match when={loading()}>
            <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
          </Match>
          <Match when={error()}>
            {(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}
          </Match>
          <Match when={before() !== undefined && after() !== undefined}>
            <div class="relative overflow-hidden pb-40">
              <Dynamic
                component={fileComponent}
                mode="diff"
                diffStyle="unified"
                before={{
                  name: path() ?? "",
                  contents: before()!,
                }}
                after={{
                  name: path() ?? "",
                  contents: after()!,
                }}
                overflow="scroll"
                class="select-text"
              />
            </div>
          </Match>
        </Switch>
      </ScrollView>
    </Tabs.Content>
  )
}
