/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * pngQuant.ts - part of Image Quantization Library
 */
import { AbstractDistanceCalculator } from './distanceCalculator';
/**
 * TODO: check quality of this distance equation
 * TODO: ask author for usage rights
 * taken from:
 * {@link http://stackoverflow.com/questions/4754506/color-similarity-distance-in-rgba-color-space/8796867#8796867}
 * {@link https://github.com/pornel/pngquant/blob/cc39b47799a7ff2ef17b529f9415ff6e6b213b8f/lib/pam.h#L148}
 */
export declare class PNGQuant extends AbstractDistanceCalculator {
    /**
     * Author's comments
     * px_b.rgb = px.rgb + 0*(1-px.a) // blend px on black
     * px_b.a   = px.a   + 1*(1-px.a)
     * px_w.rgb = px.rgb + 1*(1-px.a) // blend px on white
     * px_w.a   = px.a   + 1*(1-px.a)
     *
     * px_b.rgb = px.rgb              // difference same as in opaque RGB
     * px_b.a   = 1
     * px_w.rgb = px.rgb - px.a       // difference simplifies to formula below
     * px_w.a   = 1
     *
     * (px.rgb - px.a) - (py.rgb - py.a)
     * (px.rgb - py.rgb) + (py.a - px.a)
     *
     */
    calculateRaw(r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): number;
    private _colordifferenceCh;
    protected _setDefaults(): void;
}
//# sourceMappingURL=pngQuant.d.ts.map