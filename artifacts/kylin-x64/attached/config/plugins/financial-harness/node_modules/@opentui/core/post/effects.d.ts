import type { OptimizedBuffer } from "../buffer.js";
export declare class DistortionEffect {
    glitchChancePerSecond: number;
    maxGlitchLines: number;
    minGlitchDuration: number;
    maxGlitchDuration: number;
    maxShiftAmount: number;
    shiftFlipRatio: number;
    colorGlitchChance: number;
    private lastGlitchTime;
    private glitchDuration;
    private activeGlitches;
    constructor(options?: Partial<DistortionEffect>);
    /**
     * Applies the animated distortion/glitch effect to the buffer.
     */
    apply(buffer: OptimizedBuffer, deltaTime: number): void;
}
/**
 * Applies a vignette effect by darkening the corners, optimized with precomputation.
 * Uses native colorMatrix with a zero matrix for attenuation.
 */
export declare class VignetteEffect {
    private _strength;
    private precomputedAttenuationCellMask;
    private cachedWidth;
    private cachedHeight;
    private static zeroMatrix;
    constructor(strength?: number);
    set strength(newStrength: number);
    get strength(): number;
    private _computeFactors;
    /**
     * Applies the vignette effect using native colorMatrix with a zero matrix.
     * The zero matrix maps all colors to black, and the attenuation cell masks
     * control how much of the effect is applied (strength-based blending).
     */
    apply(buffer: OptimizedBuffer): void;
}
/**
 * Applies animated cloud shadows using Perlin noise.
 * Darkens the background buffer based on procedural cloud density.
 */
export declare class CloudsEffect {
    private noise;
    private _scale;
    private _speed;
    private _density;
    private _darkness;
    private time;
    constructor(scale?: number, speed?: number, density?: number, darkness?: number);
    set scale(newScale: number);
    get scale(): number;
    set speed(newSpeed: number);
    get speed(): number;
    set density(newDensity: number);
    get density(): number;
    set darkness(newDarkness: number);
    get darkness(): number;
    /**
     * Applies cloud shadow effect using Perlin noise mask with native colorMatrix.
     * Uses FBM (Fractal Brownian Motion) for detailed clouds, offloaded to native code.
     */
    apply(buffer: OptimizedBuffer, deltaTime: number): void;
}
/**
 * Applies animated flames rising from the bottom using Perlin noise.
 * Creates warm fire effect that fades as it rises.
 */
export declare class FlamesEffect {
    private noise;
    private _scale;
    private _speed;
    private _intensity;
    private time;
    constructor(scale?: number, speed?: number, intensity?: number);
    set scale(newScale: number);
    get scale(): number;
    set speed(newSpeed: number);
    get speed(): number;
    set intensity(newIntensity: number);
    get intensity(): number;
    /**
     * Applies flame effect rising from bottom using Perlin noise.
     * Flames get cooler (redder) and fade as they rise.
     */
    apply(buffer: OptimizedBuffer, deltaTime: number): void;
}
/**
 * Applies a CRT rolling bar effect - a horizontal bar that slowly scans down the screen.
 * Simulates the classic CRT monitor rolling bar artifact.
 */
export declare class CRTRollingBarEffect {
    private _speed;
    private _height;
    private _intensity;
    private _fadeDistance;
    private position;
    constructor(speed?: number, height?: number, intensity?: number, fadeDistance?: number);
    set speed(newSpeed: number);
    get speed(): number;
    set height(newHeight: number);
    get height(): number;
    set intensity(newIntensity: number);
    get intensity(): number;
    set fadeDistance(newFadeDistance: number);
    get fadeDistance(): number;
    /**
     * Applies the rolling bar effect to the buffer.
     * Creates a smooth horizontal bar that scans down the screen with a bell-curve gradient.
     * The bar has a bright center that smoothly fades to the edges.
     */
    apply(buffer: OptimizedBuffer, deltaTime: number): void;
}
/**
 * Applies animated rainbow colors to cells with white foreground.
 * Cycles through HSV hue spectrum over time.
 */
export declare class RainbowTextEffect {
    private _speed;
    private _saturation;
    private _value;
    private _repeats;
    private time;
    constructor(speed?: number, saturation?: number, value?: number, repeats?: number);
    set speed(newSpeed: number);
    get speed(): number;
    set saturation(newSaturation: number);
    get saturation(): number;
    set value(newValue: number);
    get value(): number;
    set repeats(newRepeats: number);
    get repeats(): number;
    /**
     * Converts HSV color to RGB
     * @param h - Hue [0, 1]
     * @param s - Saturation [0, 1]
     * @param v - Value [0, 1]
     * @returns [r, g, b] each in [0, 1]
     */
    private hsvToRgb;
    /**
     * Applies rainbow colors to cells with white foreground.
     * White is defined as R, G, B all >= 0.9
     */
    apply(buffer: OptimizedBuffer, deltaTime: number): void;
}
