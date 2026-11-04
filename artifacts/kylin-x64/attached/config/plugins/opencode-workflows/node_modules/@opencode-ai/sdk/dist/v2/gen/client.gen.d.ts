import { type ClientOptions, type Config } from "./client/index.js";
import type { ClientOptions as ClientOptions2 } from "./types.gen.js";
/**
 * The `createClientConfig()` function will be called on client initialization
 * and the returned object will become the client's initial configuration.
 *
 * You may want to initialize your client this way instead of calling
 * `setConfig()`. This is useful for example if you're using Next.js
 * to ensure your client always has the correct values.
 */
export type CreateClientConfig<T extends ClientOptions = ClientOptions2> = (override?: Config<ClientOptions & T>) => Config<Required<ClientOptions> & T>;
export declare const client: import("./client/types.gen.js").Client;
