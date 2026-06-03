/// <reference types="node" />
import { BmpColor, BmpImage } from './types.js';
export default class BmpEncoder implements BmpImage {
    readonly fileSize: number;
    readonly reserved1: number;
    readonly reserved2: number;
    readonly offset: number;
    readonly width: number;
    readonly flag: string;
    readonly height: number;
    readonly planes: number;
    readonly bitPP: number;
    readonly compress: number;
    readonly hr: number;
    readonly vr: number;
    readonly colors: number;
    readonly importantColors: number;
    readonly rawSize: number;
    readonly headerSize: number;
    readonly data: Buffer;
    readonly palette: BmpColor[];
    private readonly extraBytes;
    private readonly buffer;
    private readonly bytesInColor;
    private pos;
    constructor(imgData: BmpImage);
    encode(): void;
    private writeHeader;
    private bit1;
    private bit4;
    private bit8;
    private bit16;
    private bit24;
    private bit32;
    private writeImage;
    private initColors;
    private writeUInt32LE;
}
