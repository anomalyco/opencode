import type { BaseParserContextOptions } from '../context/parser';
import { type PluginAccessOptions } from '../plugin';
import type { SerovalNode } from '../types';
export type SyncParserContextOptions = Omit<BaseParserContextOptions, 'refs'>;
export type AsyncParserContextOptions = Omit<BaseParserContextOptions, 'refs'>;
export declare function serialize<T>(source: T, options?: SyncParserContextOptions): string;
export declare function serializeAsync<T>(source: T, options?: AsyncParserContextOptions): Promise<string>;
export declare function deserialize<T>(source: string): T;
export interface SerovalJSON {
    t: SerovalNode;
    f: number;
    m: number[];
}
export interface FromJSONOptions extends PluginAccessOptions {
    disabledFeatures?: number;
}
export declare function toJSON<T>(source: T, options?: SyncParserContextOptions): SerovalJSON;
export declare function toJSONAsync<T>(source: T, options?: AsyncParserContextOptions): Promise<SerovalJSON>;
export declare function compileJSON(source: SerovalJSON, options?: PluginAccessOptions): string;
export declare function fromJSON<T>(source: SerovalJSON, options?: FromJSONOptions): T;
//# sourceMappingURL=index.d.ts.map