export interface ScrollAcceleration {
    tick(now?: number): number;
    reset(): void;
}
export declare class LinearScrollAccel implements ScrollAcceleration {
    tick(_now?: number): number;
    reset(): void;
}
/**
 * macOS-inspired scroll acceleration.
 *
 * The class measures the time between consecutive scroll events and keeps a short
 * moving window of the latest intervals. The average interval determines which
 * multiplier to apply so that quick bursts accelerate and slower gestures stay precise.
 *
 * For intuition, treat the streak as a continuous timeline and compare it with the
 * exponential distance curve from the pointer-acceleration research post:
 *   d(t) = v₀ * ( t + A * (exp(t/τ) - 1 - t/τ) ).
 * Small t stays near the base multiplier, medium streaks settle on multiplier1, and
 * sustained bursts reach multiplier2, mirroring how the exponential curve bends up.
 *
 * Options:
 * - threshold1: upper bound (ms) of the "medium" band. Raise to delay the ramp.
 * - threshold2: upper bound (ms) of the "fast" band. Lower to demand tighter bursts.
 * - multiplier1: scale for medium speed streaks.
 * - multiplier2: scale for sustained fast streaks.
 * - baseMultiplier: scale for relaxed scrolling; set to 1 for linear behaviour.
 */
export declare class MacOSScrollAccel implements ScrollAcceleration {
    private opts;
    private lastTickTime;
    private velocityHistory;
    private readonly historySize;
    private readonly streakTimeout;
    private readonly minTickInterval;
    constructor(opts?: {
        A?: number;
        tau?: number;
        maxMultiplier?: number;
    });
    tick(now?: number): number;
    reset(): void;
}
