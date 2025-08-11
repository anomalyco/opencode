import { renderToStringAsync } from "solid-js/web"
import { App } from "./app"

export async function render(props: { url: string }) {
  const app = await renderToStringAsync(() => <App url={props.url} />)
  return { app }
}
