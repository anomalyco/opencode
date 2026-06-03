/// <reference types="node" />
/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * pointContainer.ts - part of Image Quantization Library
 */
import { Point } from './point';
/**
 * v8 optimizations done.
 * fromXXX methods are static to move out polymorphic code from class instance itself.
 */
export declare class PointContainer {
    private readonly _pointArray;
    private _width;
    private _height;
    constructor();
    getWidth(): number;
    getHeight(): number;
    setWidth(width: number): void;
    setHeight(height: number): void;
    getPointArray(): Point[];
    clone(): PointContainer;
    toUint32Array(): Uint32Array;
    toUint8Array(): Uint8Array;
    static fromHTMLImageElement(img: HTMLImageElement): PointContainer;
    static fromHTMLCanvasElement(canvas: HTMLCanvasElement): PointContainer;
    static fromImageData(imageData: ImageData): PointContainer;
    static fromUint8Array(uint8Array: number[] | Uint8Array | Uint8ClampedArray, width: number, height: number): PointContainer;
    static fromUint32Array(uint32Array: Uint32Array, width: number, height: number): PointContainer;
    static fromBuffer(buffer: Buffer, width: number, height: number): PointContainer;
}
//# sourceMappingURL=pointContainer.d.ts.map