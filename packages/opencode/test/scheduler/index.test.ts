import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Scheduler } from "../../src/scheduler"
import { SchedulerRunner } from "../../src/scheduler/runner"
import { SchedulerHeartbeat } from "../../src/scheduler/heartbeat"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Instance } from "@/project/instance"

afterEach(async () => {
  mock.restore()
  await Scheduler.stop()
})

describe("scheduler.index", () => {
  test("does not start when disabled", async () => {
    spyOn(InstanceRuntime, "load").mockResolvedValue({} as never)
    spyOn(InstanceRuntime, "disposeInstance").mockResolvedValue()
    spyOn(Instance, "restore").mockImplementation((_ctx, fn) => fn())
    spyOn(AppRuntime, "runPromise").mockResolvedValue({ scheduler: { enabled: false } } as never)
    const run = spyOn(SchedulerRunner, "start")
    const beat = spyOn(SchedulerHeartbeat, "start")

    await Scheduler.start(process.cwd())

    expect(run).not.toHaveBeenCalled()
    expect(beat).not.toHaveBeenCalled()
  })

  test("starts and stops when enabled", async () => {
    spyOn(InstanceRuntime, "load").mockResolvedValue({} as never)
    spyOn(InstanceRuntime, "disposeInstance").mockResolvedValue()
    spyOn(Instance, "restore").mockImplementation((_ctx, fn) => fn())
    spyOn(AppRuntime, "runPromise").mockResolvedValue({ scheduler: { enabled: true } } as never)
    const run = spyOn(SchedulerRunner, "start").mockResolvedValue()
    const beat = spyOn(SchedulerHeartbeat, "start").mockResolvedValue()
    const stopRun = spyOn(SchedulerRunner, "stop").mockResolvedValue()
    const stopBeat = spyOn(SchedulerHeartbeat, "stop").mockResolvedValue()

    await Scheduler.start(process.cwd())
    await Scheduler.stop()

    expect(run).toHaveBeenCalledTimes(1)
    expect(beat).toHaveBeenCalledTimes(1)
    expect(stopBeat).toHaveBeenCalledTimes(1)
    expect(stopRun).toHaveBeenCalledTimes(1)
  })
})
