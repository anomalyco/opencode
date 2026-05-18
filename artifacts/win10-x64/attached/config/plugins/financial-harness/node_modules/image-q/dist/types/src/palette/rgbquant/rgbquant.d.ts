import { PointContainer } from '../../utils/pointContainer';
import { AbstractDistanceCalculator } from '../../distance/distanceCalculator';
import { AbstractPaletteQuantizer } from '../paletteQuantizer';
import { PaletteQuantizerYieldValue } from '../paletteQuantizerYieldValue';
export declare class RGBQuant extends AbstractPaletteQuantizer {
    private readonly _colors;
    private readonly _initialDistance;
    private readonly _distanceIncrement;
    private readonly _histogram;
    private readonly _distance;
    constructor(colorDistanceCalculator: AbstractDistanceCalculator, colors?: number, method?: number);
    sample(image: PointContainer): void;
    quantize(): Generator<PaletteQuantizerYieldValue, void, undefined>;
    private _buildPalette;
}
//# sourceMappingURL=rgbquant.d.ts.map