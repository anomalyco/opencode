import { Sandbox } from "./provider"

interface KubernetesClient {
  namespace: string
  createPod(spec: PodSpec): Promise<Pod>
  getPod(name: string): Promise<Pod | null>
  deletePod(name: string): Promise<void>
  listPods(selector?: Record<string, string>): Promise<Pod[]>
  exec(podName: string, container: string, command: string[]): Promise<ExecResult>
  copyToPod(podName: string, container: string, localPath: string, remotePath: string): Promise<void>
  copyFromPod(podName: string, container: string, remotePath: string, localPath: string): Promise<void>
}

interface PodSpec {
  metadata: {
    name: string
    labels?: Record<string, string>
  }
  spec: {
    containers: Array<{
      name: string
      image: string
      command?: string[]
      workingDir?: string
      env?: Array<{ name: string; value: string }>
      resources?: {
        requests?: { cpu?: string; memory?: string }
        limits?: { cpu?: string; memory?: string }
      }
    }>
    restartPolicy?: "Always" | "OnFailure" | "Never"
  }
}

interface Pod {
  metadata: {
    name: string
    uid: string
    labels?: Record<string, string>
  }
  status: {
    phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown"
  }
}

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

let k8sClient: KubernetesClient | null = null

async function getKubernetesClient(namespace = "default"): Promise<KubernetesClient> {
  if (k8sClient) return k8sClient

  try {
    const moduleName = "@kubernetes/client-node"
    const k8s = (await import(moduleName)) as unknown as {
      KubeConfig: new () => {
        loadFromDefault(): void
        makeApiClient<T>(api: new (...args: unknown[]) => T): T
      }
      CoreV1Api: new () => unknown
      Exec: new () => unknown
      Cp: new () => unknown
    }

    const kc = new k8s.KubeConfig()
    kc.loadFromDefault()

    const coreApi = kc.makeApiClient(k8s.CoreV1Api)

    k8sClient = {
      namespace,
      async createPod(spec: PodSpec): Promise<Pod> {
        const response = await (coreApi as { createNamespacedPod: (ns: string, spec: PodSpec) => Promise<{ body: Pod }> })
          .createNamespacedPod(namespace, spec)
        return response.body
      },
      async getPod(name: string): Promise<Pod | null> {
        try {
          const response = await (coreApi as { readNamespacedPod: (name: string, ns: string) => Promise<{ body: Pod }> })
            .readNamespacedPod(name, namespace)
          return response.body
        } catch {
          return null
        }
      },
      async deletePod(name: string): Promise<void> {
        await (coreApi as { deleteNamespacedPod: (name: string, ns: string) => Promise<void> })
          .deleteNamespacedPod(name, namespace)
      },
      async listPods(selector?: Record<string, string>): Promise<Pod[]> {
        const labelSelector = selector
          ? Object.entries(selector)
              .map(([k, v]) => `${k}=${v}`)
              .join(",")
          : undefined
        const response = await (coreApi as { listNamespacedPod: (ns: string, opts?: { labelSelector?: string }) => Promise<{ body: { items: Pod[] } }> })
          .listNamespacedPod(namespace, { labelSelector })
        return response.body.items
      },
      async exec(podName: string, container: string, command: string[]): Promise<ExecResult> {
        throw new Error(`Exec not implemented for pod ${podName}:${container} command ${command.join(" ")}`)
      },
      async copyToPod(_podName: string, _container: string, _localPath: string, _remotePath: string): Promise<void> {
        throw new Error("Copy to pod not implemented")
      },
      async copyFromPod(_podName: string, _container: string, _remotePath: string, _localPath: string): Promise<void> {
        throw new Error("Copy from pod not implemented")
      },
    }

    return k8sClient
  } catch {
    throw new Sandbox.ProviderError({
      message: "Kubernetes client not installed. Run: npm install @kubernetes/client-node",
      provider: "kubernetes",
    })
  }
}

