import type { Component } from "solid-js"
import { NewComposer } from "./new-composer"
import type { NewComposerProps } from "./new-composer"

/**
 * Composer Island is now backed by `NewComposer`.
 *
 * This keeps the existing import path (`@opencode-ai/ui/composer-island`) stable
 * while using the split/runtime-ready architecture under the hood.
 */
export type ComposerIslandProps = NewComposerProps

export const ComposerIsland: Component<ComposerIslandProps> = (props) => {
  return <NewComposer {...props} />
}

export type {
  AtOption,
  ComposerMode,
  ComposerPart,
  ComposerRuntime,
  ComposerSource,
  ComposerSubmit,
  ContextItem,
  ImageAttachment,
  SlashCommand,
  TodoItem,
} from "./new-composer/types"
