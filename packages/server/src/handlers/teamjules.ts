import { Effect } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "@effect/schema";
import { TaskDispatcher } from "../../core/src/teamjules/dispatcher";

// 1. Define the Schema for the API Response
export const PigeonMeshResponse = Schema.Struct({
  taskId: Schema.String,
  pigeonInviteUrl: Schema.String,
});

// 2. Define the Protocol / API Group
export class TeamJulesApi extends HttpApiGroup.make("teamjules")
  .add(
    HttpApiEndpoint.get("getMeshCapability", "/api/v1/tasks/:taskId/mesh-capability")
      .addSuccess(PigeonMeshResponse)
      .addError(Schema.Struct({ error: Schema.String }), { status: 404 })
      .addError(Schema.Struct({ error: Schema.String }), { status: 400 })
      .addError(Schema.Struct({ error: Schema.String }), { status: 503 })
  ) {}

// 3. Define the Server Handler Implementation
export const makeTeamJulesHandler = (dispatcher: TaskDispatcher) =>
  HttpApiGroup.implement(TeamJulesApi, {
    getMeshCapability: ({ path }) =>
      Effect.gen(function* () {
        const taskId = path.taskId;
        const state = dispatcher.getTaskState(taskId);

        // TODO: In a real implementation, inject auth context here and verify 
        // the user is authorized to observe this specific task.

        if (!state) {
          return yield* Effect.fail({ error: "Task not found." });
        }

        if (state.status !== "running") {
          return yield* Effect.fail({ error: `Task is ${state.status}, mesh is not active.` });
        }

        if (!state.pigeonInviteUrl) {
          return yield* Effect.fail({ error: "GitPigeon mesh is still initializing." });
        }

        return {
          taskId,
          pigeonInviteUrl: state.pigeonInviteUrl,
        };
      }),
  });
