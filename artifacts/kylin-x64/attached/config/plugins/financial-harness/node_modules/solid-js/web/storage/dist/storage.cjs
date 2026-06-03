'use strict';

var node_async_hooks = require('node:async_hooks');
var web = require('solid-js/web');

function provideRequestEvent(init, cb) {
  if (!web.isServer) throw new Error("Attempting to use server context in non-server build");
  const ctx = globalThis[web.RequestContext] = globalThis[web.RequestContext] || new node_async_hooks.AsyncLocalStorage();
  return ctx.run(init, cb);
}

exports.provideRequestEvent = provideRequestEvent;
