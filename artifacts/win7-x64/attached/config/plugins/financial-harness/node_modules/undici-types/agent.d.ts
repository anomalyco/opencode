import { URL } from 'url'
import Pool from './pool'
import Dispatcher from "./dispatcher";

export default Agent

declare class Agent extends Dispatcher{
  constructor(opts?: Agent.Options)
  /** `true` after `dispatcher.close()` has been called. */
  closed: boolean;
  /** `true` after `dispatcher.destroyed()` has been called or `dispatcher.close()` has been called and the dispatcher shutdown has completed. */
  destroyed: boolean;
  /** Dispatches a request. */
  dispatch(options: Agent.DispatchOptions, handler: Dispatcher.DispatchHandlers): boolean;
}

declare namespace Agent {
  export interface Options extends Pool.Options {
    /** Default: `(origin, opts) => new Pool(origin, opts)`. */
    factory?(origin: string | URL, opts: Object): Dispatcher;
    /** Integer. Default: `0` */
    maxRedirections?: number;

    interceptors?: { Agent?: readonly Dispatcher.DispatchInterceptor[] } & Pool.Options["interceptors"]
  }

  export interface DispatchOptions extends Dispatcher.DispatchOptions {
    /** Integer. */
    maxRedirections?: number;
  }
}
