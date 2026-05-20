/**
 * Returns the user-level data directory.
 * Matches OpenCode's behavior via xdg-basedir:
 * - All platforms: XDG_DATA_HOME or ~/.local/share
 *
 * Note: OpenCode uses xdg-basedir which returns ~/.local/share on ALL platforms
 * including Windows, so we match that behavior exactly.
 */
export declare function getDataDir(): string;
/**
 * Returns the OpenCode storage directory path.
 * All platforms: ~/.local/share/opencode/storage
 */
export declare function getOpenCodeStorageDir(): string;
/**
 * Returns the user-level cache directory.
 * Matches OpenCode's behavior via xdg-basedir:
 * - All platforms: XDG_CACHE_HOME or ~/.cache
 */
export declare function getCacheDir(): string;
/**
 * Returns the oh-my-opencode cache directory.
 * All platforms: ~/.cache/oh-my-opencode
 */
export declare function getOmoOpenCodeCacheDir(): string;
/**
 * Returns the OpenCode cache directory (for reading OpenCode's cache).
 * All platforms: ~/.cache/opencode
 */
export declare function getOpenCodeCacheDir(): string;
