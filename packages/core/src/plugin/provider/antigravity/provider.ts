export * as AntigravityProvider from "./provider.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema } from "effect"
import { Provider } from "../../../provider.js"
import { AntigravityCatalog } from "./antigravity/catalog.js"

export const ID = AntigravityCatalog.ID
export const PACKAGE = "@opencode/antigravity"

/**
 * The model list is kept between starts, so opencode can list the models
 * without running the CLI.
 */
const CatalogModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.String,
  variants: Schema.Array(Schema.Struct({ id: Schema.String, slug: Schema.String, name: Schema.String })),
})
type CatalogModel = typeof CatalogModel.Type
const Catalog = Schema.Struct({ models: Schema.Array(CatalogModel) })
type Catalog = typeof Catalog.Type
const CATALOG_KEY = "models"

/**
 * The models come from the account, so a model Google adds shows up without a
 * change here. Transforms are replayed on every reload, so this one reads the
 * current list instead of capturing it.
 */
export const register = Effect.fn("AntigravityProvider.register")(function* (
  ctx: Context,
  groups: () => readonly AntigravityCatalog.Group[],
) {
  yield* ctx.provider.transform((editor) => {
    if (editor.get(ID)) return
    editor.add({
      info: {
        id: ID,
        name: "Google Antigravity",
        activation: "auto",
        package: Provider.aisdk(PACKAGE),
      },
      models: groups().map((group) => AntigravityCatalog.toModel(group)),
    })
  })
})

export const cached = Effect.fn("AntigravityProvider.cached")(function* (ctx: Context) {
  const saved = Schema.decodeUnknownOption(Catalog)(yield* ctx.storage.get(CATALOG_KEY))
  return Option.getOrElse(saved, (): Catalog => ({ models: [] })).models
})

export const remember = Effect.fn("AntigravityProvider.remember")(function* (
  ctx: Context,
  groups: readonly AntigravityCatalog.Group[],
) {
  const catalog: Catalog = {
    models: groups.map((group) => ({
      id: group.id,
      name: group.name,
      family: group.family,
      variants: group.variants.map((variant) => ({
        id: variant.id,
        slug: variant.slug,
        name: variant.name,
      })),
    })),
  }
  yield* ctx.storage.set(CATALOG_KEY, catalog)
})

export const groups = (models: readonly CatalogModel[]): AntigravityCatalog.Group[] =>
  models.map((model) => ({
    id: model.id,
    name: model.name,
    family: model.family,
    variants: model.variants.map((variant) => ({
      id: variant.id,
      slug: variant.slug,
      name: variant.name,
    })),
  }))
