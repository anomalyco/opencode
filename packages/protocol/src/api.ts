import { Context } from "effect"
import { HttpApi, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { SchemaErrorMiddleware } from "./middleware/schema-error"
import { GenerateGroup } from "./groups/generate"
import { MessageGroup } from "./groups/message"
import { ModelGroup } from "./groups/model"
import { ProviderGroup } from "./groups/provider"
import { makeSessionGroup } from "./groups/session"
import { makePermissionGroup } from "./groups/permission"
import { FileSystemGroup } from "./groups/fs"
import { CommandGroup } from "./groups/command"
import { SkillGroup } from "./groups/skill"
import { EventGroup, makeEventGroup } from "./groups/event"
import type { Definition } from "@opencode-ai/schema/event"
import { AgentGroup } from "./groups/agent"
import { HealthGroup } from "./groups/health"
import { PtyGroup } from "./groups/pty"
import { ShellGroup } from "./groups/shell"
import { makeQuestionGroup } from "./groups/question"
import { ReferenceGroup } from "./groups/reference"
import { Authorization } from "./middleware/authorization"
import { LocationGroup } from "./groups/location"
import { IntegrationGroup } from "./groups/integration"
import { McpGroup } from "./groups/mcp"
import { CredentialGroup } from "./groups/credential"
import { ProjectGroup } from "./groups/project"
import { ProjectCopyGroup } from "./groups/project-copy"

// Protocol owns middleware placement, while Server injects concrete keys so Core service identities stay downstream.
const makeApiFromGroup = <
  const Group extends HttpApiGroup.Any,
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(
  eventGroup: Group,
  locationMiddleware: Context.Key<LocationId, LocationService>,
  sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>,
) =>
  HttpApi.make("server")
    .add(HealthGroup)
    .add(LocationGroup.middleware(locationMiddleware))
    .add(AgentGroup.middleware(locationMiddleware))
    .add(makeSessionGroup(sessionLocationMiddleware))
    .add(MessageGroup.middleware(sessionLocationMiddleware))
    .add(ModelGroup.middleware(locationMiddleware))
    .add(GenerateGroup.middleware(locationMiddleware))
    .add(ProviderGroup.middleware(locationMiddleware))
    .add(IntegrationGroup.middleware(locationMiddleware))
    .add(McpGroup.middleware(locationMiddleware))
    .add(CredentialGroup.middleware(locationMiddleware))
    .add(ProjectGroup.middleware(locationMiddleware))
    .add(makePermissionGroup(locationMiddleware, sessionLocationMiddleware))
    .add(FileSystemGroup.middleware(locationMiddleware))
    .add(CommandGroup.middleware(locationMiddleware))
    .add(SkillGroup.middleware(locationMiddleware))
    .add(eventGroup)
    .add(PtyGroup.middleware(locationMiddleware))
    .add(ShellGroup.middleware(locationMiddleware))
    .add(makeQuestionGroup(locationMiddleware, sessionLocationMiddleware))
    .add(ReferenceGroup.middleware(locationMiddleware))
    .add(ProjectCopyGroup.middleware(locationMiddleware))
    .annotateMerge(
      OpenApi.annotations({
        title: "opencode HttpApi",
        version: "0.0.1",
        description: "Experimental HttpApi surface for selected instance routes.",
      }),
    )
    .middleware(Authorization)
    .middleware(SchemaErrorMiddleware)

export const makeApi = <
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(options: {
  readonly definitions: ReadonlyArray<Definition>
  readonly locationMiddleware: Context.Key<LocationId, LocationService>
  readonly sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>
}) =>
  makeApiFromGroup(makeEventGroup(options.definitions), options.locationMiddleware, options.sessionLocationMiddleware)

export const makeDefaultApi = <
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(options: {
  readonly locationMiddleware: Context.Key<LocationId, LocationService>
  readonly sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>
}) => makeApiFromGroup(EventGroup, options.locationMiddleware, options.sessionLocationMiddleware)
