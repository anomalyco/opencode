import { Color, Texture, DataTexture } from "three";
export declare class TextureUtils {
    /**
     * Loads a texture from a file path using sharp.
     * Returns a THREE.Texture with ImageData attached to its .image property.
     */
    static loadTextureFromFile(path: string): Promise<DataTexture | null>;
    /**
     * Alias for loadTextureFromFile for convenience.
     */
    static fromFile(path: string): Promise<DataTexture | null>;
    /**
     * Creates a THREE.Texture with a checkerboard pattern.
     */
    static createCheckerboard(size?: number, color1?: Color, color2?: Color, checkSize?: number): Texture;
    /**
     * Creates a THREE.Texture with a gradient pattern.
     */
    static createGradient(size?: number, startColor?: Color, endColor?: Color, direction?: "horizontal" | "vertical" | "radial"): Texture;
    /**
     * Creates a THREE.Texture with a procedural noise pattern.
     */
    static createNoise(size?: number, scale?: number, octaves?: number, color1?: Color, color2?: Color): Texture;
}
