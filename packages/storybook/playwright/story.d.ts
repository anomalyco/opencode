import { expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
export { expect };
export declare const story: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & {
    mount: (id: string, options?: {
        args?: Record<string, string | boolean> | undefined;
        globals?: Record<string, string> | undefined;
    } | undefined) => Promise<Locator>;
}, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions>;
