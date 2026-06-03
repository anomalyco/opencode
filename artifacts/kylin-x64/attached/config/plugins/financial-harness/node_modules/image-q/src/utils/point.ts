/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * point.ts - part of Image Quantization Library
 */
import { Y } from '../constants/bt709';

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
export class Point implements PointRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
  uint32: number;
  rgba: number[]; // TODO: better name is quadruplet or quad may be?
  // Lab : { L : number; a : number; b : number };

  static createByQuadruplet(quadruplet: number[]) {
    const point = new Point();

    point.r = quadruplet[0] | 0;
    point.g = quadruplet[1] | 0;
    point.b = quadruplet[2] | 0;
    point.a = quadruplet[3] | 0;
    point._loadUINT32();
    point._loadQuadruplet();
    // point._loadLab();
    return point;
  }

  static createByRGBA(red: number, green: number, blue: number, alpha: number) {
    const point = new Point();

    point.r = red | 0;
    point.g = green | 0;
    point.b = blue | 0;
    point.a = alpha | 0;
    point._loadUINT32();
    point._loadQuadruplet();
    // point._loadLab();
    return point;
  }

  static createByUint32(uint32: number) {
    const point = new Point();

    point.uint32 = uint32 >>> 0;
    point._loadRGBA();
    point._loadQuadruplet();
    // point._loadLab();
    return point;
  }

  constructor() {
    this.uint32 = -1 >>> 0;
    this.r = this.g = this.b = this.a = 0;
    this.rgba = new Array(4);
    this.rgba[0] = 0;
    this.rgba[1] = 0;
    this.rgba[2] = 0;
    this.rgba[3] = 0;
    /*
     this.Lab = {
     L : 0.0,
     a : 0.0,
     b : 0.0
     };
     */
  }

  from(point: Point) {
    this.r = point.r;
    this.g = point.g;
    this.b = point.b;
    this.a = point.a;
    this.uint32 = point.uint32;
    this.rgba[0] = point.r;
    this.rgba[1] = point.g;
    this.rgba[2] = point.b;
    this.rgba[3] = point.a;

    /*
     this.Lab.L = point.Lab.L;
     this.Lab.a = point.Lab.a;
     this.Lab.b = point.Lab.b;
     */
  }

  /*
   * TODO:
   Luminance from RGB:

   Luminance (standard for certain colour spaces): (0.2126*R + 0.7152*G + 0.0722*B) [1]
   Luminance (perceived option 1): (0.299*R + 0.587*G + 0.114*B) [2]
   Luminance (perceived option 2, slower to calculate):  sqrt( 0.241*R^2 + 0.691*G^2 + 0.068*B^2 ) ? sqrt( 0.299*R^2 + 0.587*G^2 + 0.114*B^2 ) (thanks to @MatthewHerbst) [http://alienryderflex.com/hsp.html]
   */
  getLuminosity(useAlphaChannel: boolean) {
    let r = this.r;
    let g = this.g;
    let b = this.b;

    if (useAlphaChannel) {
      r = Math.min(255, 255 - this.a + (this.a * r) / 255);
      g = Math.min(255, 255 - this.a + (this.a * g) / 255);
      b = Math.min(255, 255 - this.a + (this.a * b) / 255);
    }

    // var luma = this.r * Point._RED_COEFFICIENT + this.g * Point._GREEN_COEFFICIENT + this.b * Point._BLUE_COEFFICIENT;

    /*
     if(useAlphaChannel) {
     luma = (luma * (255 - this.a)) / 255;
     }
     */

    return r * Y.RED + g * Y.GREEN + b * Y.BLUE;
  }

  private _loadUINT32() {
    this.uint32 =
      ((this.a << 24) | (this.b << 16) | (this.g << 8) | this.r) >>> 0;
  }

  private _loadRGBA() {
    this.r = this.uint32 & 0xff;
    this.g = (this.uint32 >>> 8) & 0xff;
    this.b = (this.uint32 >>> 16) & 0xff;
    this.a = (this.uint32 >>> 24) & 0xff;
  }

  private _loadQuadruplet() {
    this.rgba[0] = this.r;
    this.rgba[1] = this.g;
    this.rgba[2] = this.b;
    this.rgba[3] = this.a;

    /*
     var xyz = rgb2xyz(this.r, this.g, this.b);
     var lab = xyz2lab(xyz.x, xyz.y, xyz.z);
     this.lab.l = lab.l;
     this.lab.a = lab.a;
     this.lab.b = lab.b;
     */
  }

  /*
   private _loadLab() : void {
   var Lab = Color.Conversion.rgb2lab(this.r, this.g, this.b);
   this.Lab.L = Lab.L;
   this.Lab.a = Lab.a;
   this.Lab.b = Lab.b;
   }
   */
}
