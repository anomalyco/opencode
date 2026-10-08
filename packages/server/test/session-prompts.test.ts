import { expect } from "bun:test"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { ModelsDev } from "@opencode/core/models-dev"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Instance } from "@opencode/core/instance"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Form } from "@opencode/core/form"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Context, Deferred, Duration, Effect, Fiber, Layer, LayerMap, Option, RcMap } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createEmbeddedRoutes } from "../src/routes"
import { cachedLocation } from "../src/location"

it.live(
  "reads pending session prompts without booting cold locations",
  () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const location = LocationServiceMap.canonical(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))
      const lookups: Location.Ref[] = []
      const closed: Location.Ref[] = []
      const replacements: LayerNode.Replacements = [
        Global.node.replace(tempGlobalLayer),
        App.node.replace(App.node),
        Bus.node.replace(Bus.node),
        Database.node.replace(Database.node),
        ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
        Watcher.node.replace(Watcher.configured({ enabled: false })),
        LocationServiceMap.node.replace(
          Layer.effect(
            LocationServiceMap.Service,
            Effect.gen(function* () {
              const map = yield* LayerMap.make(
                (ref: Location.Ref) => {
                  lookups.push(ref)
                  return Layer.merge(
                    Instance.layer(ref, { discovery: false, replacements: bindings }),
                    Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(() => closed.push(ref)))),
                  )
                },
                { idleTimeToLive: Duration.infinity },
              )
              const bindings: LayerNode.Replacements = [
                ...replacements,
                Instance.node.replace(
                  Layer.succeed(Instance.Service, {
                    provide: (session) => Effect.provide(map.get(session.location)),
                    provideCached: (session) => Instance.cached(map, LocationServiceMap.canonical(session.location)),
                  }),
                ),
                LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
              ]
              return map
            }),
          ),
        ),
      ]
      const context = yield* Layer.build(
        createEmbeddedRoutes(
          { database: { path: ":memory:" }, models: { fetch: false }, fs: { filewatcher: false } },
          replacements,
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const sessions = Context.get(context, Session.Service)
      const locations = Context.get(context, LocationServiceMap.Service)
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const read = (route: string, status = 200) =>
        Effect.promise(async () => {
          const response = await handler(new Request(`http://opencode.local${route}`))
          expect(response.status).toBe(status)
          return await response.json()
        })
      const session = yield* sessions.create({ location, permissions: [{ action: "*", resource: "*", effect: "ask" }] })
      const global = `/api/session/global/form?location[directory]=${encodeURIComponent(location.directory)}`
      for (const resource of ["form", "permission"]) {
        expect(yield* read(`/api/session/${session.id}/${resource}`)).toEqual({ data: [] })
        expect(lookups).toEqual([])
        expect(yield* read(`/api/session/${Session.ID.create()}/${resource}`, 404)).toMatchObject({
          _tag: "SessionNotFoundError",
        })
        expect(lookups).toEqual([])
      }
      expect(yield* read(global)).toEqual({ data: [] })
      expect(lookups).toEqual([])
      const pending = yield* Effect.gen(function* () {
        const forms = yield* Form.Service
        const permissions = yield* Permission.Service
        const form = yield* forms.create({
          sessionID: session.id,
          title: "Session",
          fields: [{ key: "answer", type: "string" }],
        })
        const globalForm = yield* forms.create({
          sessionID: "global",
          title: "Global",
          fields: [{ key: "answer", type: "string" }],
        })
        const permission = { id: Permission.ID.create(), sessionID: session.id, action: "read", resources: ["file"] }
        expect(yield* permissions.ask(permission)).toEqual({ id: permission.id, effect: "ask" })
        return { form, globalForm, permission }
      }).pipe(Effect.provide(locations.get(location)))
      expect(yield* read(`/api/session/${session.id}/form`)).toEqual({ data: [pending.form] })
      expect(yield* read(`/api/session/${session.id}/permission`)).toEqual({ data: [pending.permission] })
      expect(yield* read(global)).toEqual({ data: [pending.globalForm] })
      expect(lookups).toEqual([location])
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([location])
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const reading = yield* cachedLocation(
        locations,
        location,
        Effect.gen(function* () {
          const forms = yield* Form.Service
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          return yield* forms.list({ sessionID: session.id })
        }),
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* locations.invalidate(location)
      expect(closed).toEqual([])
      expect(lookups).toEqual([location])
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(reading)).toEqual(Option.some([pending.form]))
      expect(closed).toEqual([location])
    }),
  15_000,
)
