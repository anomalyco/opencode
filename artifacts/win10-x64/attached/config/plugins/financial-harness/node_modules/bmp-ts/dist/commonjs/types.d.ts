/// <reference types="node" />
export declare enum BmpCompression {
    NONE = 0,
    BI_RLE8 = 1,
    BI_RLE4 = 2,
    BI_BIT_FIELDS = 3,
    BI_ALPHA_BIT_FIELDS = 6
}
export interface BmpColor {
    red: number;
    green: number;
    blue: number;
    quad: number;
}
export interface BmpDecoderOptions {
    toRGBA?: boolean;
}
export interface BmpImage {
    width: number;
    height: number;
    data: Buffer;
    flag?: string;
    fileSize?: number;
    /**
     * Used to store extra data or information in the image file structure that isn't typically used or necessary for interpreting the basic image data. These reserved fields are often set to ﻿0 when not used. They are each two bytes in size. If the programmer or software uses these for specific purposes, it should be documented accordingly.
     */
    reserved1?: number;
    /**
     * Used to store extra data or information in the image file structure that isn't typically used or necessary for interpreting the basic image data. These reserved fields are often set to ﻿0 when not used. They are each two bytes in size. If the programmer or software uses these for specific purposes, it should be documented accordingly.
     */
    reserved2?: number;
    offset?: number;
    headerSize?: number;
    planes?: number;
    bitPP?: number;
    compression?: BmpCompression;
    rawSize?: number;
    /**
     * The hr value is used to store information about the intended pixel density of the image when printed or displayed. It doesn't directly influence how the image is displayed on the screen, as screens don't usually have the ability to adjust their pixel density
     */
    hr?: number;
    /**
     * Signifies the vertical resolution of the image in pixels per meter. This value is meant to store information about the targeted pixel density of the image when it is displayed or printed.
     */
    vr?: number;
    /**
     * represents the number of color indexes in the color table actually used by the bitmap. This value is stored as a 4-byte field.
     * For a ﻿24-bit bitmap, the ﻿colors field will be ﻿0, as each pixel is defined by explicit Red, Green, and Blue values, making a color table unnecessary.
     * However, for less than ﻿24-bit bitmaps (like ﻿1-bit, ﻿4-bit, ﻿8-bit), the value of the field specifies how many colors are used. For example, an ﻿8-bit bitmap can display up to ﻿256 different colors. If all possible colors are utilized, this field will be ﻿256.
     * When the ﻿colors field is ﻿0 in these situations, it means that the maximum number of colors for the given bits-per-pixel (﻿bitPP) value are used. For instance, if an ﻿8-bit bitmap has ﻿colors set to ﻿0, it means it uses ﻿256 colors.
     * In cases where the bitmap contains a color palette but doesn't use all the potential colors, the ﻿colors field would contain the actual number of colors used in the palette.
     */
    colors?: number;
    /**
     * specifies the number of color indexes in the color table that are considered important for displaying the bitmap. This value is stored as a 4-byte field.
     * If this value is ﻿0, then all colors are considered important. This is often the case for most bitmaps.
     * This field has significance for devices with limited color display capabilities. If the device cannot display the full range of colors in the bitmap, it will refer to the ﻿importantColors field to decide which colors to prioritize. However, in modern systems with sophisticated color capabilities, this field is often disregarded.
     */
    importantColors?: number;
    /**
     * A palette, in the context of the Bitmap (BMP) image file format, is a table that defines the colors that are used in the image. This feature is typically used in images that have less than 24 bits per pixel (bitPP).
     * The palette follows the ﻿BITMAPINFOHEADER or ﻿BITMAPV4HEADER (or similar) structure and precedes the actual pixel data in the file. Each entry in the palette corresponds to a single color, using either 3 bytes (R, G, B) or 4 bytes (R, G, B, 0) in the RGB color space.
     * For 1-bit images, the palette has 2 colors, for 4-bit images, the palette has 16 colors, and for an 8-bit image, the palette can contain up to 256 colors. The actual number of colors used in the palette is identified by the ﻿colors (﻿biClrUsed) field in the header.
     * For 24-bit and 32-bit BMP, where each pixel is described by distinct R, G, and B (and potentially alpha) values, a palette isn't used or needed.
     */
    palette?: BmpColor[];
}
