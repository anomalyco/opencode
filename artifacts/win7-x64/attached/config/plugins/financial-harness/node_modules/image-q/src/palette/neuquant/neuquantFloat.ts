/*
 * NeuQuantFloat Neural-Net Quantization Algorithm
 * ------------------------------------------
 *
 * Copyright (c) 1994 Anthony Dekker
 *
 * NEUQUANT Neural-Net quantization algorithm by Anthony Dekker, 1994. See
 * "Kohonen neural networks for optimal colour quantization" in "Network:
 * Computation in Neural Systems" Vol. 5 (1994) pp 351-367. for a discussion of
 * the algorithm.
 *
 * Any party obtaining a copy of these files from the author, directly or
 * indirectly, is granted, free of charge, a full and unrestricted irrevocable,
 * world-wide, paid up, royalty-free, nonexclusive right and license to deal in
 * this software and documentation files (the "Software"), including without
 * limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons who
 * receive copies from any such party to do so, with the only requirement being
 * that this copyright notice remain intact.
 */
/**
 * @preserve TypeScript port:
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * neuquant.ts - part of Image Quantization Library
 */
import { Palette } from '../../utils/palette';
import { Point } from '../../utils/point';
import { PointContainer } from '../../utils/pointContainer';
import { AbstractDistanceCalculator } from '../../distance/distanceCalculator';
import { AbstractPaletteQuantizer } from '../paletteQuantizer';
import { PaletteQuantizerYieldValue } from '../paletteQuantizerYieldValue';
import { ProgressTracker } from '../../utils';

// bias for colour values
const networkBiasShift = 3;

class NeuronFloat {
  r: number;
  g: number;
  b: number;
  a: number;

  constructor(defaultValue: number) {
    this.r = this.g = this.b = this.a = defaultValue;
  }

  /**
   * There is a fix in original NEUQUANT by Anthony Dekker (http://members.ozemail.com.au/~dekker/NEUQUANT.HTML)
   * @example
   * r = Math.min(255, (neuron.r + (1 << (networkBiasShift - 1))) >> networkBiasShift);
   */
  toPoint() {
    return Point.createByRGBA(
      this.r >> networkBiasShift,
      this.g >> networkBiasShift,
      this.b >> networkBiasShift,
      this.a >> networkBiasShift,
    );
  }

  subtract(r: number, g: number, b: number, a: number) {
    this.r -= r;
    this.g -= g;
    this.b -= b;
    this.a -= a;
  }
}

export class NeuQuantFloat extends AbstractPaletteQuantizer {
  /*
   four primes near 500 - assume no image has a length so large
   that it is divisible by all four primes
   */
  private static readonly _prime1 = 499;
  private static readonly _prime2 = 491;
  private static readonly _prime3 = 487;
  private static readonly _prime4 = 503;
  private static readonly _minpicturebytes = NeuQuantFloat._prime4;

  // no. of learning cycles
  private static readonly _nCycles = 100;

  // defs for freq and bias
  private static readonly _initialBiasShift = 16;

  // bias for fractions
  private static readonly _initialBias = 1 << NeuQuantFloat._initialBiasShift;
  private static readonly _gammaShift = 10;

  // gamma = 1024
  // TODO: why gamma is never used?
  // private static _gamma : number     = (1 << NeuQuantFloat._gammaShift);
  private static readonly _betaShift = 10;
  private static readonly _beta =
    NeuQuantFloat._initialBias >> NeuQuantFloat._betaShift;

  // beta = 1/1024
  private static readonly _betaGamma =
    NeuQuantFloat._initialBias <<
    (NeuQuantFloat._gammaShift - NeuQuantFloat._betaShift);

  /*
   * for 256 cols, radius starts
   */
  private static readonly _radiusBiasShift = 6;

  // at 32.0 biased by 6 bits
  private static readonly _radiusBias = 1 << NeuQuantFloat._radiusBiasShift;

  // and decreases by a factor of 1/30 each cycle
  private static readonly _radiusDecrease = 30;

  /* defs for decreasing alpha factor */

  // alpha starts at 1.0
  private static readonly _alphaBiasShift = 10;

