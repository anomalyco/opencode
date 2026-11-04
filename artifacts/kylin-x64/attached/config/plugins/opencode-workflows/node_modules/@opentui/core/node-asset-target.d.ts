export type NodeAssetTarget = {
    readonly platform: "darwin" | "linux" | "win32";
    readonly arch: "arm64" | "x64";
    readonly libc?: "glibc" | "musl";
};
export interface NativeAssetDescriptor {
    readonly key: string;
    readonly packageName: string;
    readonly fileName: string;
}
export declare function getNativeAssetDescriptor(target: NodeAssetTarget): NativeAssetDescriptor;
export declare function getCurrentNodeAssetTarget(): NodeAssetTarget;
