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
export class PNGQuant extends AbstractDistanceCalculator {
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
  calculateRaw(
    r1: number,
    g1: number,
    b1: number,
    a1: number,
    r2: number,
    g2: number,
    b2: number,
    a2: number,
  ) {
    const alphas = (a2 - a1) * this._whitePoint.a;
    return (
      this._colordifferenceCh(
        r1 * this._whitePoint.r,
        r2 * this._whitePoint.r,
        alphas,
      ) +
      this._colordifferenceCh(
        g1 * this._whitePoint.g,
        g2 * this._whitePoint.g,
        alphas,
      ) +
      this._colordifferenceCh(
        b1 * this._whitePoint.b,
        b2 * this._whitePoint.b,
        alphas,
      )
    );
  }

  private _colordifferenceCh(x: number, y: number, alphas: number) {
    // maximum of channel blended on white, and blended on black
    // premultiplied alpha and backgrounds 0/1 shorten the formula
    const black = x - y;
    const white = black + alphas;

    return black * black + white * white;
  }

  protected _setDefaults() {}
}