  // biased by 10 bits
  private static readonly _initAlpha = 1 << NeuQuantFloat._alphaBiasShift;

  /* radBias and alphaRadBias used for radpower calculation */
  private static readonly _radBiasShift = 8;
  private static readonly _radBias = 1 << NeuQuantFloat._radBiasShift;
  private static readonly _alphaRadBiasShift =
    NeuQuantFloat._alphaBiasShift + NeuQuantFloat._radBiasShift;
  private static readonly _alphaRadBias = 1 << NeuQuantFloat._alphaRadBiasShift;

  private _pointArray!: Point[];
  private readonly _networkSize!: number;
  private _network!: NeuronFloat[];

  /** sampling factor 1..30 */
  private readonly _sampleFactor!: number;
  private _radPower!: number[];

  // bias and freq arrays for learning
  private _freq!: number[];

  /* for network lookup - really 256 */
  private _bias!: number[];
  private readonly _distance: AbstractDistanceCalculator;

  constructor(
    colorDistanceCalculator: AbstractDistanceCalculator,
    colors = 256,
  ) {
    super();
    this._distance = colorDistanceCalculator;
    this._pointArray = [];
    this._sampleFactor = 1;
    this._networkSize = colors;

    this._distance.setWhitePoint(
      255 << networkBiasShift,
      255 << networkBiasShift,
      255 << networkBiasShift,
      255 << networkBiasShift,
    );
  }

  sample(pointContainer: PointContainer) {
    this._pointArray = this._pointArray.concat(pointContainer.getPointArray());
  }

  *quantize() {
    this._init();
    yield* this._learn();

    yield {
      palette: this._buildPalette(),
      progress: 100,
    };
  }

  private _init() {
    this._freq = [];
    this._bias = [];
    this._radPower = [];
    this._network = [];
    for (let i = 0; i < this._networkSize; i++) {
      this._network[i] = new NeuronFloat(
        (i << (networkBiasShift + 8)) / this._networkSize,
      );

      // 1/this._networkSize
      this._freq[i] = NeuQuantFloat._initialBias / this._networkSize;
      this._bias[i] = 0;
    }
  }

  /**
   * Main Learning Loop
   */
  private *_learn(): IterableIterator<PaletteQuantizerYieldValue> {
    let sampleFactor = this._sampleFactor;

    const pointsNumber = this._pointArray.length;
    if (pointsNumber < NeuQuantFloat._minpicturebytes) sampleFactor = 1;

    const alphadec = 30 + (sampleFactor - 1) / 3;
    const pointsToSample = pointsNumber / sampleFactor;

    let delta = (pointsToSample / NeuQuantFloat._nCycles) | 0;
    let alpha = NeuQuantFloat._initAlpha;
    let radius = (this._networkSize >> 3) * NeuQuantFloat._radiusBias;

    let rad = radius >> NeuQuantFloat._radiusBiasShift;
    if (rad <= 1) rad = 0;

    for (let i = 0; i < rad; i++) {
      this._radPower[i] =
        alpha * (((rad * rad - i * i) * NeuQuantFloat._radBias) / (rad * rad));
    }

    let step;
    if (pointsNumber < NeuQuantFloat._minpicturebytes) {
      step = 1;
    } else if (pointsNumber % NeuQuantFloat._prime1 !== 0) {
      step = NeuQuantFloat._prime1;
    } else if (pointsNumber % NeuQuantFloat._prime2 !== 0) {
      step = NeuQuantFloat._prime2;
    } else if (pointsNumber % NeuQuantFloat._prime3 !== 0) {
      step = NeuQuantFloat._prime3;
    } else {
      step = NeuQuantFloat._prime4;
    }

    const tracker = new ProgressTracker(pointsToSample, 99);
    for (let i = 0, pointIndex = 0; i < pointsToSample; ) {
      if (tracker.shouldNotify(i)) {
        yield {
          progress: tracker.progress,
        };
      }

      const point = this._pointArray[pointIndex];
      const b = point.b << networkBiasShift;
      const g = point.g << networkBiasShift;
      const r = point.r << networkBiasShift;
      const a = point.a << networkBiasShift;
      const neuronIndex = this._contest(b, g, r, a);

      this._alterSingle(alpha, neuronIndex, b, g, r, a);
      if (rad !== 0) this._alterNeighbour(rad, neuronIndex, b, g, r, a);

      /* alter neighbours */
      pointIndex += step;
      if (pointIndex >= pointsNumber) pointIndex -= pointsNumber;
      i++;

      if (delta === 0) delta = 1;

      if (i % delta === 0) {
        alpha -= alpha / alphadec;
        radius -= radius / NeuQuantFloat._radiusDecrease;
        rad = radius >> NeuQuantFloat._radiusBiasShift;

        if (rad <= 1) rad = 0;
        for (let j = 0; j < rad; j++) {
          this._radPower[j] =
            alpha *
            (((rad * rad - j * j) * NeuQuantFloat._radBias) / (rad * rad));
        }
      }
    }
  }

