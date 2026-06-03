/// <reference types="node" resolution-mode="require"/>
import BmpDecoder from './decoder.js';
import BmpEncoder from './encoder.js';
import { BmpDecoderOptions, BmpImage } from './types.js';
export declare function decode(bmpData: Buffer, options?: BmpDecoderOptions): BmpDecoder;
export declare function encode(imgData: BmpImage): BmpEncoder;
export * from './types.js';
