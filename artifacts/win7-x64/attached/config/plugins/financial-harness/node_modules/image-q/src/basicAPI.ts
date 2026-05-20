/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * helper.ts - part of Image Quantization Library
 */
import * as distance from './distance';
import * as image from './image';
import * as palette from './palette';
import { AbstractDistanceCalculator } from './distance/distanceCalculator';
import { PointContainer } from './utils/pointContainer';
import { Palette } from './utils/palette';

const setImmediateImpl =
  typeof setImmediate === 'function'
    ? setImmediate
    : typeof process !== 'undefined' && typeof process?.nextTick === 'function'
    ? (callback: () => void) => process.nextTick(callback)
    : (callback: () => void) => setTimeout(callback, 0);

export type ColorDistanceFormula =
  | 'cie94-textiles'
  | 'cie94-graphic-arts'
  | 'ciede2000'
  | 'color-metric'
  | 'euclidean'
  | 'euclidean-bt709-noalpha'
  | 'euclidean-bt709'
  | 'manhattan'
  | 'manhattan-bt709'
  | 'manhattan-nommyde'
  | 'pngquant';

export type PaletteQuantization =
  | 'neuquant'
  | 'neuquant-float'
  | 'rgbquant'
  | 'wuquant';

export type ImageQuantization =
  | 'nearest'
  | 'riemersma'
  | 'floyd-steinberg'
  | 'false-floyd-steinberg'
  | 'stucki'
  | 'atkinson'
  | 'jarvis'
  | 'burkes'
  | 'sierra'
  | 'two-sierra'
  | 'sierra-lite';

export interface ProgressOptions {
  onProgress?: (progress: number) => void;
}

export interface ApplyPaletteOptions {
  colorDistanceFormula?: ColorDistanceFormula;
  imageQuantization?: ImageQuantization;
}

export interface BuildPaletteOptions {
  colorDistanceFormula?: ColorDistanceFormula;
  paletteQuantization?: PaletteQuantization;
  colors?: number;
}

export function buildPaletteSync(
  images: PointContainer[],
  {
    colorDistanceFormula,
    paletteQuantization,
    colors,
  }: BuildPaletteOptions = {},
) {
  const distanceCalculator =
    colorDistanceFormulaToColorDistance(colorDistanceFormula);
  const paletteQuantizer = paletteQuantizationToPaletteQuantizer(
    distanceCalculator,
    paletteQuantization,
    colors,
  );
  images.forEach((image) => paletteQuantizer.sample(image));
  return paletteQuantizer.quantizeSync();
}

export async function buildPalette(
  images: PointContainer[],
  {
    colorDistanceFormula,
    paletteQuantization,
    colors,
    onProgress,
  }: BuildPaletteOptions & ProgressOptions = {},
) {
  return new Promise<Palette>((resolve, reject) => {
    const distanceCalculator =
      colorDistanceFormulaToColorDistance(colorDistanceFormula);
    const paletteQuantizer = paletteQuantizationToPaletteQuantizer(
      distanceCalculator,
      paletteQuantization,
      colors,
    );
    images.forEach((image) => paletteQuantizer.sample(image));

    let palette: Palette;
    const iterator = paletteQuantizer.quantize();
    const next = () => {
      try {
        const result = iterator.next();
        if (result.done) {
          resolve(palette);
        } else {
          if (result.value.palette) palette = result.value.palette;
          if (onProgress) onProgress(result.value.progress);
          setImmediateImpl(next);
        }
      } catch (error) {
        reject(error);
      }
    };
    setImmediateImpl(next);
  });
}

export function applyPaletteSync(
  image: PointContainer,
  palette: Palette,
  { colorDistanceFormula, imageQuantization }: ApplyPaletteOptions = {},
) {
  const distanceCalculator =
    colorDistanceFormulaToColorDistance(colorDistanceFormula);
  const imageQuantizer = imageQuantizationToImageQuantizer(
    distanceCalculator,
    imageQuantization,
  );
  return imageQuantizer.quantizeSync(image, palette);
}