  private _buildPalette() {
    const palette = new Palette();

    this._network.forEach((neuron) => {
      palette.add(neuron.toPoint());
    });

    palette.sort();
    return palette;
  }

  /**
   * Move adjacent neurons by precomputed alpha*(1-((i-j)^2/[r]^2)) in radpower[|i-j|]
   */
  private _alterNeighbour(
    rad: number,
    i: number,
    b: number,
    g: number,
    r: number,
    al: number,
  ) {
    let lo = i - rad;
    if (lo < -1) lo = -1;

    let hi = i + rad;
    if (hi > this._networkSize) hi = this._networkSize;

    let j = i + 1;
    let k = i - 1;
    let m = 1;

    while (j < hi || k > lo) {
      const a = this._radPower[m++] / NeuQuantFloat._alphaRadBias;
      if (j < hi) {
        const p = this._network[j++];
        p.subtract(a * (p.r - r), a * (p.g - g), a * (p.b - b), a * (p.a - al));
      }

      if (k > lo) {
        const p = this._network[k--];
        p.subtract(a * (p.r - r), a * (p.g - g), a * (p.b - b), a * (p.a - al));
      }
    }
  }

  /**
   * Move neuron i towards biased (b,g,r) by factor alpha
   */
  private _alterSingle(
    alpha: number,
    i: number,
    b: number,
    g: number,
    r: number,
    a: number,
  ) {
    alpha /= NeuQuantFloat._initAlpha;

    /* alter hit neuron */
    const n = this._network[i];
    n.subtract(
      alpha * (n.r - r),
      alpha * (n.g - g),
      alpha * (n.b - b),
      alpha * (n.a - a),
    );
  }

  /**
   * Search for biased BGR values
   * description:
   *    finds closest neuron (min dist) and updates freq
   *    finds best neuron (min dist-bias) and returns position
   *    for frequently chosen neurons, freq[i] is high and bias[i] is negative
   *    bias[i] = _gamma*((1/this._networkSize)-freq[i])
   *
   * Original distance equation:
   *        dist = abs(dR) + abs(dG) + abs(dB)
   */
  private _contest(b: number, g: number, r: number, al: number) {
    const multiplier = (255 * 4) << networkBiasShift;

    let bestd = ~(1 << 31);
    let bestbiasd = bestd;
    let bestpos = -1;
    let bestbiaspos = bestpos;

    for (let i = 0; i < this._networkSize; i++) {
      const n = this._network[i];
      const dist =
        this._distance.calculateNormalized(n, { r, g, b, a: al }) * multiplier;

      if (dist < bestd) {
        bestd = dist;
        bestpos = i;
      }

      const biasdist =
        dist -
        (this._bias[i] >> (NeuQuantFloat._initialBiasShift - networkBiasShift));
      if (biasdist < bestbiasd) {
        bestbiasd = biasdist;
        bestbiaspos = i;
      }
      const betafreq = this._freq[i] >> NeuQuantFloat._betaShift;
      this._freq[i] -= betafreq;
      this._bias[i] += betafreq << NeuQuantFloat._gammaShift;
    }
    this._freq[bestpos] += NeuQuantFloat._beta;
    this._bias[bestpos] -= NeuQuantFloat._betaGamma;
    return bestbiaspos;
  }
}
