import type { CliRenderer } from "../renderer.js";
export interface TimelineOptions {
    duration?: number;
    loop?: boolean;
    autoplay?: boolean;
    onComplete?: () => void;
    onPause?: () => void;
}
export interface AnimationOptions {
    duration: number;
    ease?: EasingFunctions;
    onUpdate?: (animation: JSAnimation) => void;
    onComplete?: () => void;
    onStart?: () => void;
    onLoop?: () => void;
    loop?: boolean | number;
    loopDelay?: number;
    alternate?: boolean;
    once?: boolean;
    [key: string]: any;
}
export interface JSAnimation {
    targets: any[];
    deltaTime: number;
    progress: number;
    currentTime: number;
}
interface TimelineItem {
    type: "animation" | "callback" | "timeline";
    startTime: number;
}
interface TimelineTimelineItem extends TimelineItem {
    type: "timeline";
    timeline: Timeline;
    timelineStarted?: boolean;
}
interface TimelineCallbackItem extends TimelineItem {
    type: "callback";
    callback: () => void;
    executed: boolean;
}
interface TimelineAnimationItem extends TimelineItem {
    type: "animation";
    target: any[];
    properties?: Record<string, number>;
    initialValues?: Record<string, number>[];
    duration?: number;
    ease?: keyof typeof easingFunctions;
    loop?: boolean | number;
    loopDelay?: number;
    alternate?: boolean;
    onUpdate?: (animation: JSAnimation) => void;
    onComplete?: () => void;
    onStart?: () => void;
    onLoop?: () => void;
    completed?: boolean;
    started?: boolean;
    currentLoop?: number;
    once?: boolean;
}
export type EasingFunctions = keyof typeof easingFunctions;
declare const easingFunctions: {
    linear: (t: number) => number;
    inQuad: (t: number) => number;
    outQuad: (t: number) => number;
    inOutQuad: (t: number) => number;
    inExpo: (t: number) => number;
    outExpo: (t: number) => number;
    inOutSine: (t: number) => number;
    outBounce: (t: number) => number;
    outElastic: (t: number) => number;
    inBounce: (t: number) => number;
    inCirc: (t: number) => number;
    outCirc: (t: number) => number;
    inOutCirc: (t: number) => number;
    inBack: (t: number, s?: number) => number;
    outBack: (t: number, s?: number) => number;
    inOutBack: (t: number, s?: number) => number;
};
export declare class Timeline {
    items: (TimelineAnimationItem | TimelineCallbackItem)[];
    subTimelines: TimelineTimelineItem[];
    currentTime: number;
    isPlaying: boolean;
    isComplete: boolean;
    duration: number;
    loop: boolean;
    synced: boolean;
    private autoplay;
    private onComplete?;
    private onPause?;
    private stateChangeListeners;
    constructor(options?: TimelineOptions);
    addStateChangeListener(listener: (timeline: Timeline) => void): void;
    removeStateChangeListener(listener: (timeline: Timeline) => void): void;
    private notifyStateChange;
    add(target: any, properties: AnimationOptions, startTime?: number | string): this;
    once(target: any, properties: AnimationOptions): this;
    call(callback: () => void, startTime?: number | string): this;
    sync(timeline: Timeline, startTime?: number): this;
    play(): this;
    pause(): this;
    resetItems(): void;
    restart(): this;
    update(deltaTime: number): void;
}
declare class TimelineEngine {
    private timelines;
    private renderer;
    private frameCallback;
    private isLive;
    defaults: {
        frameRate: number;
    };
    attach(renderer: CliRenderer): void;
    detach(): void;
    private updateLiveState;
    private onTimelineStateChange;
    register(timeline: Timeline): void;
    unregister(timeline: Timeline): void;
    clear(): void;
    update(deltaTime: number): void;
}
export declare const engine: TimelineEngine;
export declare function createTimeline(options?: TimelineOptions): Timeline;
export {};
