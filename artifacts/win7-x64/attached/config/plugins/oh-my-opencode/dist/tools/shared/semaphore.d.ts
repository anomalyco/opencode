/**
 * Simple counting semaphore to limit concurrent process execution.
 * Used to prevent multiple ripgrep processes from saturating CPU.
 */
export declare class Semaphore {
    private readonly max;
    private queue;
    private running;
    constructor(max: number);
    acquire(): Promise<void>;
    release(): void;
}
/** Global semaphore limiting concurrent ripgrep processes to 2 */
export declare const rgSemaphore: Semaphore;
