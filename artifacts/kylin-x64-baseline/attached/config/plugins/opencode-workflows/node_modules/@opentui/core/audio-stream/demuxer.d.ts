import type { AudioStreamMetadata } from "../audio.js";
export type AudioStreamDemuxOutput<M> = {
    type: "audio";
    data: Uint8Array;
} | {
    type: "metadata";
    metadata: M | null;
};
export interface AudioStreamDemuxer<M> {
    readonly initialMetadata: M | null;
    push(chunk: Uint8Array): Iterable<AudioStreamDemuxOutput<M>>;
    flush(): Iterable<AudioStreamDemuxOutput<M>>;
    abort?(reason: unknown): void;
}
export type AudioStreamDemuxerFactory<M> = () => AudioStreamDemuxer<M>;
export declare function selectAudioStreamDemuxer(options: {
    headers: Headers;
    metadataEncoding: string;
}): AudioStreamDemuxer<AudioStreamMetadata> | null;
