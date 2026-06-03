/*
 * Copyright (c) 2015, Leon Sorokin
 * All rights reserved. (MIT Licensed)
 *
 * ColorHistogram.js - an image quantization lib
 */

/**
 * @preserve TypeScript port:
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * colorHistogram.ts - part of Image Quantization Library
 */
import { HueStatistics } from '../../utils/hueStatistics';
import { PointContainer } from '../../utils/pointContainer';
import { stableSort } from '../../utils/arithmetic';

interface Box {
  x: number;
  y: number;
  h: number;
  w: number;
}

export class ColorHistogram {
  private static _boxSize = [64, 64];
  private static _boxPixels = 2;
  private static _hueGroups = 10;

  // 1 = by global population, 2 = subregion population threshold
  private _method: number;

  // HueStatistics instance
  private _hueStats: HueStatistics;

  private _histogram: { [color: string]: number };

  // # of highest-frequency colors to start with for palette reduction
  private _initColors: number;

  // if > 0, enables hues stats and min-color retention per group
  private _minHueCols: number;

  constructor(method: number, colors: number) {
    // 1 = by global population, 2 = subregion population threshold
    this._method = method;

    // if > 0, enables hues stats and min-color retention per group
    this._minHueCols = colors << 2; // opts.minHueCols || 0;

    // # of highest-frequency colors to start with for palette reduction
    this._initColors = colors << 2;

    // HueStatistics instance
    this._hueStats = new HueStatistics(
      ColorHistogram._hueGroups,
      this._minHueCols,
    );

    this._histogram = Object.create(null);
  }

  sample(pointContainer: PointContainer) {
    switch (this._method) {
      case 1:
        this._colorStats1D(pointContainer);
        break;
      case 2:
        this._colorStats2D(pointContainer);
        break;
    }
  }

  getImportanceSortedColorsIDXI32() {
    // TODO: fix typing issue in stableSort func
    const sorted = stableSort(
      Object.keys(this._histogram),
      (a, b) => this._histogram[b] - this._histogram[a],
    );
    if (sorted.length === 0) {
      return [];
    }

    let idxi32;
    switch (this._method) {
      case 1:
        const initialColorsLimit = Math.min(sorted.length, this._initColors);
        const last = sorted[initialColorsLimit - 1];
        const freq = this._histogram[last];

        idxi32 = sorted.slice(0, initialColorsLimit);

        // add any cut off colors with same freq as last
        let pos = initialColorsLimit;
        const len = sorted.length;
        while (pos < len && this._histogram[sorted[pos]] === freq) {
          idxi32.push(sorted[pos++]);
        }

        // inject min huegroup colors
        this._hueStats.injectIntoArray(idxi32);
        break;

      case 2:
        idxi32 = sorted;
        break;

      default:
        // TODO: rethink errors
        throw new Error('Incorrect method');
    }

    // int32-ify values
    return idxi32.map((v) => +v);
  }

  // global top-population
  private _colorStats1D(pointContainer: PointContainer) {
    const histG = this._histogram;
    const pointArray = pointContainer.getPointArray();
    const len = pointArray.length;

    for (let i = 0; i < len; i++) {
      const col = pointArray[i].uint32;

      // collect hue stats
      this._hueStats.check(col);

      if (col in histG) {
        histG[col]++;
      } else {
        histG[col] = 1;
      }
    }
  }

  // population threshold within subregions
  // FIXME: this can over-reduce (few/no colors same?), need a way to keep
  // important colors that dont ever reach local thresholds (gradients?)
  private _colorStats2D(pointContainer: PointContainer) {
    const width = pointContainer.getWidth();
    const height = pointContainer.getHeight();
    const pointArray = pointContainer.getPointArray();

    const boxW = ColorHistogram._boxSize[0];
    const boxH = ColorHistogram._boxSize[1];
    const area = boxW * boxH;
    const boxes = this._makeBoxes(width, height, boxW, boxH);
    const histG = this._histogram;

    boxes.forEach((box) => {
      let effc = Math.round((box.w * box.h) / area) * ColorHistogram._boxPixels;
      if (effc < 2) effc = 2;

      const histL: Record<string, number> = {};
      this._iterateBox(box, width, (i) => {
        const col = pointArray[i].uint32;

        // collect hue stats
        this._hueStats.check(col);

        if (col in histG) {
          histG[col]++;
        } else if (col in histL) {
          if (++histL[col] >= effc) {
            histG[col] = histL[col];
          }
        } else {
          histL[col] = 1;
        }
      });
    });

    // inject min huegroup colors
    this._hueStats.injectIntoDictionary(histG);
  }

  // iterates @bbox within a parent rect of width @wid; calls @fn, passing index within parent
  private _iterateBox(bbox: Box, wid: number, fn: (i: number) => void) {
    const b = bbox;
    const i0 = b.y * wid + b.x;
    const i1 = (b.y + b.h - 1) * wid + (b.x + b.w - 1);
    const incr = wid - b.w + 1;

    let cnt = 0;
    let i = i0;

    do {
      fn.call(this, i);
      i += ++cnt % b.w === 0 ? incr : 1;
    } while (i <= i1);
  }

  /**
   *    partitions a rectangle of width x height into
   *    array of boxes stepX x stepY (or less)
   */
  private _makeBoxes(
    width: number,
    height: number,
    stepX: number,
    stepY: number,
  ) {
    const wrem = width % stepX;
    const hrem = height % stepY;
    const xend = width - wrem;
    const yend = height - hrem;
    const boxesArray = [];

    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        boxesArray.push({
          x,
          y,
          w: x === xend ? wrem : stepX,
          h: y === yend ? hrem : stepY,
        });
      }
    }

    return boxesArray;
  }
}
