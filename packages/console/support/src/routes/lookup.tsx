import { Title } from "@solidjs/meta"
import { query, useSearchParams, type RouteDefinition } from "@solidjs/router"
import { createMemo, Errored, Loading, Show } from "solid-js"
import { Result } from "~/component/result"
import { lookup } from "~/lib/lookup"

const getLookup = query(async (identifier: string) => {
  "use server"
  return lookup(identifier)
}, "support.lookup")

export const route: RouteDefinition = {
  preload: ({ location }) => {
    const identifier = new URLSearchParams(location.search).get("identifier")?.trim()
    if (identifier) void getLookup(identifier)
  },
}

export default function LookupPage() {
  const [params] = useSearchParams()
  const identifier = () => String(params.identifier ?? "").trim()
  const data = createMemo(() => (identifier() ? getLookup(identifier()) : undefined))

  return (
    <main data-page="support">
      <Title>opencode support — {identifier() || "lookup"}</Title>
      <h1>Lookup: {identifier() || "(no identifier)"}</h1>

      <Show when={identifier()} fallback={<div data-empty>Provide an `identifier` query parameter.</div>}>
        <Errored fallback={(err) => <div data-component="error">{(err() as Error).message}</div>}>
          <Loading fallback={<div data-empty>Loading...</div>}>
            <Show when={data()}>{(result) => <Result data={result()} />}</Show>
          </Loading>
        </Errored>
      </Show>
    </main>
  )
}
