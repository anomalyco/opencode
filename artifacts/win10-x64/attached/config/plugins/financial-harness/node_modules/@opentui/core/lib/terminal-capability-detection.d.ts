/**
 * Terminal capability response detection utilities.
 *
 * Detects various terminal capability response sequences:
 * - DECRPM (DEC Request Mode): ESC[?...;N$y where N is 0,1,2,3,4
 * - CPR (Cursor Position Report): ESC[row;colR (used for width detection)
 * - XTVersion: ESC P >| ... ESC \
 * - Kitty Graphics: ESC _ G ... ESC \
 * - Kitty Keyboard Query: ESC[?Nu where N is 0,1,2,etc
 * - DA1 (Device Attributes): ESC[?...c
 * - Pixel Resolution: ESC[4;height;widtht
 */
/**
 * Check if a sequence is a terminal capability response.
 * Returns true if the sequence matches any known capability response pattern.
 */
export declare function isCapabilityResponse(sequence: string): boolean;
/**
 * Check if a sequence is a pixel resolution response.
 * Format: ESC[4;height;widtht
 */
export declare function isPixelResolutionResponse(sequence: string): boolean;
/**
 * Parse pixel resolution from response sequence.
 * Returns { width, height } or null if not a valid resolution response.
 */
export declare function parsePixelResolution(sequence: string): {
    width: number;
    height: number;
} | null;
