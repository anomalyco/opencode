import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { AbsolutePath } from "@opencode/schema/schema"
import { Effect } from "effect"
import path from "path"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("Effect plugins preserve explicit child placement and inherit the parent's location when omitted", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins, "test")
    const tmp = yield* tmpdirScoped()
    const parent = yield* context.session.create({ location: { directory: AbsolutePath.make(tmp.path) } })
    const inherited = yield* context.session.create({ parentID: parent.id })
    const explicit = yield* context.session.create({ parentID: parent.id, location: context.location })

    expect(parent.location.directory).not.toBe(context.location.directory)
    expect(inherited.location).toEqual(parent.location)
    expect(explicit.location.directory).toBe(context.location.directory)
    expect(explicit.parentID).toBe(parent.id)
  }),
)

it.live("Promise plugins forward and canonicalize an explicit child location", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins, "test")
    const tmp = yield* tmpdirScoped()
    yield* PluginPromise.fromPromise({
      id: "test.session-create",
      async setup(ctx) {
        const parent = await ctx.session.create()
        const child = await ctx.session.create({
          parentID: parent.id,
          location: { directory: `${tmp.path}${path.sep}` },
        })
        expect(child).toMatchObject({ parentID: parent.id, location: { directory: tmp.path } })
        expect((await ctx.session.create({ parentID: child.id })).location).toEqual(child.location)
      },
    }).effect(context)
  }),
)
