import { Context } from "effect"
import { HttpApi, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { SchemaErrorMiddleware } from "./middleware/schema-error"
import { MessageGroup } from "./groups/message"
import { ModelGroup } from "./groups/model"
import { ProviderGroup } from "./groups/provider"
import { makeSessionGroup } from "./groups/session"
import { makePermissionGroup } from "./groups/permission"
import { FileSystemGroup } from "./groups/fs"
import { CommandGroup } from "./groups/command"
import { SkillGroup } from "./groups/skill"
import { EventGroup, makeEventGroup } from "./groups/event"
import type { Definition } from "@bolt-ai/schema/event"
import { AgentGroup } from "./groups/agent"
import { HealthGroup } from "./groups/health"
import { PtyGroup } from "./groups/pty"
import { makeQuestionGroup } from "./groups/question"
import { ReferenceGroup } from "./groups/reference"
import { Authorization } from "./middleware/authorization"
import { LocationGroup } from "./groups/location"
import { IntegrationGroup } from "./groups/integration"
import { CredentialGroup } from "./groups/credential"
import { ProjectCopyGroup } from "./groups/project-copy"

// Protocol owns middleware placement, while Server injects concrete keys so Core service identities stay downstream.
const makeApiFromGroup = <
  const Group extends HttpApiGroup.Constraint,
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  FormLocationId extends HttpApiMiddleware.AnyId,
  FormLocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(
  eventGroup: Group,
  locationMiddleware: Context.Key<LocationId, LocationService>,
  formLocationMiddleware: Context.Key<FormLocationId, FormLocationService>,
  sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>,
): Api<
  LocationId,
  LocationService,
  FormLocationId,
  FormLocationService,
  SessionLocationId,
  SessionLocationService,
  Group
> =>
  HttpApi.make("server")
    .add(ServerGroup)
    .add(makeLocationGroup(locationMiddleware))
    .add(AgentGroup.middleware(locationMiddleware))
    .add(PluginGroup.middleware(locationMiddleware))
    .add(makeSessionGroup(sessionLocationMiddleware, formLocationMiddleware))
    .add(MessageGroup)
    .add(ModelGroup.middleware(locationMiddleware))
    .add(GenerateGroup)
    .add(VoiceGroup)
    .add(ProviderGroup.middleware(locationMiddleware))
    .add(IntegrationGroup.middleware(locationMiddleware))
    .add(makeMcpGroup(locationMiddleware))
    .add(CredentialGroup)
    .add(ProjectGroup)
    .add(makeFormGroup(locationMiddleware))
    .add(makePermissionGroup(locationMiddleware, sessionLocationMiddleware))
    .add(FileSystemGroup.middleware(locationMiddleware))
    .add(CommandGroup.middleware(locationMiddleware))
    .add(SkillGroup.middleware(locationMiddleware))
    .add(RpcGroup.middleware(locationMiddleware))
    .add(eventGroup)
    .add(makePtyGroup(locationMiddleware))
    .add(PersistentPtyGroup)
    .add(ShellGroup.middleware(locationMiddleware))
    .add(ReferenceGroup.middleware(locationMiddleware))
    .add(WorktreeGroup)
    .add(VcsGroup.middleware(locationMiddleware))
    .add(DebugGroup)
    .add(MigrationGroup)
    .add(WebSearchGroup.middleware(locationMiddleware))
    .add(UsageGroup.middleware(locationMiddleware))
    .add(ConfigGroup.middleware(locationMiddleware))
    .annotateMerge(
      OpenApi.annotations({
        title: "bolt HttpApi",
        version: "0.0.1",
        description: "Experimental HttpApi surface for selected instance routes.",
      }),
    )
    .middleware(Authorization)
    .middleware(SchemaErrorMiddleware)

export const makeApi = <
  const Definitions extends ReadonlyArray<Definition>,
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  FormLocationId extends HttpApiMiddleware.AnyId,
  FormLocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(options: {
  readonly definitions: Definitions
  readonly locationMiddleware: Context.Key<LocationId, LocationService>
  readonly formLocationMiddleware: Context.Key<FormLocationId, FormLocationService>
  readonly sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>
}): Api<
  LocationId,
  LocationService,
  FormLocationId,
  FormLocationService,
  SessionLocationId,
  SessionLocationService,
  EventGroupFor<Definitions>
> =>
  makeApiFromGroup(
    makeEventGroup(options.definitions),
    options.locationMiddleware,
    options.formLocationMiddleware,
    options.sessionLocationMiddleware,
  )

export const makeDefaultApi = <
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  FormLocationId extends HttpApiMiddleware.AnyId,
  FormLocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(options: {
  readonly locationMiddleware: Context.Key<LocationId, LocationService>
  readonly formLocationMiddleware: Context.Key<FormLocationId, FormLocationService>
  readonly sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>
}): Api<
  LocationId,
  LocationService,
  FormLocationId,
  FormLocationService,
  SessionLocationId,
  SessionLocationService,
  typeof EventGroup
> =>
  makeApiFromGroup(
    EventGroup,
    options.locationMiddleware,
    options.formLocationMiddleware,
    options.sessionLocationMiddleware,
  )
