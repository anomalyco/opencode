export declare function renderToString<T>(fn: () => T, options?: {
    nonce?: string;
    renderId?: string;
}): string;
export declare function renderToStringAsync<T>(fn: () => T, options?: {
    timeoutMs?: number;
    nonce?: string;
    renderId?: string;
}): Promise<string>;
export declare function renderToStream<T>(fn: () => T, options?: {
    nonce?: string;
    renderId?: string;
    onCompleteShell?: (info: {
        write: (v: string) => void;
    }) => void;
    onCompleteAll?: (info: {
        write: (v: string) => void;
    }) => void;
}): {
    pipe: (writable: {
        write: (v: string) => void;
    }) => void;
    pipeTo: (writable: WritableStream) => void;
};
export declare function ssr(template: string[] | string, ...nodes: any[]): {
    t: string;
};
export declare function ssrElement(name: string, props: any, children: any, needsId: boolean): {
    t: string;
};
export declare function ssrClassList(value: {
    [k: string]: boolean;
}): string;
export declare function ssrStyle(value: {
    [k: string]: string;
}): string;
export declare function ssrAttribute(key: string, value: boolean): string;
export declare function ssrHydrationKey(): string;
export declare function resolveSSRNode(node: any): string;
export declare function escape(html: string): string;
/**
 * @deprecated Replaced by ssrElement
 */
export declare function ssrSpread(props: any, isSVG: boolean, skipChildren: boolean): void;
export type LegacyResults = {
    startWriting: () => void;
};
/**
 * @deprecated Replaced by renderToStream
 */
export declare function pipeToWritable<T>(fn: () => T, writable: WritableStream, options?: {
    nonce?: string;
    onReady?: (res: LegacyResults) => void;
    onCompleteAll?: () => void;
}): void;
/**
 * @deprecated Replaced by renderToStream
 */
export declare function pipeToNodeWritable<T>(fn: () => T, writable: {
    write: (v: string) => void;
}, options?: {
    nonce?: string;
    onReady?: (res: LegacyResults) => void;
    onCompleteAll?: () => void;
}): void;
