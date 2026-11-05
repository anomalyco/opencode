import { EventEmitter } from "events";
import { type AudioStreamDemuxer, type AudioStreamDemuxerFactory } from "./audio-stream/demuxer.js";
import { type AudioStats } from "./zig-structs.js";
export interface AudioSetupOptions {
    autoStart?: boolean;
    sampleRate?: number;
    playbackChannels?: number;
    startOptions?: AudioStartOptions;
}
export interface AudioStartOptions {
    periodSizeInFrames?: number;
    periodSizeInMilliseconds?: number;
    periods?: number;
    performanceProfile?: number;
    shareMode?: number;
    noPreSilencedOutputBuffer?: boolean;
    noClip?: boolean;
    noDisableDenormals?: boolean;
    noFixedSizedCallback?: boolean;
    wasapiNoAutoConvertSrc?: boolean;
    wasapiNoDefaultQualitySrc?: boolean;
    alsaNoMMap?: boolean;
    alsaNoAutoFormat?: boolean;
    alsaNoAutoChannels?: boolean;
    alsaNoAutoResample?: boolean;
}
export interface AudioPlayOptions {
    volume?: number;
    pan?: number;
    loop?: boolean;
    groupId?: number;
}
export type AudioStreamBody = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
export type AudioStreamFormat = "mp3" | "flac";
export interface AudioStreamContentTypeContext {
    readonly format: AudioStreamFormat;
    readonly contentType: string | null;
    readonly status: number;
    readonly url: string;
}
export type AudioStreamContentTypePolicy = "validate" | "ignore" | ((context: AudioStreamContentTypeContext) => boolean);
export interface AudioStreamConnectContext {
    readonly signal: AbortSignal;
    readonly attempt: number;
}
export interface AudioStreamConnection<I = unknown> {
    readonly body: AudioStreamBody;
    readonly info: I;
    close?(): void | Promise<void>;
}
export type AudioStreamRetryPhase = "connect" | "read";
export interface AudioStreamRetryContext {
    readonly attempt: number;
    readonly maxRetries: number;
    readonly phase: AudioStreamRetryPhase;
}
export type AudioStreamRetryDecision = false | {
    readonly delayMs?: number;
};
export interface AudioStreamConnector<I = unknown> {
    connect(context: AudioStreamConnectContext): Promise<AudioStreamConnection<I>>;
}
export interface AudioStreamBufferOptions {
    capacityMs?: number;
    startupMs?: number;
    resumeMs?: number;
}
export interface AudioStreamReconnectOptions {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
    retryOnEnd?: boolean;
    retry?(error: AudioStreamError, context: AudioStreamRetryContext): AudioStreamRetryDecision;
}
export interface AudioStreamOptions {
    format?: AudioStreamFormat;
    volume?: number;
    pan?: number;
    groupId?: number;
    maxProbeBytes?: number;
    buffer?: AudioStreamBufferOptions;
    signal?: AbortSignal;
}
export interface AudioStreamBodyOptions<M = AudioStreamMetadata> extends AudioStreamOptions {
    demuxer?: AudioStreamDemuxerFactory<M>;
    contentTypePolicy?: never;
    request?: never;
    reconnect?: never;
    metadataEncoding?: never;
}
export interface AudioStreamSourceOptions<I = unknown, M = AudioStreamMetadata> extends AudioStreamOptions {
    demuxer?: (info: I) => AudioStreamDemuxer<M> | null;
    reconnect?: AudioStreamReconnectOptions;
    contentTypePolicy?: never;
    request?: never;
    metadataEncoding?: never;
}
export interface AudioStreamUrlOptions extends AudioStreamOptions {
    request?: Omit<RequestInit, "body" | "signal">;
    reconnect?: AudioStreamReconnectOptions;
    metadataEncoding?: string;
    contentTypePolicy?: AudioStreamContentTypePolicy;
    demuxer?: never;
}
export type AudioStreamState = "initializing" | "buffering" | "playing" | "reconnecting" | "ended" | "errored" | "disposed";
export interface AudioStreamStats {
    state: AudioStreamState;
    sampleRate: number;
    channels: number;
    bufferedFrames: number;
    capacityFrames: number;
    bufferedDurationMs: number;
    bytesReceived: bigint;
    framesDecoded: bigint;
    framesPlayed: bigint;
    underruns: number;
    reconnectAttempts: number;
}
export type AudioStreamMetadataFormat = "icy";
export interface AudioStreamMetadata {
    readonly format: AudioStreamMetadataFormat;
    readonly headers: Readonly<Record<string, string>>;
    readonly fields: Readonly<Record<string, string>>;
}
export type AudioStreamAction = "fetch" | "response" | "source" | "demuxer" | "create" | "write" | "end" | "restart" | "stats" | "decoder" | "destroy" | "setVolume" | "setPan" | "setGroup";
export interface AudioStreamErrorContext {
    action: AudioStreamAction;
    status?: number;
    errorCode?: number;
    attempt?: number;
}
export interface AudioStreamReconnectEvent {
    attempt: number;
    delayMs: number;
    maxRetries: number;
    error: AudioStreamError;
}
export interface AudioStreamEvents<M = AudioStreamMetadata> {
    metadata: [metadata: M | null];
    reconnecting: [event: AudioStreamReconnectEvent];
    ended: [];
    error: [error: Error, context: AudioStreamErrorContext];
    disposed: [];
}
export type AudioGroup = number;
export type AudioVoice = number;
export type AudioSound = number;
export interface AudioPlaybackDevice {
    index: number;
    name: string;
    isDefault: boolean;
}
export type AudioAction = "createAudioEngine" | "start" | "startMixer" | "stop" | "loadSound" | "loadSoundFile" | "unloadSound" | "group" | "play" | "stopVoice" | "setVoiceGroup" | "setGroupVolume" | "setMasterVolume" | "mixFrames" | "enableTap" | "readTapFrames" | "listPlaybackDevices" | "selectPlaybackDevice" | "clearPlaybackDeviceSelection" | "getStats";
export interface AudioErrorContext {
    action: AudioAction;
    status?: number;
}
export interface AudioEvents {
    error: [error: Error, context: AudioErrorContext];
    started: [];
    mixerStarted: [];
    stopped: [];
    disposed: [];
}
export type AudioInitializationAction = "resolveRenderLib" | "createAudioEngine" | "start";
export declare class AudioInitializationError extends Error {
    readonly action: AudioInitializationAction;
    readonly status?: number;
    constructor(action: AudioInitializationAction, message: string, status?: number, cause?: unknown);
}
export declare class AudioStreamError extends Error {
    readonly context: AudioStreamErrorContext;
    constructor(message: string, context: AudioStreamErrorContext, cause?: unknown);
}
export declare class AudioStream<M = AudioStreamMetadata> extends EventEmitter<AudioStreamEvents<M>> {
    readonly closed: Promise<void>;
    readonly format: AudioStreamFormat;
    private readonly lib;
    private readonly engine;
    private readonly connector;
    private readonly demuxerFactory?;
    private readonly readAction;
    private readonly options;
    private readonly removeFromOwner;
    private readonly lifecycleController;
    private nativeStreamId;
    private nativeStats;
    private activeAttempt;
    private pendingCleanup;
    private reconnectAttempts;
    private consecutiveReconnectAttempts;
    private disposed;
    private exposed;
    private terminalError;
    private metadata;
    private pendingMetadataEvent;
    private metadataEventScheduled;
    private terminalEventScheduled;
    private setupResolve;
    private setupReject;
    private closedResolve;
    private readonly setupPromise;
    private readonly overallAbortListener;
    private constructor();
    get state(): AudioStreamState;
    private open;
    getStats(): AudioStreamStats;
    getMetadata(): M | null;
    setVolume(volume: number): boolean;
    setPan(pan: number): boolean;
    setGroup(groupId: number): boolean;
    private control;
    dispose(): void;
    private runLifecycle;
    private createNativeStream;
    private consumeSource;
    private pumpSource;
    private processDemuxOutput;
    private writeStreamChunk;
    private resolveConnection;
    private beginResourceAcquisition;
    private cleanupAttempt;
    private performAttemptCleanup;
    private runBoundedAttemptCleanup;
    private retry;
    private awaitReady;
    private observeReady;
    private awaitEnded;
    private pollNativeSnapshot;
    private snapshotError;
    private finish;
    private publishMetadata;
    private emitMetadata;
    private emitAsync;
    private emitTerminal;
    private isAttemptActive;
    private stopSource;
    private closeNativeStream;
    private readNativeStats;
    private toPublicStats;
    private removeOwner;
}
export declare class Audio extends EventEmitter<AudioEvents> {
    static create(options?: AudioSetupOptions): Audio;
    readonly sampleRate: number;
    private readonly lib;
    private readonly defaultStartOptions;
    private engine;
    private readonly groups;
    private readonly streams;
    private playbackStarted;
    private mixerStarted;
    private disposing;
    private constructor();
    private throwAfterInitializationCleanup;
    private emitError;
    start(options?: AudioStartOptions): boolean;
    startMixer(): boolean;
    stop(): boolean;
    isStarted(): boolean;
    isMixerStarted(): boolean;
    loadSound(data: Uint8Array | ArrayBuffer): AudioSound | null;
    loadSoundFile(filePath: string): Promise<AudioSound | null>;
    unloadSound(sound: AudioSound): boolean;
    group(name: string): AudioGroup | null;
    play(sound: AudioSound, options?: AudioPlayOptions): AudioVoice | null;
    playStream<M = AudioStreamMetadata>(source: AudioStreamBody, options?: AudioStreamBodyOptions<M>): Promise<AudioStream<M>>;
    playStreamUrl(source: string | URL, options?: AudioStreamUrlOptions): Promise<AudioStream<AudioStreamMetadata>>;
    playStreamSource<I, M = AudioStreamMetadata>(connector: AudioStreamConnector<I>, options?: AudioStreamSourceOptions<I, M>): Promise<AudioStream<M>>;
    private openStream;
    stopVoice(voice: AudioVoice): boolean;
    setVoiceGroup(voice: AudioVoice, group: AudioGroup): boolean;
    setGroupVolume(group: AudioGroup, volume: number): boolean;
    setMasterVolume(volume: number): boolean;
    mixFrames(frameCount: number, channels?: number): Float32Array | null;
    enableTap(capacityFrames?: number): boolean;
    disableTap(): boolean;
    readTapFrames(frameCount: number, channels?: number): {
        frames: Float32Array;
        framesRead: number;
    } | null;
    listPlaybackDevices(): AudioPlaybackDevice[] | null;
    selectPlaybackDevice(index: number): boolean;
    clearPlaybackDeviceSelection(): void;
    getStats(): AudioStats | null;
    dispose(): void;
}
export declare function setupAudio(options?: AudioSetupOptions): Audio;
