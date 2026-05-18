/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * palette.ts - part of Image Quantization Library
 */

import { Point } from './point';
import { PointContainer } from './pointContainer';
import { AbstractDistanceCalculator } from '../distance/distanceCalculator';
import { rgb2hsl } from '../conversion/rgb2hsl';

// TODO: make paletteArray via pointContainer, so, export will be available via pointContainer.exportXXX

const hueGroups = 10;

export function hueGroup(hue: number, segmentsNumber: number) {
  const maxHue = 360;
  const seg = maxHue / segmentsNumber;
  const half = seg / 2;

  for (let i = 1, mid = seg - half; i < segmentsNumber; i++, mid += seg) {
    if (hue >= mid && hue < mid + seg) return i;
  }
  return 0;
}

export class Palette {
  private readonly _pointContainer: PointContainer;
  private readonly _pointArray: Point[] = [];
  private _i32idx: { [key: string]: number } = {};

  constructor() {
    this._pointContainer = new PointContainer();
    this._pointContainer.setHeight(1);
    this._pointArray = this._pointContainer.getPointArray();
  }

  add(color: Point) {
    this._pointArray.push(color);
    this._pointContainer.setWidth(this._pointArray.length);
  }

  has(color: Point) {
    for (let i = this._pointArray.length - 1; i >= 0; i--) {
      if (color.uint32 === this._pointArray[i].uint32) return true;
    }

    return false;
  }

  // TOTRY: use HUSL - http://boronine.com/husl/ http://www.husl-colors.org/ https://github.com/husl-colors/husl
  getNearestColor(
    colorDistanceCalculator: AbstractDistanceCalculator,
    color: Point,
  ) {
    return this._pointArray[
      this._getNearestIndex(colorDistanceCalculator, color) | 0
    ];
  }

  getPointContainer() {
    return this._pointContainer;
  }

  // TOTRY: use HUSL - http://boronine.com/husl/
  /*
   public nearestIndexByUint32(i32) {
   var idx : number = this._nearestPointFromCache("" + i32);
   if (idx >= 0) return idx;

   var min = 1000,
   rgb = [
   (i32 & 0xff),
   (i32 >>> 8) & 0xff,
   (i32 >>> 16) & 0xff,
   (i32 >>> 24) & 0xff
   ],
   len = this._pointArray.length;

   idx = 0;
   for (var i = 0; i < len; i++) {
   var dist = Utils.distEuclidean(rgb, this._pointArray[i].rgba);

   if (dist < min) {
   min = dist;
   idx = i;
   }
   }

   this._i32idx[i32] = idx;
   return idx;
   }
   */

  private _nearestPointFromCache(key: string) {
    return typeof this._i32idx[key] === 'number' ? this._i32idx[key] : -1;
  }

  private _getNearestIndex(
    colorDistanceCalculator: AbstractDistanceCalculator,
    point: Point,
  ) {
    let idx = this._nearestPointFromCache('' + point.uint32);
    if (idx >= 0) return idx;

    let minimalDistance = Number.MAX_VALUE;

    idx = 0;
    for (let i = 0, l = this._pointArray.length; i < l; i++) {
      const p = this._pointArray[i];
      const distance = colorDistanceCalculator.calculateRaw(
        point.r,
        point.g,
        point.b,
        point.a,
        p.r,
        p.g,
        p.b,
        p.a,
      );

      if (distance < minimalDistance) {
        minimalDistance = distance;
        idx = i;
      }
    }

    this._i32idx[point.uint32] = idx;
    return idx;
  }

  /*
   public reduce(histogram : ColorHistogram, colors : number) {
   if (this._pointArray.length > colors) {
   var idxi32 = histogram.getImportanceSortedColorsIDXI32();

   // quantize histogram to existing palette
   var keep = [], uniqueColors = 0, idx, pruned = false;

   for (var i = 0, len = idxi32.length; i < len; i++) {
   // palette length reached, unset all remaining colors (sparse palette)
   if (uniqueColors >= colors) {
   this.prunePal(keep);
   pruned = true;
   break;
   } else {
   idx = this.nearestIndexByUint32(idxi32[i]);
   if (keep.indexOf(idx) < 0) {
   keep.push(idx);
   uniqueColors++;
   }
   }
   }

   if (!pruned) {
   this.prunePal(keep);
   }
   }
   }

   // TODO: check usage, not tested!
   public prunePal(keep : number[]) {
   var colors = this._pointArray.length;
   for (var colorIndex = colors - 1; colorIndex >= 0; colorIndex--) {
   if (keep.indexOf(colorIndex) < 0) {

   if(colorIndex + 1 < colors) {
   this._pointArray[ colorIndex ] = this._pointArray [ colors - 1 ];
   }
   --colors;
   //this._pointArray[colorIndex] = null;
   }
   }
   console.log("colors pruned: " + (this._pointArray.length - colors));
   this._pointArray.length = colors;
   this._i32idx = {};
   }
   */

  // TODO: group very low lum and very high lum colors
  // TODO: pass custom sort order
  // TODO: sort criteria function should be placed to HueStats class
  sort() {
    this._i32idx = {};
    this._pointArray.sort((a: Point, b: Point) => {
      const hslA = rgb2hsl(a.r, a.g, a.b);
      const hslB = rgb2hsl(b.r, b.g, b.b);

      // sort all grays + whites together
      const hueA =
        a.r === a.g && a.g === a.b ? 0 : 1 + hueGroup(hslA.h, hueGroups);
      const hueB =
        b.r === b.g && b.g === b.b ? 0 : 1 + hueGroup(hslB.h, hueGroups);
      /*
       var hueA = (a.r === a.g && a.g === a.b) ? 0 : 1 + Utils.hueGroup(hslA.h, hueGroups);
       var hueB = (b.r === b.g && b.g === b.b) ? 0 : 1 + Utils.hueGroup(hslB.h, hueGroups);
       */

      const hueDiff = hueB - hueA;
      if (hueDiff) return -hueDiff;

      /*
       var lumDiff = Utils.lumGroup(+hslB.l.toFixed(2)) - Utils.lumGroup(+hslA.l.toFixed(2));
       if (lumDiff) return -lumDiff;
       */
      const lA = a.getLuminosity(true);
      const lB = b.getLuminosity(true);

      if (lB - lA !== 0) return lB - lA;

      const satDiff = ((hslB.s * 100) | 0) - ((hslA.s * 100) | 0);
      if (satDiff) return -satDiff;

      return 0;
    });
  }
}
