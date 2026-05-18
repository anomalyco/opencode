export interface PointRGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}
/**
 * v8 optimized class
 * 1) "constructor" should have initialization with worst types
 * 2) "set" should have |0 / >>> 0
 */
export declare class Point implements PointRGBA {
    r: number;
    g: number;
    b: number;
    a: number;
    uint32: number;
    rgba: number[];
    static createByQuadruplet(quadruplet: number[]): Point;
    static createByRGBA(red: number, green: number, blue: number, alpha: number): Point;
    static createByUint32(uint32: number): Point;
    constructor();
    from(point: Point): void;
    getLuminosity(useAlphaChannel: boolean): number;
    private _loadUINT32;
    private _loadRGBA;
    private _loadQuadruplet;
}
//# sourceMappingURL=point.d.ts.map