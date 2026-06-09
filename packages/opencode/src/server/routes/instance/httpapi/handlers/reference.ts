import { Reference } from "@/reference/reference"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const referenceHandlers = HttpApiBuilder.group(InstanceHttpApi, "reference", (handlers) =>
  Effect.gen(function* () {
    const reference = yield* Reference.Service

    return handlers.handle("list", () =>
      reference.list().pipe(
        Effect.map((references) =>
          references.map((item) => {
            if (item.kind !== "git") return item
            return {
              name: item.name,
              kind: item.kind,
              repository: item.repository,
              path: item.path,
              ...(item.branch !== undefined ? { branch: item.branch } : {}),
            }
          }),
        ),
      ),
    )
  }),
)
