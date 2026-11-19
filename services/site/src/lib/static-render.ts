import { getRequestEvent } from "solid-js/web"

/** Whether the Worker is rendering a static page (src/static/render.tsx), which never hydrates. */
export function staticRender() {
  return import.meta.env.SSR && !!getRequestEvent()?.locals.staticPass
}
