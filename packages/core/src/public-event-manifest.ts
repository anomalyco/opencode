export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@opencode-ai/schema/event"
import { Catalog } from "./catalog"
import { FileSystem } from "./filesystem"
import { Watcher } from "./filesystem/watcher"
import { Integration } from "./integration"
import { ModelsDev } from "./models-dev"
import { PermissionV2 } from "./permission"
import { PluginV2 } from "./plugin"
import { ProjectCopy } from "./project/copy"
import { Pty } from "./pty"
import { QuestionV2 } from "./question"
import { Reference } from "./reference"
import { EventManifest } from "./event-manifest"
import { SessionTodo } from "./session/todo"

export const FoundationDefinitions = Event.inventory(
  ModelsDev.Event.Refreshed,
  Integration.Event.Updated,
  Integration.Event.ConnectionUpdated,
  Catalog.Event.Updated,
  ...EventManifest.Definitions,
)

export const FeatureDefinitions = Event.inventory(
  FileSystem.Event.Edited,
  Reference.Event.Updated,
  PermissionV2.Event.Asked,
  PermissionV2.Event.Replied,
  PluginV2.Event.Added,
  ProjectCopy.Event.Updated,
  Watcher.Event.Updated,
  Pty.Event.Created,
  Pty.Event.Updated,
  Pty.Event.Exited,
  Pty.Event.Deleted,
  QuestionV2.Event.Asked,
  QuestionV2.Event.Replied,
  QuestionV2.Event.Rejected,
)

export const TodoDefinitions = Event.inventory(SessionTodo.Event.Updated)

export const Definitions = Event.inventory(...FoundationDefinitions, ...FeatureDefinitions, ...TodoDefinitions)

export const Latest = Event.latest(Definitions)
export const Durable = Event.durable(Definitions)
