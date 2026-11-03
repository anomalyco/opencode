import { HISTORY_SCHEDULE, instanceId, recentInstanceIds, skipReason, type StatsSyncParams } from "./schedule"

type Env = { StatsSyncWorkflow: Workflow<StatsSyncParams> }

export default {
  async scheduled(controller: ScheduledController, env: Env) {
    const scheduledAt = new Date(controller.scheduledTime)
    const history = controller.cron === HISTORY_SCHEDULE
    const id = instanceId(scheduledAt, history)
    const instances = await Promise.all(
      recentInstanceIds(scheduledAt, history).map(async (item) => ({
        id: item,
        // get() rejects for an ID that was never created.
        status: await env.StatsSyncWorkflow.get(item).then(
          (instance) => instance.status().then((value) => value.status),
          () => undefined,
        ),
      })),
    )
    const skip = skipReason(id, instances)
    if (skip) {
      console.log(`stats sync skipped ${JSON.stringify({ id, ...skip })}`)
      return
    }
    await env.StatsSyncWorkflow.create({ id, params: { history, startedAt: scheduledAt.toISOString() } })
    console.log(`stats sync started ${JSON.stringify({ id, history })}`)
  },
}
