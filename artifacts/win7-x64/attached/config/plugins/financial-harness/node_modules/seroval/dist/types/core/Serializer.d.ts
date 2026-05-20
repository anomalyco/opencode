import { type PluginAccessOptions } from './plugin';
export interface SerializerOptions extends PluginAccessOptions {
    globalIdentifier: string;
    scopeId?: string;
    disabledFeatures?: number;
    onData: (result: string) => void;
    onError: (error: unknown) => void;
    onDone?: () => void;
}
export default class Serializer {
    private options;
    private alive;
    private flushed;
    private done;
    private pending;
    private cleanups;
    private refs;
    private plugins?;
    constructor(options: SerializerOptions);
    keys: Set<string>;
    write(key: string, value: unknown): void;
    ids: number;
    private getNextID;
    push(value: unknown): string;
    flush(): void;
    close(): void;
}
//# sourceMappingURL=Serializer.d.ts.map