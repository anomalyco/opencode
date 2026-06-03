export declare function needsConversion(mimeType: string): boolean;
export declare function convertImageToJpeg(inputPath: string, mimeType: string): string;
export declare function cleanupConvertedImage(filePath: string): void;
export declare function convertBase64ImageToJpeg(base64Data: string, mimeType: string): {
    base64: string;
    tempFiles: string[];
};
