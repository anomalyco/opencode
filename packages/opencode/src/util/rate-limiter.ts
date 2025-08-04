import { Log } from "./log"

const log = Log.create({ service: "rate-limiter" })

// Simple mutex implementation for synchronization
class Mutex {
  private locked = false
  private queue: Array<() => void> = []

  async lock(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true
          resolve(() => this.unlock())
        } else {
          this.queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }

  private unlock(): void {
    this.locked = false
    if (this.queue.length > 0) {
      const next = this.queue.shift()
      if (next) next()
    }
  }
}

export class RateLimiter {
  private lastRequestTime: number = 0
  private minInterval: number = 0 // in milliseconds
  private mutex: Mutex = new Mutex()

  constructor(requestsPerMinute?: number) {
    if (requestsPerMinute && requestsPerMinute > 0) {
      this.minInterval = 60000 / requestsPerMinute
    }
  }

  async wait(): Promise<void> {
    if (this.minInterval <= 0) {
      return
    }

    // Acquire lock to ensure thread safety
    const unlock = await this.mutex.lock()
    
    try {
      // Use process.hrtime for more precise timing and to avoid time drift
      const now = process.hrtime.bigint() / BigInt(1000000) // Convert to milliseconds
      const timeSinceLastRequest = Number(now - BigInt(this.lastRequestTime))
      const timeToWait = Math.max(0, this.minInterval - timeSinceLastRequest)

      if (timeToWait > 0) {
        log.info(`Rate limiting: waiting ${timeToWait}ms before next request`)
        // Use a promise-based approach for waiting
        await new Promise(resolve => setTimeout(resolve, timeToWait))
      }

      // Update last request time after waiting
      this.lastRequestTime = Number(process.hrtime.bigint() / BigInt(1000000))
    } finally {
      // Always release the lock
      unlock()
    }
  }
}