export async function applyPalette(
  image: PointContainer,
  palette: Palette,
  {
    colorDistanceFormula,
    imageQuantization,
    onProgress,
  }: ApplyPaletteOptions & ProgressOptions = {},
) {
  return new Promise<PointContainer>((resolve, reject) => {
    const distanceCalculator =
      colorDistanceFormulaToColorDistance(colorDistanceFormula);
    const imageQuantizer = imageQuantizationToImageQuantizer(
      distanceCalculator,
      imageQuantization,
    );

    let outPointContainer: PointContainer;
    const iterator = imageQuantizer.quantize(image, palette);
    const next = () => {
      try {
        const result = iterator.next();
        if (result.done) {
          resolve(outPointContainer);
        } else {
          if (result.value.pointContainer) {
            outPointContainer = result.value.pointContainer;
          }
          if (onProgress) onProgress(result.value.progress);
          setImmediateImpl(next);
        }
      } catch (error) {
        reject(error);
      }
    };
    setImmediateImpl(next);
  });
}

function colorDistanceFormulaToColorDistance(
  colorDistanceFormula: ColorDistanceFormula = 'euclidean-bt709',
) {
  switch (colorDistanceFormula) {
    case 'cie94-graphic-arts':
      return new distance.CIE94GraphicArts();
    case 'cie94-textiles':
      return new distance.CIE94Textiles();
    case 'ciede2000':
      return new distance.CIEDE2000();
    case 'color-metric':
      return new distance.CMetric();
    case 'euclidean':
      return new distance.Euclidean();
    case 'euclidean-bt709':
      return new distance.EuclideanBT709();
    case 'euclidean-bt709-noalpha':
      return new distance.EuclideanBT709NoAlpha();
    case 'manhattan':
      return new distance.Manhattan();
    case 'manhattan-bt709':
      return new distance.ManhattanBT709();
    case 'manhattan-nommyde':
      return new distance.ManhattanNommyde();
    case 'pngquant':
      return new distance.PNGQuant();
    default:
      throw new Error(`Unknown colorDistanceFormula ${colorDistanceFormula}`);
  }
}

function imageQuantizationToImageQuantizer(
  distanceCalculator: AbstractDistanceCalculator,
  imageQuantization: ImageQuantization = 'floyd-steinberg',
) {
  switch (imageQuantization) {
    case 'nearest':
      return new image.NearestColor(distanceCalculator);
    case 'riemersma':
      return new image.ErrorDiffusionRiemersma(distanceCalculator);
    case 'floyd-steinberg':
      return new image.ErrorDiffusionArray(
        distanceCalculator,
        image.ErrorDiffusionArrayKernel.FloydSteinberg,
      );
    case 'false-floyd-steinberg':
      return new image.ErrorDiffusionArray(
        distanceCalculator,
        image.ErrorDiffusionArrayKernel.FalseFloydSteinberg,
      );
    case 'stucki':
      return new image.ErrorDiffusionArray(
        distanceCalculator,
        image.ErrorDiffusionArrayKernel.Stucki,
      );
    case 'atkinson':
      return new image.ErrorDiffusionArray(
        distanceCalculator,
        image.ErrorDiffusionArrayKernel.Atkinson,
      );
    case 'jarvis':
      return new image.ErrorDiffusionArray(
        distanceCalculator,
        image.ErrorDiffusionArrayKernel.Jarvis,
      );
    case 'burkes':
      return new image.ErrorDiffusionArray(
        distanceCalculator,
        image.ErrorDiffusionArrayKernel.Burkes,
      );
    case 'sierra':
      return new image.ErrorDiffusionArray(
        distanceCalculator,
        image.ErrorDiffusionArrayKernel.Sierra,
      );
    case 'two-sierra':
      return new image.ErrorDiffusionArray(
        distanceCalculator,
        image.ErrorDiffusionArrayKernel.TwoSierra,
      );
    case 'sierra-lite':
      return new image.ErrorDiffusionArray(
        distanceCalculator,
        image.ErrorDiffusionArrayKernel.SierraLite,
      );
    default:
      throw new Error(`Unknown imageQuantization ${imageQuantization}`);
  }
}

function paletteQuantizationToPaletteQuantizer(
  distanceCalculator: AbstractDistanceCalculator,
  paletteQuantization: PaletteQuantization = 'wuquant',
  colors = 256,
) {
  switch (paletteQuantization) {
    case 'neuquant':
      return new palette.NeuQuant(distanceCalculator, colors);
    case 'rgbquant':
      return new palette.RGBQuant(distanceCalculator, colors);
    case 'wuquant':
      return new palette.WuQuant(distanceCalculator, colors);
    case 'neuquant-float':
      return new palette.NeuQuantFloat(distanceCalculator, colors);
    default:
      throw new Error(`Unknown paletteQuantization ${paletteQuantization}`);
  }
}
