import type { ServerEndpoint } from "@opencode/plugin/gui/main"
import { artifactAddress, artifactResource, artifactViewPath } from "./artifact-link"
import type { createPreviews } from "./profile/previews"
import { FileVerificationError } from "@opencode/util/file-verification"

/** One tab's grants, allocated only by a deliberate load/restore, never by an incoming protocol request. */
export function artifactPages(
  previews: ReturnType<typeof createPreviews>,
  server: ServerEndpoint,
  directory: string,
  lifetime: AbortSignal,
) {
  const grants = new Map<string, ReturnType<typeof previews.grant>>()

  const read = (route: string, method: string, signal: AbortSignal) => {
    const url = new URL(`${server.url.replace(/\/+$/, "")}${route}`)
    url.searchParams.set("location[directory]", directory)

    return fetch(url, {
      headers: server.headers,
      redirect: "error",
      method,
      signal: AbortSignal.any([signal, lifetime]),
    }).then((response) => FileVerificationError.check(response))
  }

  return {
    load(address: string) {
      const item = artifactAddress(address)

      if (!item) return
      const grant = grants.get(item.id) ?? previews.grant({ type: "artifact", id: item.id, read }, lifetime)
      grants.set(item.id, grant)

      return `oc-preview://${grant.host}/${item.path}`
    },
    display(url: string) {
      if (!url.startsWith("oc-preview:")) return

      for (const [id, grant] of grants) {
        const resource = artifactResource(url, grant.host, id)

        if (resource) return resource.display
      }
    },
    async exists(url: string) {
      const item = artifactAddress(url)

      // Before opening a tab this also checks a link received in chat, without issuing a grant.
      if (!item) return false

      return read(artifactViewPath(item), "HEAD", AbortSignal.timeout(15_000)).then(
        (r) => r.status === 200,
        (error) => FileVerificationError.orMissing(error) ?? false,
      )
    },
    dispose() {
      grants.forEach((grant) => grant.release())
      grants.clear()
    },
  }
}
