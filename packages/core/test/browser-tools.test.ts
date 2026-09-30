import { expect } from "bun:test"
import { Context, Effect, Fiber, Schedule } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Session.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

it.live(
  "registers browser tools only for the attached Session and removes them on detach",
  () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
      const locations = yield* LocationServiceMap.Service
      const context = yield* locations.contextEffect(ref)
      yield* Plugin.awaitActivation.pipe(Effect.provideContext(context))
      const sessions = yield* Session.Service
      const attached = yield* sessions.create({ location: ref })
      const other = yield* sessions.create({ location: ref })
      const registry = Context.get(context, Tool.Service)
      const namespaces = (sessionID: Session.ID) =>
        registry
          .snapshot(undefined, sessionID)
          .pipe(Effect.map((snapshot) => snapshot.codeModeCatalog?.tools.map((entry) => entry.name) ?? []))
      expect(yield* namespaces(attached.id)).not.toContain("browser")

      const rpc = Context.get(context, Rpc.Service).client(Browser.Definition)
      const attachment = { sessionID: attached.id, connectionID: crypto.randomUUID() }
      const pending = yield* rpc.attach({ ...attachment, version: 4 }).pipe(Effect.forkScoped)
      yield* namespaces(attached.id).pipe(
        Effect.repeat({ until: (names) => names.includes("browser"), schedule: Schedule.spaced("10 millis") }),
        Effect.timeout("5 seconds"),
      )
      expect(yield* namespaces(other.id)).not.toContain("browser")
      expect((yield* registry.list()).some((tool) => tool.options?.namespace === "browser")).toBe(false)

      yield* Fiber.interrupt(pending)
      expect(yield* namespaces(attached.id)).not.toContain("browser")
    }),
  30_000,
)
