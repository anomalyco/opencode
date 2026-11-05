import { URL, UrlObject } from 'url'
import { Duplex } from 'stream'
import Dispatcher from './dispatcher'

export {
  request,
  stream,
  pipeline,
  connect,
  upgrade,
}

/** Performs an HTTP request. */
declare function request(
  url: string | URL | UrlObject,
  options?: { dispatcher?: Dispatcher } & Omit<Dispatcher.RequestOptions, 'origin' | 'path' | 'method'> & Partial<Pick<Dispatcher.RequestOptions, 'method'>>,
): Promise<Dispatcher.ResponseData>;

/** A faster version of `request`. */
declare function stream(
  url: string | URL | UrlObject,
  options: { dispatcher?: Dispatcher } & Omit<Dispatcher.RequestOptions, 'origin' | 'path'>,
  factory: Dispatcher.StreamFactory
): Promise<Dispatcher.StreamData>;

/** For easy use with `stream.pipeline`. */
declare function pipeline(
  url: string | URL | UrlObject,
  options: { dispatcher?: Dispatcher } & Omit<Dispatcher.PipelineOptions, 'origin' | 'path'>,
  handler: Dispatcher.PipelineHandler
): Duplex;

/** Starts two-way communications with the requested resource. */
declare function connect(
  url: string | URL | UrlObject,
  options?: { dispatcher?: Dispatcher } & Omit<Dispatcher.ConnectOptions, 'origin' | 'path'>
): Promise<Dispatcher.ConnectData>;

/** Upgrade to a different protocol. */
declare function upgrade(
  url: string | URL | UrlObject,
  options?: { dispatcher?: Dispatcher } & Omit<Dispatcher.UpgradeOptions, 'origin' | 'path'>
): Promise<Dispatcher.UpgradeData>;
