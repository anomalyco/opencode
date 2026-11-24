import {
  HISTORY_SCHEDULE,
  instanceId,
  isWorkflowError,
  recentInstanceIds,
  skipReason,
  type DataSyncParams,
} from "./schedule"

type Env = { DataSyncWorkflow: Workflow<DataSyncParams> }

export default {
  async scheduled(controller: ScheduledController, env: Env) {
    const scheduledAt = new Date(controller.scheduledTime)
    const history = controller.cron === HISTORY_SCHEDULE
    const id = instanceId(scheduledAt, history)
    // Any lookup failure other than a missing instance fails the tick, so an
    // unreadable status never starts a duplicate run.
    const instances = await Promise.all(
      recentInstanceIds(scheduledAt, history).map(async (item) => ({
        id: item,
        status: await env.DataSyncWorkflow.get(item)
          .then((instance) => instance.status())
          .then((value) => value.status)
          .catch((error) => {
            if (isWorkflowError(error, "instance.not_found")) return undefined
            throw error
          }),
      })),
    )
    const skip = skipReason(id, instances)
    if (skip) {
      console.log(`data sync skipped ${JSON.stringify({ id, ...skip })}`)
      return
    }
    // Cron delivery is at least once, so a second tick for this slot can get here too.
    const created = await env.DataSyncWorkflow.create({
      id,
      params: { history, startedAt: scheduledAt.toISOString() },
    }).then(
      () => true,
      (error) => {
        if (isWorkflowError(error, "instance.already_exists")) return false
        throw error
      },
    )
    if (!created) {
      console.log(`data sync skipped ${JSON.stringify({ id, reason: "already created" })}`)
      return
    }
    console.log(`data sync started ${JSON.stringify({ id, history })}`)
  },
}
