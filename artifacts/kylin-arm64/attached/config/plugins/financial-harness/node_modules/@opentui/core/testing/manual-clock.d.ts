import type { Clock, TimerHandle } from "../lib/clock.js";
export declare class ManualClock implements Clock {
    private time;
    private nextId;
    private nextOrder;
    private readonly timers;
    now(): number;
    setTime(time: number): void;
    setTimeout(fn: () => void, delayMs: number): TimerHandle;
    clearTimeout(handle: TimerHandle): void;
    setInterval(fn: () => void, delayMs: number): TimerHandle;
    clearInterval(handle: TimerHandle): void;
    advance(delayMs: number): void;
    runAll(): void;
    private schedule;
    private peekNextTimer;
}
