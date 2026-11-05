import type { AudioStreamMetadata } from "../../audio.js";
import type { AudioStreamDemuxer, AudioStreamDemuxOutput } from "../demuxer.js";
export interface IcyStreamDemuxerOptions {
    metadataInterval: number;
    metadataEncoding?: string;
    headers?: Readonly<Record<string, string>>;
}
export declare class IcyStreamDemuxer implements AudioStreamDemuxer<AudioStreamMetadata> {
    readonly initialMetadata: AudioStreamMetadata;
    private audioRemaining;
    private metadata;
    private metadataOffset;
    private fields;
    private readonly interval;
    private readonly decoder;
    private readonly headers;
    constructor(options: IcyStreamDemuxerOptions);
    push(chunk: Uint8Array): IterableIterator<AudioStreamDemuxOutput<AudioStreamMetadata>>;
    flush(): IterableIterator<AudioStreamDemuxOutput<AudioStreamMetadata>>;
}
export declare function createIcyStreamDemuxer(options: IcyStreamDemuxerOptions): AudioStreamDemuxer<AudioStreamMetadata>;
