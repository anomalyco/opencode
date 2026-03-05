// packages/opencode/src/security/kali/container.ts
import { $ } from "bun"
import { randomBytes } from "crypto"
import { Flag } from "@/flag/flag"

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface ContainerInfo {
  id: string
  created: Date
  persistent: boolean
}

export class KaliContainer {
  private containers = new Map<string, ContainerInfo>()

  static generateId(): string {
    return `kali-${Date.now()}-${randomBytes(3).toString("hex").slice(0, 6)}`
  }

  static parseCommand(input: string): { command: string; args: string[] } {
    const parts = input.trim().split(/\s+/)
    return {
      command: parts[0] || "",
      args: parts.slice(1),
    }
  }

  async checkDocker(): Promise<{ available: boolean; error?: string }> {
    try {
      const result = await $`docker --version`.quiet().nothrow()
      if (result.exitCode !== 0) {
        return { available: false, error: "Docker not installed or not running" }
      }
      return { available: true }
    } catch {
      return { available: false, error: "Docker executable not found" }
    }
  }

  async createOneShot(): Promise<string> {
    const id = KaliContainer.generateId()
    await $`docker create --name ${id} ${Flag.OPENSACIA_KALI_IMAGE}`.quiet()
    await $`docker network connect ${Flag.OPENSACIA_DOCKER_NETWORK} ${id}`.quiet()
    await $`docker start ${id}`.quiet()
    this.containers.set(id, { id, created: new Date(), persistent: false })
    return id
  }

  async createPersistent(name: string): Promise<string> {
    await $`docker run -d --name ${name} --network ${Flag.OPENSACIA_DOCKER_NETWORK} ${Flag.OPENSACIA_KALI_IMAGE} tail -f /dev/null`.quiet()
    this.containers.set(name, { id: name, created: new Date(), persistent: true })
    return name
  }

  async exec(containerId: string, command: string): Promise<ExecResult> {
    const result = await $`docker exec ${containerId} ${command}`.nothrow()
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
    }
  }

  async copyIn(localPath: string, containerId: string, containerPath: string): Promise<void> {
    await $`docker cp ${localPath} ${containerId}:${containerPath}`
  }

  async copyOut(containerId: string, containerPath: string, localPath: string): Promise<void> {
    await $`docker cp ${containerId}:${containerPath} ${localPath}`
  }

  async destroy(containerId: string): Promise<void> {
    await $`docker rm -f ${containerId}`.quiet()
    this.containers.delete(containerId)
  }

  async cleanup(): Promise<void> {
    const result = await $`docker ps -q --filter "name=kali-"`.text()
    if (result.trim()) {
      for (const id of result.trim().split("\n")) {
        await this.destroy(id)
      }
    }
  }

  list(): ContainerInfo[] {
    return Array.from(this.containers.values())
  }
}
