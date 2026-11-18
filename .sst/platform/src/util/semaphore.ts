export class Semaphore {
  private current: number;
  private queue: (() => void)[];

  constructor(private max: number) {
    this.current = 0;
    this.queue = [];
  }

  public async acquire(name: string): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  public release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
      return;
    }
    this.current--;
  }
}
