import { type NodeAssetTarget } from "./node-asset-target.js";
export type { NodeAssetTarget };
export type NodeAsset = {
    readonly key: string;
    readonly source: string;
};
export declare function getNodeAssets(target: NodeAssetTarget): readonly NodeAsset[];
