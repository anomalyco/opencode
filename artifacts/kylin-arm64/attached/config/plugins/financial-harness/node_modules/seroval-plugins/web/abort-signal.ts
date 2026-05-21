import type { SerovalNode } from 'seroval';
import { createPlugin } from 'seroval';

const PROMISE_TO_ABORT_SIGNAL = (promise: Promise<unknown>) => {
  const controller = new AbortController();
  const abort = controller.abort.bind(controller);
  promise.then(abort, abort);
  return controller;
};

function resolveAbortSignalResult(
  this: AbortSignal,
  resolve: (value: unknown) => void,
): void {
  resolve(this.reason);
}

function resolveAbortSignal(
  this: AbortSignal,
  resolve: (value: unknown) => void,
): void {
  this.addEventListener('abort', resolveAbortSignalResult.bind(this, resolve), {
    once: true,
  });
}

function abortSignalToPromise(signal: AbortSignal): Promise<unknown> {
  return new Promise(resolveAbortSignal.bind(signal));
}

const ABORT_CONTROLLER = {};

const AbortControllerFactoryPlugin = /* @__PURE__ */ createPlugin<object, {}>({
  tag: 'seroval-plugins/web/AbortControllerFactoryPlugin',
  test(value) {
    return value === ABORT_CONTROLLER;
  },
  parse: {
    sync() {
      return ABORT_CONTROLLER;
    },
    async async() {
      return await Promise.resolve(ABORT_CONTROLLER);
    },
    stream() {
      return ABORT_CONTROLLER;
    },
  },
  serialize() {
    return PROMISE_TO_ABORT_SIGNAL.toString();
  },
  deserialize() {
    return PROMISE_TO_ABORT_SIGNAL;
  },
});

const AbortSignalPlugin = /* @__PURE__ */ createPlugin<
  AbortSignal,
  { reason?: SerovalNode; controller?: SerovalNode; factory?: SerovalNode }
>({
  tag: 'seroval-plugins/web/AbortSignal',
  extends: [AbortControllerFactoryPlugin],
  test(value) {
    if (typeof AbortSignal === 'undefined') {
      return false;
    }
    return value instanceof AbortSignal;
  },
  parse: {
    sync(value, ctx) {
      if (value.aborted) {
        return {
          reason: ctx.parse(value.reason),
        };
      }
      return {};
    },
    async async(value, ctx) {
      if (value.aborted) {
        return {
          reason: await ctx.parse(value.reason),
        };
      }
      const result = await abortSignalToPromise(value);
      return {
        reason: await ctx.parse(result),
      };
    },
    stream(value, ctx) {
      if (value.aborted) {
        return {
          reason: ctx.parse(value.reason),
        };
      }

      const promise = abortSignalToPromise(value);

      return {
        factory: ctx.parse(ABORT_CONTROLLER),
        controller: ctx.parse(promise),
      };
    },
  },
  serialize(node, ctx) {
    if (node.reason) {
      return 'AbortSignal.abort(' + ctx.serialize(node.reason) + ')';
    }
    if (node.controller && node.factory) {
      return (
        '(' +
        ctx.serialize(node.factory) +
        ')(' +
        ctx.serialize(node.controller) +
        ').signal'
      );
    }
    return '(new AbortController).signal';
  },
  deserialize(node, ctx) {
    if (node.reason) {
      return AbortSignal.abort(ctx.deserialize(node.reason));
    }
    if (node.controller) {
      return PROMISE_TO_ABORT_SIGNAL(ctx.deserialize(node.controller)).signal;
    }
    const controller = new AbortController();
    return controller.signal;
  },
});

export default AbortSignalPlugin;
