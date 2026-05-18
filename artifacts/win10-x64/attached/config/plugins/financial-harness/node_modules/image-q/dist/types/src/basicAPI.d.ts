import { PointContainer } from './utils/pointContainer';
import { Palette } from './utils/palette';
export declare type ColorDistanceFormula = 'cie94-textiles' | 'cie94-graphic-arts' | 'ciede2000' | 'color-metric' | 'euclidean' | 'euclidean-bt709-noalpha' | 'euclidean-bt709' | 'manhattan' | 'manhattan-bt709' | 'manhattan-nommyde' | 'pngquant';
export declare type PaletteQuantization = 'neuquant' | 'neuquant-float' | 'rgbquant' | 'wuquant';
export declare type ImageQuantization = 'nearest' | 'riemersma' | 'floyd-steinberg' | 'false-floyd-steinberg' | 'stucki' | 'atkinson' | 'jarvis' | 'burkes' | 'sierra' | 'two-sierra' | 'sierra-lite';
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
export declare function buildPaletteSync(images: PointContainer[], { colorDistanceFormula, paletteQuantization, colors, }?: BuildPaletteOptions): Palette;
export declare function buildPalette(images: PointContainer[], { colorDistanceFormula, paletteQuantization, colors, onProgress, }?: BuildPaletteOptions & ProgressOptions): Promise<Palette>;
export declare function applyPaletteSync(image: PointContainer, palette: Palette, { colorDistanceFormula, imageQuantization }?: ApplyPaletteOptions): PointContainer;
export declare function applyPalette(image: PointContainer, palette: Palette, { colorDistanceFormula, imageQuantization, onProgress, }?: ApplyPaletteOptions & ProgressOptions): Promise<PointContainer>;
//# sourceMappingURL=basicAPI.d.ts.map