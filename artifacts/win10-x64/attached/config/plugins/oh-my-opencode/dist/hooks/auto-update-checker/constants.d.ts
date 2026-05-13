export declare const PACKAGE_NAME = "oh-my-opencode";
/**
 * All package names the canonical plugin may be published under.
 *
 * The package is published to npm as both `oh-my-opencode` (legacy canonical)
 * and `oh-my-openagent` (current canonical). Any code that *reads* an
 * installed package.json or walks up from an import path must accept both,
 * because the installed name depends on which package the user added to
 * their config. Code that *writes* continues to use {@link PACKAGE_NAME}.
 */
export declare const ACCEPTED_PACKAGE_NAMES: readonly ["oh-my-opencode", "oh-my-openagent"];
export declare const NPM_REGISTRY_URL = "https://registry.npmjs.org/-/package/oh-my-opencode/dist-tags";
export declare const NPM_FETCH_TIMEOUT = 5000;
export declare const CACHE_ROOT_DIR: string;
export declare const CACHE_DIR: string;
export declare const VERSION_FILE: string;
export declare function getWindowsAppdataDir(): string | null;
export declare function getUserConfigDir(): string;
export declare function getUserOpencodeConfig(): string;
export declare function getUserOpencodeConfigJsonc(): string;
export declare const INSTALLED_PACKAGE_JSON: string;
/**
 * Candidate paths where the installed package.json may live, in priority order.
 * Readers should try each path in order and stop on the first success.
 */
export declare const INSTALLED_PACKAGE_JSON_CANDIDATES: string[];
