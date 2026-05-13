import { z } from "zod/v4";
export declare const imageGenerationArgsSchema: z.ZodObject<{
    background: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        opaque: "opaque";
        transparent: "transparent";
    }>>;
    inputFidelity: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
    }>>;
    inputImageMask: z.ZodOptional<z.ZodObject<{
        fileId: z.ZodOptional<z.ZodString>;
        imageUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    model: z.ZodOptional<z.ZodString>;
    moderation: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
    }>>;
    outputCompression: z.ZodOptional<z.ZodNumber>;
    outputFormat: z.ZodOptional<z.ZodEnum<{
        jpeg: "jpeg";
        png: "png";
        webp: "webp";
    }>>;
    partialImages: z.ZodOptional<z.ZodNumber>;
    quality: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        high: "high";
        low: "low";
        medium: "medium";
    }>>;
    size: z.ZodOptional<z.ZodEnum<{
        "1024x1024": "1024x1024";
        "1024x1536": "1024x1536";
        "1536x1024": "1536x1024";
        auto: "auto";
    }>>;
}, z.core.$strict>;
export declare const imageGenerationOutputSchema: z.ZodObject<{
    result: z.ZodString;
}, z.core.$strip>;
type ImageGenerationArgs = {
    /**
     * Background type for the generated image. Default is 'auto'.
     */
    background?: "auto" | "opaque" | "transparent";
    /**
     * Input fidelity for the generated image. Default is 'low'.
     */
    inputFidelity?: "low" | "high";
    /**
     * Optional mask for inpainting.
     * Contains image_url (string, optional) and file_id (string, optional).
     */
    inputImageMask?: {
        /**
         * File ID for the mask image.
         */
        fileId?: string;
        /**
         * Base64-encoded mask image.
         */
        imageUrl?: string;
    };
    /**
     * The image generation model to use. Default: gpt-image-1.
     */
    model?: string;
    /**
     * Moderation level for the generated image. Default: auto.
     */
    moderation?: "auto";
    /**
     * Compression level for the output image. Default: 100.
     */
    outputCompression?: number;
    /**
     * The output format of the generated image. One of png, webp, or jpeg.
     * Default: png
     */
    outputFormat?: "png" | "jpeg" | "webp";
    /**
     * Number of partial images to generate in streaming mode, from 0 (default value) to 3.
     */
    partialImages?: number;
    /**
     * The quality of the generated image.
     * One of low, medium, high, or auto. Default: auto.
     */
    quality?: "auto" | "low" | "medium" | "high";
    /**
     * The size of the generated image.
     * One of 1024x1024, 1024x1536, 1536x1024, or auto.
     * Default: auto.
     */
    size?: "auto" | "1024x1024" | "1024x1536" | "1536x1024";
};
export declare const imageGeneration: (args?: ImageGenerationArgs) => import("@ai-sdk/provider-utils").Tool<{}, {
    /**
     * The generated image encoded in base64.
     */
    result: string;
}>;
export {};
