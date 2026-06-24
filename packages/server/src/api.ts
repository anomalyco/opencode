import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { SchemaErrorMiddleware } from "./middleware/schema-error"
import { MessageGroup } from "./groups/message"
import { ModelGroup } from "./groups/model"
import { ProviderGroup } from "./groups/provider"
import { SessionGroup } from "./groups/session"
import { PermissionGroup } from "./groups/permission"
import { FileSystemGroup } from "./groups/fs"
import { CommandGroup } from "./groups/command"
import { SkillGroup } from "./groups/skill"
import { makeEventGroup } from "./groups/event"
import type { Definition } from "@opencode-ai/schema/event"
import { PublicEventManifest } from "@opencode-ai/core/public-event-manifest"
import { AgentGroup } from "./groups/agent"
import { HealthGroup } from "./groups/health"
import { PtyGroup } from "./groups/pty"
import { QuestionGroup } from "./groups/question"
import { ReferenceGroup } from "./groups/reference"
import { Authorization } from "./middleware/authorization"
import { LocationGroup } from "./groups/location"
import { IntegrationGroup } from "./groups/integration"
import { CredentialGroup } from "./groups/credential"
import { ProjectCopyGroup } from "./groups/project-copy"

export const makeApi = (definitions: ReadonlyArray<Definition>) =>
  HttpApi.make("server")
    .add(HealthGroup)
    .add(LocationGroup)
    .add(AgentGroup)
    .add(SessionGroup)
    .add(MessageGroup)
    .add(ModelGroup)
    .add(ProviderGroup)
    .add(IntegrationGroup)
    .add(CredentialGroup)
    .add(PermissionGroup)
    .add(FileSystemGroup)
    .add(CommandGroup)
    .add(SkillGroup)
    .add(makeEventGroup(definitions))
    .add(PtyGroup)
    .add(QuestionGroup)
    .add(ReferenceGroup)
    .add(ProjectCopyGroup)
    .annotateMerge(
      OpenApi.annotations({
        title: "opencode HttpApi",
        version: "0.0.1",
        description: "Experimental HttpApi surface for selected instance routes.",
      }),
    )
    .middleware(Authorization)
    .middleware(SchemaErrorMiddleware)

export const Api = makeApi(PublicEventManifest.Latest.values().toArray())
