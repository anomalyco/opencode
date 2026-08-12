import type { CatalogDefinition } from "../dsl"
import { flowGroups } from "./flows"
import { screens } from "./screens"
import { taxonomies } from "./taxonomies"

export const definition = {
  taxonomies,
  screens,
  flowGroups,
} satisfies CatalogDefinition
