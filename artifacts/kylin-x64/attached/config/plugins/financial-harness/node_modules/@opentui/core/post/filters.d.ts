import type { OptimizedBuffer } from "../buffer.js";
/**
 * Applies a scanline effect by darkening every nth row using native color matrix.
 * Only affects the background buffer to maintain text readability.
 */
export declare function applyScanlines(buffer: OptimizedBuffer, strength?: number, step?: number): void;
/**
 * Inverts the colors in the buffer using native color matrix.
 * Uses negative matrix with alpha offset: output = 1.0 - input for each RGB channel.
 */
export declare function applyInvert(buffer: OptimizedBuffer, strength?: number): void;
/**
 * Adds random noise to the buffer colors using colorMatrix with brightness matrix.
 * Uses per-pixel random strength values to dim/brighten each cell.
 */
export declare function applyNoise(buffer: OptimizedBuffer, strength?: number): void;
/**
 * Applies a simplified chromatic aberration effect.
 */
export declare function applyChromaticAberration(buffer: OptimizedBuffer, strength?: number): void;
/**
 * Converts the buffer to ASCII art based on background brightness.
 * Uses native colorMatrix for efficient color corrections.
 */
export declare function applyAsciiArt(buffer: OptimizedBuffer, ramp?: string, fgColor?: {
    r: number;
    g: number;
    b: number;
}, bgColor?: {
    r: number;
    g: number;
    b: number;
}): void;
/**
 * Adjusts the brightness of the buffer using color matrix transformation.
 * Brightness adds the brightness value to all RGB channels (additive brightness).
 *                   If not provided, applies uniform brightness to entire buffer.
 */
export declare function applyBrightness(buffer: OptimizedBuffer, brightness?: number, cellMask?: Float32Array): void;
/**
 * Adjusts the gain of the buffer using color matrix transformation.
 * Gain multiplies all RGB channels by the gain factor (no clamping).
 *                   If not provided, applies uniform gain to entire buffer.
 */
export declare function applyGain(buffer: OptimizedBuffer, gain?: number, cellMask?: Float32Array): void;
/**
 * Applies a saturation adjustment to the buffer.
 */
export declare function applySaturation(buffer: OptimizedBuffer, cellMask?: Float32Array, strength?: number): void;
/**
 * Applies a bloom effect based on bright areas (Simplified).
 */
export declare class BloomEffect {
    private _threshold;
    private _strength;
    private _radius;
    constructor(threshold?: number, strength?: number, radius?: number);
    set threshold(newThreshold: number);
    get threshold(): number;
    set strength(newStrength: number);
    get strength(): number;
    set radius(newRadius: number);
    get radius(): number;
    apply(buffer: OptimizedBuffer): void;
}
