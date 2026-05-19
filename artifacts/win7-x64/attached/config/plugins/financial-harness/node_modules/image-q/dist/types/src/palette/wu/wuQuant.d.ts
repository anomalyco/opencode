import { PointContainer } from '../../utils/pointContainer';
import { AbstractDistanceCalculator } from '../../distance/distanceCalculator';
import { AbstractPaletteQuantizer } from '../paletteQuantizer';
import { PaletteQuantizerYieldValue } from '../paletteQuantizerYieldValue';
export declare class WuColorCube {
    redMinimum: number;
    redMaximum: number;
    greenMinimum: number;
    greenMaximum: number;
    blueMinimum: number;
    blueMaximum: number;
    volume: number;
    alphaMinimum: number;
    alphaMaximum: number;
}
export declare class WuQuant extends AbstractPaletteQuantizer {
    private static readonly _alpha;
    private static readonly _red;
    private static readonly _green;
    private static readonly _blue;
    private _reds;
    private _greens;
    private _blues;
    private _alphas;
    private _sums;
    private _weights;
    private _momentsRed;
    private _momentsGreen;
    private _momentsBlue;
    private _momentsAlpha;
    private _moments;
    private _table;
    private _pixels;
    private _cubes;
    private _colors;
    private _significantBitsPerChannel;
    private _maxSideIndex;
    private _alphaMaxSideIndex;
    private _sideSize;
    private _alphaSideSize;
    private readonly _distance;
    constructor(colorDistanceCalculator: AbstractDistanceCalculator, colors?: number, significantBitsPerChannel?: number);
    sample(image: PointContainer): void;
    quantize(): Generator<PaletteQuantizerYieldValue, void, undefined>;
    private _preparePalette;
    private _addColor;
    /**
     * Converts the histogram to a series of _moments.
     */
    private _calculateMoments;
    /**
     * Computes the volume of the cube in a specific moment.
     */
    private static _volumeFloat;
    /**
     * Computes the volume of the cube in a specific moment.
     */
    private static _volume;
    /**
     * Splits the cube in given position][and color direction.
     */
    private static _top;
    /**
     * Splits the cube in a given color direction at its minimum.
     */
    private static _bottom;
    /**
     * Calculates statistical variance for a given cube.
     */
    private _calculateVariance;
    /**
     * Finds the optimal (maximal) position for the cut.
     */
    private _maximize;
    private _cut;
    private _initialize;
    private _setQuality;
}
//# sourceMappingURL=wuQuant.d.ts.map