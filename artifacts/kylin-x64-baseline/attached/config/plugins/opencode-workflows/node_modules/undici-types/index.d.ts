import Dispatcher from'./dispatcher'
import { setGlobalDispatcher, getGlobalDispatcher } from './global-dispatcher'
import { setGlobalOrigin, getGlobalOrigin } from './global-origin'
import Pool from'./pool'
import { RedirectHandler, DecoratorHandler } from './handlers'

import BalancedPool from './balanced-pool'
import Client from'./client'
import buildConnector from'./connector'
import errors from'./errors'
import Agent from'./agent'
import MockClient from'./mock-client'
import MockPool from'./mock-pool'
import MockAgent from'./mock-agent'
import mockErrors from'./mock-errors'
import ProxyAgent from'./proxy-agent'
import EnvHttpProxyAgent from './env-http-proxy-agent'
import RetryHandler from'./retry-handler'
import RetryAgent from'./retry-agent'
import { request, pipeline, stream, connect, upgrade } from './api'
import interceptors from './interceptors'

export * from './util'
export * from './cookies'
export * from './eventsource'
export * from './fetch'
export * from './file'
export * from './filereader'
export * from './formdata'
export * from './diagnostics-channel'
export * from './websocket'
export * from './content-type'
export * from './cache'
export { Interceptable } from './mock-interceptor'

export { Dispatcher, BalancedPool, Pool, Client, buildConnector, errors, Agent, request, stream, pipeline, connect, upgrade, setGlobalDispatcher, getGlobalDispatcher, setGlobalOrigin, getGlobalOrigin, interceptors, MockClient, MockPool, MockAgent, mockErrors, ProxyAgent, EnvHttpProxyAgent, RedirectHandler, DecoratorHandler, RetryHandler, RetryAgent }
export default Undici

declare namespace Undici {
  var Dispatcher: typeof import('./dispatcher').default
  var Pool: typeof import('./pool').default;
  var RedirectHandler: typeof import ('./handlers').RedirectHandler
  var DecoratorHandler: typeof import ('./handlers').DecoratorHandler
  var RetryHandler: typeof import ('./retry-handler').default
  var createRedirectInterceptor: typeof import ('./interceptors').default.createRedirectInterceptor
  var BalancedPool: typeof import('./balanced-pool').default;
  var Client: typeof import('./client').default;
  var buildConnector: typeof import('./connector').default;
  var errors: typeof import('./errors').default;
  var Agent: typeof import('./agent').default;
  var setGlobalDispatcher: typeof import('./global-dispatcher').setGlobalDispatcher;
  var getGlobalDispatcher: typeof import('./global-dispatcher').getGlobalDispatcher;
  var request: typeof import('./api').request;
  var stream: typeof import('./api').stream;
  var pipeline: typeof import('./api').pipeline;
  var connect: typeof import('./api').connect;
  var upgrade: typeof import('./api').upgrade;
  var MockClient: typeof import('./mock-client').default;
  var MockPool: typeof import('./mock-pool').default;
  var MockAgent: typeof import('./mock-agent').default;
  var mockErrors: typeof import('./mock-errors').default;
  var fetch: typeof import('./fetch').fetch;
  var Headers: typeof import('./fetch').Headers;
  var Response: typeof import('./fetch').Response;
  var Request: typeof import('./fetch').Request;
  var FormData: typeof import('./formdata').FormData;
  var File: typeof import('./file').File;
  var FileReader: typeof import('./filereader').FileReader;
  var caches: typeof import('./cache').caches;
  var interceptors: typeof import('./interceptors').default;
}
