import { Sprite, SpriteMaterial, type SpriteMaterialParameters } from "three";
export declare class SheetSprite extends Sprite {
    private _frameIndex;
    private _numFrames;
    constructor(material: SpriteMaterial, numFrames: number);
    setIndex: (index: number) => void;
}
export declare class SpriteUtils {
    static fromFile(path: string, { materialParameters, }?: {
        materialParameters?: Omit<SpriteMaterialParameters, "map">;
    }): Promise<Sprite>;
    static sheetFromFile(path: string, numFrames: number): Promise<SheetSprite>;
}
