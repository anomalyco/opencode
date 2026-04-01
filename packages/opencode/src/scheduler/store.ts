import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Job } from "./job"

export { Job } from "./job"

export namespace JobStore {
  const log = Log.create({ service: "job-store" })

  function key(id: string, projectID: string): string[] {
    return ["job", projectID, id]
  }

  export async function save(job: Job.Job): Promise<void> {
    log.debug("saving job", { id: job.id, projectID: job.projectID })
    await Storage.write(key(job.id, job.projectID), job)
  }

  export async function get(id: string, projectID: string): Promise<Job.Job | null> {
    log.debug("getting job", { id, projectID })
    try {
      const job = await Storage.read<Job.Job>(key(id, projectID))
      return job
    } catch (e) {
      if (e instanceof Storage.NotFoundError) {
        return null
      }
      throw e
    }
  }

  export async function list(projectID: string): Promise<Job.Job[]> {
    log.debug("listing jobs", { projectID })
    const keys = await Storage.list(["job", projectID])
    const jobs: Job.Job[] = []
    for (const k of keys) {
      try {
        const job = await Storage.read<Job.Job>(k)
        jobs.push(job)
      } catch (e) {
        log.error("failed to read job", { key: k, error: e })
      }
    }
    return jobs
  }

  export async function listEnabled(projectID: string): Promise<Job.Job[]> {
    log.debug("listing enabled jobs", { projectID })
    const jobs = await list(projectID)
    return jobs.filter((job) => job.enabled)
  }

  export async function remove(id: string, projectID: string): Promise<boolean> {
    log.debug("removing job", { id, projectID })
    try {
      await Storage.remove(key(id, projectID))
      return true
    } catch (e) {
      if (e instanceof Storage.NotFoundError) {
        return false
      }
      throw e
    }
  }

  export async function update(job: Job.Job): Promise<void> {
    log.debug("updating job", { id: job.id, projectID: job.projectID })
    await Storage.write(key(job.id, job.projectID), job)
  }
}