function generateId(): string {
  return `k8s-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

function generatePodName(): string {
  return `opencode-sandbox-${Math.random().toString(36).substring(2, 10)}`
}

function phaseToStatus(phase: Pod["status"]["phase"]): Sandbox.Status {
  switch (phase) {
    case "Pending":
      return "creating"
    case "Running":
      return "running"
    case "Succeeded":
      return "stopped"
    case "Failed":
      return "error"
    default:
      return "error"
  }
}

class KubernetesSandboxInstance implements Sandbox.Instance {
  private client: KubernetesClient
  private podName: string
  private containerName: string

  constructor(
    public readonly info: Sandbox.Info,
    client: KubernetesClient,
    podName: string,
    containerName: string,
  ) {
    this.client = client
    this.podName = podName
    this.containerName = containerName
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: {
      cwd?: string
      env?: Record<string, string>
      timeout?: number
      stdin?: string
    },
  ): Promise<Sandbox.ExecResult> {
    const startTime = Date.now()

    try {
      const fullCommand = options?.cwd ? ["sh", "-c", `cd ${options.cwd} && ${command} ${args.join(" ")}`] : [command, ...args]

      const result = await this.client.exec(this.podName, this.containerName, fullCommand)

      return Sandbox.ExecResult.parse({
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - startTime,
      })
    } catch (err) {
      throw new Sandbox.ExecError({
        message: err instanceof Error ? err.message : String(err),
        command: `${command} ${args.join(" ")}`,
      })
    }
  }

  async readFile(path: string): Promise<string> {
    try {
      const result = await this.exec("cat", [path])
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `Failed to read file: exit code ${result.exitCode}`)
      }
      return result.stdout
    } catch (err) {
      throw new Sandbox.FileError({
        message: err instanceof Error ? err.message : String(err),
        path,
        operation: "read",
      })
    }
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const content = await this.readFile(path)
    return new TextEncoder().encode(content)
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    try {
      const textContent = typeof content === "string" ? content : new TextDecoder().decode(content)
      const escapedContent = textContent.replace(/'/g, "'\"'\"'")
      const result = await this.exec("sh", ["-c", `echo '${escapedContent}' > ${path}`])
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `Failed to write file: exit code ${result.exitCode}`)
      }
    } catch (err) {
      throw new Sandbox.FileError({
        message: err instanceof Error ? err.message : String(err),
        path,
        operation: "write",
      })
    }
  }

  async deleteFile(path: string, options?: { recursive?: boolean }): Promise<void> {
    try {
      const args = options?.recursive ? ["-rf", path] : ["-f", path]
      const result = await this.exec("rm", args)
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `Failed to delete: exit code ${result.exitCode}`)
      }
    } catch (err) {
      throw new Sandbox.FileError({
        message: err instanceof Error ? err.message : String(err),
        path,
        operation: "delete",
      })
    }
  }

  async listFiles(path: string): Promise<Sandbox.FileInfo[]> {
    try {
      const result = await this.exec("ls", ["-la", path])
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `Failed to list directory: exit code ${result.exitCode}`)
      }

      const lines = result.stdout.split("\n").filter((l) => l.trim() && !l.startsWith("total"))
      return lines.map((line) => {
        const parts = line.split(/\s+/)
        const name = parts[parts.length - 1]
        const isDir = line.startsWith("d")
        const isLink = line.startsWith("l")
        return Sandbox.FileInfo.parse({
          path: `${path}/${name}`,
          type: isDir ? "directory" : isLink ? "symlink" : "file",
        })
      })
    } catch (err) {
      throw new Sandbox.FileError({
        message: err instanceof Error ? err.message : String(err),
        path,
        operation: "list",
      })
    }
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.exec("test", ["-e", path])
    return result.exitCode === 0
  }

  async snapshot(_name?: string): Promise<Sandbox.Snapshot> {
    throw new Sandbox.SnapshotError({
      message: "Snapshots not yet supported for Kubernetes sandboxes",
      sandboxId: this.info.id,
    })
  }

  async stop(): Promise<void> {
    await this.terminate()
  }

  async terminate(): Promise<void> {
    try {
      await this.client.deletePod(this.podName)
    } catch (err) {
      throw new Sandbox.ProviderError({
        message: err instanceof Error ? err.message : String(err),
        provider: "kubernetes",
      })
    }
  }

  async getStatus(): Promise<Sandbox.Status> {
    const pod = await this.client.getPod(this.podName)
    if (!pod) return "terminated"
    return phaseToStatus(pod.status.phase)
  }

  async waitForStatus(status: Sandbox.Status, timeoutMs = 30000): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      const current = await this.getStatus()
      if (current === status) return
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Sandbox.TimeoutError({
      message: `Timed out waiting for status: ${status}`,
      timeoutMs,
    })
  }
}

export class KubernetesSandboxProvider implements Sandbox.Provider {
  readonly type: Sandbox.ProviderType = "kubernetes"

  private namespace: string
  private defaultImage: string
  private sandboxes = new Map<string, { info: Sandbox.Info; podName: string }>()
  private containerName = "sandbox"

  constructor(options?: { namespace?: string; defaultImage?: string }) {
    this.namespace = options?.namespace ?? "default"
    this.defaultImage = options?.defaultImage ?? "debian:bookworm-slim"
  }

  async create(config: Sandbox.Config): Promise<Sandbox.Instance> {
    try {
      const client = await getKubernetesClient(this.namespace)
      const podName = generatePodName()
      const id = config.id ?? generateId()

      const env: Array<{ name: string; value: string }> = Object.entries(config.env ?? {}).map(([name, value]) => ({
        name,
        value,
      }))

      const podSpec: PodSpec = {
        metadata: {
          name: podName,
          labels: {
            "opencode.ai/sandbox": "true",
            "opencode.ai/sandbox-id": id,
            "opencode.ai/project-id": config.projectId ?? "",
            "opencode.ai/session-id": config.sessionId ?? "",
          },
        },
        spec: {
          containers: [
            {
              name: this.containerName,
              image: config.image ?? this.defaultImage,
              command: ["sleep", "infinity"],
              workingDir: config.workdir ?? "/workspace",
              env,
              resources: {
                requests: {
                  cpu: config.cpu ? `${config.cpu}` : "100m",
                  memory: config.memory ? `${config.memory}Mi` : "256Mi",
                },
                limits: {
                  cpu: config.cpu ? `${config.cpu * 2}` : "1",
                  memory: config.memory ? `${config.memory * 2}Mi` : "512Mi",
                },
              },
            },
          ],
          restartPolicy: "Never",
        },
      }

      await client.createPod(podSpec)

      const info = Sandbox.Info.parse({
        id,
        name: config.name ?? podName,
        status: "creating" as const,
        provider: "kubernetes" as const,
        workdir: config.workdir ?? "/workspace",
        createdAt: new Date().toISOString(),
        projectId: config.projectId,
        sessionId: config.sessionId,
        metadata: {
          podName,
          namespace: this.namespace,
        },
      })

      this.sandboxes.set(id, { info, podName })

      const instance = new KubernetesSandboxInstance(info, client, podName, this.containerName)

      await instance.waitForStatus("running", config.timeout ?? 60000)

      info.status = "running"
      return instance
    } catch (err) {
      if (err instanceof Sandbox.ProviderError) throw err
      if (err instanceof Sandbox.TimeoutError) throw err
      throw new Sandbox.CreateError({
        message: err instanceof Error ? err.message : String(err),
        provider: "kubernetes",
      })
    }
  }

  async get(id: string): Promise<Sandbox.Instance | undefined> {
    const entry = this.sandboxes.get(id)
    if (!entry) return undefined

    try {
      const client = await getKubernetesClient(this.namespace)
      const pod = await client.getPod(entry.podName)
      if (!pod) return undefined

      return new KubernetesSandboxInstance(entry.info, client, entry.podName, this.containerName)
    } catch {
      return undefined
    }
  }

  async list(filter?: { projectId?: string; sessionId?: string; status?: Sandbox.Status }): Promise<Sandbox.Info[]> {
    let results = Array.from(this.sandboxes.values()).map((e) => e.info)

    if (filter?.projectId) {
      results = results.filter((s) => s.projectId === filter.projectId)
    }
    if (filter?.sessionId) {
      results = results.filter((s) => s.sessionId === filter.sessionId)
    }
    if (filter?.status) {
      results = results.filter((s) => s.status === filter.status)
    }

    return results
  }

  async terminate(id: string): Promise<void> {
    const instance = await this.get(id)
    if (!instance) {
      throw new Sandbox.NotFoundError({
        id,
        message: `Sandbox not found: ${id}`,
      })
    }
    await instance.terminate()
    this.sandboxes.delete(id)
  }

  async terminateAll(filter?: { projectId?: string; sessionId?: string }): Promise<number> {
    const toTerminate = await this.list(filter)
    let count = 0
    for (const info of toTerminate) {
      try {
        await this.terminate(info.id)
        count++
      } catch {}
    }
    return count
  }

  async restore(_snapshotId: string, _config?: Partial<Sandbox.Config>): Promise<Sandbox.Instance> {
    throw new Sandbox.SnapshotError({
      message: "Snapshots not yet supported for Kubernetes sandboxes",
      snapshotId: _snapshotId,
    })
  }

  async listSnapshots(_filter?: { sandboxId?: string; projectId?: string }): Promise<Sandbox.Snapshot[]> {
    return []
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    throw new Sandbox.SnapshotError({
      message: "Snapshots not yet supported for Kubernetes sandboxes",
      snapshotId,
    })
  }

  async healthCheck(): Promise<boolean> {
    try {
      await getKubernetesClient(this.namespace)
      return true
    } catch {
      return false
    }
  }
}

export function createKubernetesProvider(options?: { namespace?: string; defaultImage?: string }): KubernetesSandboxProvider {
  return new KubernetesSandboxProvider(options)
}
