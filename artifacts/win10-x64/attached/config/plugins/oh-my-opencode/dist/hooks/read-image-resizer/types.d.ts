export interface ImageDimensions {
    width: number;
    height: number;
}
export interface ImageAttachment {
    mime: string;
    url: string;
    filename?: string;
}
export interface ResizeResult {
    resizedDataUrl: string;
    original: ImageDimensions;
    resized: ImageDimensions;
}
