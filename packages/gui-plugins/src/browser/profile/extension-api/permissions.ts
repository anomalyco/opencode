import { Schema } from "effect"
import { method, none, type ApiModule } from "./api"
import { coversPattern } from "./match-pattern"
import { declared } from "./tabs"

const Permissions = Schema.Struct({
  permissions: Schema.optional(Schema.Array(Schema.String)),
  origins: Schema.optional(Schema.Array(Schema.String)),
})

/** Whether an extension holds every permission and origin asked for: the ones its manifest requires. */
export function holds(
  granted: { readonly permissions: readonly string[]; readonly hosts: readonly string[] },
  request: typeof Permissions.Type,
) {
  return (
    (request.permissions ?? []).every((permission) => granted.permissions.includes(permission)) &&
    (request.origins ?? []).every((origin) => granted.hosts.some((host) => coversPattern(host, origin)))
  )
}

/**
 * `chrome.permissions`, answered from the manifest. An extension holds what its manifest requires and nothing more:
 * this browser grants no optional permission, so `request` answers `true` only for what it already holds, and
 * `remove` removes nothing.
 */
export function createPermissions(): ApiModule {
  return {
    namespaces: [
      {
        path: "permissions",
        methods: ["contains", "getAll", "request", "remove"],
        events: ["onAdded", "onRemoved"],
      },
    ],
    methods: {
      "permissions.getAll": method(none, (context) => {
        const granted = declared(context.extension)

        return { permissions: granted.permissions.filter((item) => !item.includes("://") && item !== "<all_urls>"), origins: granted.hosts }
      }),
      "permissions.contains": method(Schema.Tuple([Permissions]), (context, [request]) =>
        holds(declared(context.extension), request),
      ),
      "permissions.request": method(Schema.Tuple([Permissions]), (context, [request]) =>
        holds(declared(context.extension), request),
      ),
      "permissions.remove": method(Schema.Tuple([Permissions]), () => false),
    },
  }
}
