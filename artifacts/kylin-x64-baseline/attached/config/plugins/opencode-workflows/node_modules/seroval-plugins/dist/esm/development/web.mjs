// web/abort-signal.ts
import { createPlugin } from "seroval";
var PROMISE_TO_ABORT_SIGNAL = (promise) => {
  const controller = new AbortController();
  const abort = controller.abort.bind(controller);
  promise.then(abort, abort);
  return controller;
};
function resolveAbortSignalResult(resolve) {
  resolve(this.reason);
}
function resolveAbortSignal(resolve) {
  this.addEventListener("abort", resolveAbortSignalResult.bind(this, resolve), {
    once: true
  });
}
function abortSignalToPromise(signal) {
  return new Promise(resolveAbortSignal.bind(signal));
}
var ABORT_CONTROLLER = {};
var AbortControllerFactoryPlugin = /* @__PURE__ */ createPlugin({
  tag: "seroval-plugins/web/AbortControllerFactoryPlugin",
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
    }
  },
  serialize() {
    return PROMISE_TO_ABORT_SIGNAL.toString();
  },
  deserialize() {
    return PROMISE_TO_ABORT_SIGNAL;
  }
});
var AbortSignalPlugin = /* @__PURE__ */ createPlugin({
  tag: "seroval-plugins/web/AbortSignal",
  extends: [AbortControllerFactoryPlugin],
  test(value) {
    if (typeof AbortSignal === "undefined") {
      return false;
    }
    return value instanceof AbortSignal;
  },
  parse: {
    sync(value, ctx) {
      if (value.aborted) {
        return {
          reason: ctx.parse(value.reason)
        };
      }
      return {};
    },
    async async(value, ctx) {
      if (value.aborted) {
        return {
          reason: await ctx.parse(value.reason)
        };
      }
      const result = await abortSignalToPromise(value);
      return {
        reason: await ctx.parse(result)
      };
    },
    stream(value, ctx) {
      if (value.aborted) {
        return {
          reason: ctx.parse(value.reason)
        };
      }
      const promise = abortSignalToPromise(value);
      return {
        factory: ctx.parse(ABORT_CONTROLLER),
        controller: ctx.parse(promise)
      };
    }
  },
  serialize(node, ctx) {
    if (node.reason) {
      return "AbortSignal.abort(" + ctx.serialize(node.reason) + ")";
    }
    if (node.controller && node.factory) {
      return "(" + ctx.serialize(node.factory) + ")(" + ctx.serialize(node.controller) + ").signal";
    }
    return "(new AbortController).signal";
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
  }
});
var abort_signal_default = AbortSignalPlugin;

// web/blob.ts
import { createPlugin as createPlugin2 } from "seroval";
var BlobPlugin = /* @__PURE__ */ createPlugin2({
  tag: "seroval-plugins/web/Blob",
  test(value) {
    if (typeof Blob === "undefined") {
      return false;
    }
    return value instanceof Blob;
  },
  parse: {
    async async(value, ctx) {
      return {
        type: await ctx.parse(value.type),
        buffer: await ctx.parse(await value.arrayBuffer())
      };
    }
  },
  serialize(node, ctx) {
    return "new Blob([" + ctx.serialize(node.buffer) + "],{type:" + ctx.serialize(node.type) + "})";
  },
  deserialize(node, ctx) {
    return new Blob([ctx.deserialize(node.buffer)], {
      type: ctx.deserialize(node.type)
    });
  }
});
var blob_default = BlobPlugin;

// web/custom-event.ts
import { createPlugin as createPlugin3 } from "seroval";
function createCustomEventOptions(current) {
  return {
    detail: current.detail,
    bubbles: current.bubbles,
    cancelable: current.cancelable,
    composed: current.composed
  };
}
var CustomEventPlugin = /* @__PURE__ */ createPlugin3({
  tag: "seroval-plugins/web/CustomEvent",
  test(value) {
    if (typeof CustomEvent === "undefined") {
      return false;
    }
    return value instanceof CustomEvent;
  },
  parse: {
    sync(value, ctx) {
      return {
        type: ctx.parse(value.type),
        options: ctx.parse(createCustomEventOptions(value))
      };
    },
    async async(value, ctx) {
      return {
        type: await ctx.parse(value.type),
        options: await ctx.parse(createCustomEventOptions(value))
      };
    },
    stream(value, ctx) {
      return {
        type: ctx.parse(value.type),
        options: ctx.parse(createCustomEventOptions(value))
      };
    }
  },
  serialize(node, ctx) {
    return "new CustomEvent(" + ctx.serialize(node.type) + "," + ctx.serialize(node.options) + ")";
  },
  deserialize(node, ctx) {
    return new CustomEvent(
      ctx.deserialize(node.type),
      ctx.deserialize(node.options)
    );
  }
});
var custom_event_default = CustomEventPlugin;

// web/dom-exception.ts
import { createPlugin as createPlugin4 } from "seroval";
var DOMExceptionPlugin = /* @__PURE__ */ createPlugin4({
  tag: "seroval-plugins/web/DOMException",
  test(value) {
    if (typeof DOMException === "undefined") {
      return false;
    }
    return value instanceof DOMException;
  },
  parse: {
    sync(value, ctx) {
      return {
        name: ctx.parse(value.name),
        message: ctx.parse(value.message)
      };
    },
    async async(value, ctx) {
      return {
        name: await ctx.parse(value.name),
        message: await ctx.parse(value.message)
      };
    },
    stream(value, ctx) {
      return {
        name: ctx.parse(value.name),
        message: ctx.parse(value.message)
      };
    }
  },
  serialize(node, ctx) {
    return "new DOMException(" + ctx.serialize(node.message) + "," + ctx.serialize(node.name) + ")";
  },
  deserialize(node, ctx) {
    return new DOMException(
      ctx.deserialize(node.message),
      ctx.deserialize(node.name)
    );
  }
});
var dom_exception_default = DOMExceptionPlugin;

// web/event.ts
import { createPlugin as createPlugin5 } from "seroval";
function createEventOptions(current) {
  return {
    bubbles: current.bubbles,
    cancelable: current.cancelable,
    composed: current.composed
  };
}
var EventPlugin = /* @__PURE__ */ createPlugin5({
  tag: "seroval-plugins/web/Event",
  test(value) {
    if (typeof Event === "undefined") {
      return false;
    }
    return value instanceof Event;
  },
  parse: {
    sync(value, ctx) {
      return {
        type: ctx.parse(value.type),
        options: ctx.parse(createEventOptions(value))
      };
    },
    async async(value, ctx) {
      return {
        type: await ctx.parse(value.type),
        options: await ctx.parse(createEventOptions(value))
      };
    },
    stream(value, ctx) {
      return {
        type: ctx.parse(value.type),
        options: ctx.parse(createEventOptions(value))
      };
    }
  },
  serialize(node, ctx) {
    return "new Event(" + ctx.serialize(node.type) + "," + ctx.serialize(node.options) + ")";
  },
  deserialize(node, ctx) {
    return new Event(
      ctx.deserialize(node.type),
      ctx.deserialize(node.options)
    );
  }
});
var event_default = EventPlugin;

// web/file.ts
import { createPlugin as createPlugin6 } from "seroval";
var FilePlugin = /* @__PURE__ */ createPlugin6({
  tag: "seroval-plugins/web/File",
  test(value) {
    if (typeof File === "undefined") {
      return false;
    }
    return value instanceof File;
  },
  parse: {
    async async(value, ctx) {
      return {
        name: await ctx.parse(value.name),
        options: await ctx.parse({
          type: value.type,
          lastModified: value.lastModified
        }),
        buffer: await ctx.parse(await value.arrayBuffer())
      };
    }
  },
  serialize(node, ctx) {
    return "new File([" + ctx.serialize(node.buffer) + "]," + ctx.serialize(node.name) + "," + ctx.serialize(node.options) + ")";
  },
  deserialize(node, ctx) {
    return new File(
      [ctx.deserialize(node.buffer)],
      ctx.deserialize(node.name),
      ctx.deserialize(node.options)
    );
  }
});
var file_default = FilePlugin;

// web/form-data.ts
import { createPlugin as createPlugin7 } from "seroval";
function convertFormData(instance) {
  const items = [];
  instance.forEach((value, key) => {
    items.push([key, value]);
  });
  return items;
}
var FORM_DATA_FACTORY = {};
var FORM_DATA_FACTORY_CONSTRUCTOR = (e, f = new FormData(), i = 0, s = e.length, t) => {
  for (; i < s; i++) {
    t = e[i];
    f.append(t[0], t[1]);
  }
  return f;
};
var FormDataFactoryPlugin = /* @__PURE__ */ createPlugin7({
  tag: "seroval-plugins/web/FormDataFactory",
  test(value) {
    return value === FORM_DATA_FACTORY;
  },
  parse: {
    sync() {
      return FORM_DATA_FACTORY;
    },
    async async() {
      return await Promise.resolve(FORM_DATA_FACTORY);
    },
    stream() {
      return FORM_DATA_FACTORY;
    }
  },
  serialize() {
    return FORM_DATA_FACTORY_CONSTRUCTOR.toString();
  },
  deserialize() {
    return FORM_DATA_FACTORY;
  }
});
var FormDataPlugin = /* @__PURE__ */ createPlugin7({
  tag: "seroval-plugins/web/FormData",
  extends: [file_default, FormDataFactoryPlugin],
  test(value) {
    if (typeof FormData === "undefined") {
      return false;
    }
    return value instanceof FormData;
  },
  parse: {
    sync(value, ctx) {
      return {
        factory: ctx.parse(FORM_DATA_FACTORY),
        entries: ctx.parse(convertFormData(value))
      };
    },
    async async(value, ctx) {
      return {
        factory: await ctx.parse(FORM_DATA_FACTORY),
        entries: await ctx.parse(convertFormData(value))
      };
    },
    stream(value, ctx) {
      return {
        factory: ctx.parse(FORM_DATA_FACTORY),
        entries: ctx.parse(convertFormData(value))
      };
    }
  },
  serialize(node, ctx) {
    return "(" + ctx.serialize(node.factory) + ")(" + ctx.serialize(node.entries) + ")";
  },
  deserialize(node, ctx) {
    return FORM_DATA_FACTORY_CONSTRUCTOR(
      ctx.deserialize(node.entries)
    );
  }
});
var form_data_default = FormDataPlugin;

// web/headers.ts
import { createPlugin as createPlugin8 } from "seroval";
function convertHeaders(instance) {
  const items = [];
  instance.forEach((value, key) => {
    items.push([key, value]);
  });
  return items;
}
var HeadersPlugin = /* @__PURE__ */ createPlugin8({
  tag: "seroval-plugins/web/Headers",
  test(value) {
    if (typeof Headers === "undefined") {
      return false;
    }
    return value instanceof Headers;
  },
  parse: {
    sync(value, ctx) {
      return {
        value: ctx.parse(convertHeaders(value))
      };
    },
    async async(value, ctx) {
      return {
        value: await ctx.parse(convertHeaders(value))
      };
    },
    stream(value, ctx) {
      return {
        value: ctx.parse(convertHeaders(value))
      };
    }
  },
  serialize(node, ctx) {
    return "new Headers(" + ctx.serialize(node.value) + ")";
  },
  deserialize(node, ctx) {
    return new Headers(ctx.deserialize(node.value));
  }
});
var headers_default = HeadersPlugin;

// web/image-data.ts
import { createPlugin as createPlugin9 } from "seroval";
var ImageDataPlugin = /* @__PURE__ */ createPlugin9({
  tag: "seroval-plugins/web/ImageData",
  test(value) {
    if (typeof ImageData === "undefined") {
      return false;
    }
    return value instanceof ImageData;
  },
  parse: {
    sync(value, ctx) {
      return {
        data: ctx.parse(value.data),
        width: ctx.parse(value.width),
        height: ctx.parse(value.height),
        options: ctx.parse({
          colorSpace: value.colorSpace
        })
      };
    },
    async async(value, ctx) {
      return {
        data: await ctx.parse(value.data),
        width: await ctx.parse(value.width),
        height: await ctx.parse(value.height),
        options: await ctx.parse({
          colorSpace: value.colorSpace
        })
      };
    },
    stream(value, ctx) {
      return {
        data: ctx.parse(value.data),
        width: ctx.parse(value.width),
        height: ctx.parse(value.height),
        options: ctx.parse({
          colorSpace: value.colorSpace
        })
      };
    }
  },
  serialize(node, ctx) {
    return "new ImageData(" + ctx.serialize(node.data) + "," + ctx.serialize(node.width) + "," + ctx.serialize(node.height) + "," + ctx.serialize(node.options) + ")";
  },
  deserialize(node, ctx) {
    return new ImageData(
      ctx.deserialize(node.data),
      ctx.deserialize(node.width),
      ctx.deserialize(node.height),
      ctx.deserialize(node.options)
    );
  }
});
var image_data_default = ImageDataPlugin;

// web/readable-stream.ts
import { createPlugin as createPlugin10, createStream } from "seroval";
var READABLE_STREAM_FACTORY = {};
var READABLE_STREAM_FACTORY_CONSTRUCTOR = (stream) => new ReadableStream({
  start: (controller) => {
    stream.on({
      next: (value) => {
        try {
          controller.enqueue(value);
        } catch (_error) {
        }
      },
      throw: (value) => {
        controller.error(value);
      },
      return: () => {
        try {
          controller.close();
        } catch (_error) {
        }
      }
    });
  }
});
var ReadableStreamFactoryPlugin = /* @__PURE__ */ createPlugin10({
  tag: "seroval-plugins/web/ReadableStreamFactory",
  test(value) {
    return value === READABLE_STREAM_FACTORY;
  },
  parse: {
    sync() {
      return READABLE_STREAM_FACTORY;
    },
    async async() {
      return await Promise.resolve(READABLE_STREAM_FACTORY);
    },
    stream() {
      return READABLE_STREAM_FACTORY;
    }
  },
  serialize() {
    return READABLE_STREAM_FACTORY_CONSTRUCTOR.toString();
  },
  deserialize() {
    return READABLE_STREAM_FACTORY;
  }
});
function toStream(value) {
  const stream = createStream();
  const reader = value.getReader();
  async function push() {
    try {
      const result = await reader.read();
      if (result.done) {
        stream.return(result.value);
      } else {
        stream.next(result.value);
        await push();
      }
    } catch (error) {
      stream.throw(error);
    }
  }
  push().catch(() => {
  });
  return stream;
}
var ReadableStreamPlugin = /* @__PURE__ */ createPlugin10({
  tag: "seroval/plugins/web/ReadableStream",
  extends: [ReadableStreamFactoryPlugin],
  test(value) {
    if (typeof ReadableStream === "undefined") {
      return false;
    }
    return value instanceof ReadableStream;
  },
  parse: {
    sync(_value, ctx) {
      return {
        factory: ctx.parse(READABLE_STREAM_FACTORY),
        stream: ctx.parse(createStream())
      };
    },
    async async(value, ctx) {
      return {
        factory: await ctx.parse(READABLE_STREAM_FACTORY),
        stream: await ctx.parse(toStream(value))
      };
    },
    stream(value, ctx) {
      return {
        factory: ctx.parse(READABLE_STREAM_FACTORY),
        stream: ctx.parse(toStream(value))
      };
    }
  },
  serialize(node, ctx) {
    return "(" + ctx.serialize(node.factory) + ")(" + ctx.serialize(node.stream) + ")";
  },
  deserialize(node, ctx) {
    const stream = ctx.deserialize(node.stream);
    return READABLE_STREAM_FACTORY_CONSTRUCTOR(stream);
  }
});
var readable_stream_default = ReadableStreamPlugin;

// web/request.ts
import { createPlugin as createPlugin11 } from "seroval";
function createRequestOptions(current, body) {
  return {
    body,
    cache: current.cache,
    credentials: current.credentials,
    headers: current.headers,
    integrity: current.integrity,
    keepalive: current.keepalive,
    method: current.method,
    mode: current.mode,
    redirect: current.redirect,
    referrer: current.referrer,
    referrerPolicy: current.referrerPolicy
  };
}
var RequestPlugin = /* @__PURE__ */ createPlugin11({
  tag: "seroval-plugins/web/Request",
  extends: [readable_stream_default, headers_default],
  test(value) {
    if (typeof Request === "undefined") {
      return false;
    }
    return value instanceof Request;
  },
  parse: {
    async async(value, ctx) {
      return {
        url: await ctx.parse(value.url),
        options: await ctx.parse(
          createRequestOptions(
            value,
            value.body && !value.bodyUsed ? await value.clone().arrayBuffer() : null
          )
        )
      };
    },
    stream(value, ctx) {
      return {
        url: ctx.parse(value.url),
        options: ctx.parse(
          createRequestOptions(
            value,
            value.body && !value.bodyUsed ? value.clone().body : null
          )
        )
      };
    }
  },
  serialize(node, ctx) {
    return "new Request(" + ctx.serialize(node.url) + "," + ctx.serialize(node.options) + ")";
  },
  deserialize(node, ctx) {
    return new Request(
      ctx.deserialize(node.url),
      ctx.deserialize(node.options)
    );
  }
});
var request_default = RequestPlugin;

// web/response.ts
import { createPlugin as createPlugin12 } from "seroval";
function createResponseOptions(current) {
  return {
    headers: current.headers,
    status: current.status,
    statusText: current.statusText
  };
}
var ResponsePlugin = /* @__PURE__ */ createPlugin12({
  tag: "seroval-plugins/web/Response",
  extends: [readable_stream_default, headers_default],
  test(value) {
    if (typeof Response === "undefined") {
      return false;
    }
    return value instanceof Response;
  },
  parse: {
    async async(value, ctx) {
      return {
        body: await ctx.parse(
          value.body && !value.bodyUsed ? await value.clone().arrayBuffer() : null
        ),
        options: await ctx.parse(createResponseOptions(value))
      };
    },
    stream(value, ctx) {
      return {
        body: ctx.parse(
          value.body && !value.bodyUsed ? value.clone().body : null
        ),
        options: ctx.parse(createResponseOptions(value))
      };
    }
  },
  serialize(node, ctx) {
    return "new Response(" + ctx.serialize(node.body) + "," + ctx.serialize(node.options) + ")";
  },
  deserialize(node, ctx) {
    return new Response(
      ctx.deserialize(node.body),
      ctx.deserialize(node.options)
    );
  }
});
var response_default = ResponsePlugin;

// web/url.ts
import { createPlugin as createPlugin13 } from "seroval";
var URLPlugin = /* @__PURE__ */ createPlugin13({
  tag: "seroval-plugins/web/URL",
  test(value) {
    if (typeof URL === "undefined") {
      return false;
    }
    return value instanceof URL;
  },
  parse: {
    sync(value, ctx) {
      return {
        value: ctx.parse(value.href)
      };
    },
    async async(value, ctx) {
      return {
        value: await ctx.parse(value.href)
      };
    },
    stream(value, ctx) {
      return {
        value: ctx.parse(value.href)
      };
    }
  },
  serialize(node, ctx) {
    return "new URL(" + ctx.serialize(node.value) + ")";
  },
  deserialize(node, ctx) {
    return new URL(ctx.deserialize(node.value));
  }
});
var url_default = URLPlugin;

// web/url-search-params.ts
import { createPlugin as createPlugin14 } from "seroval";
var URLSearchParamsPlugin = /* @__PURE__ */ createPlugin14({
  tag: "seroval-plugins/web/URLSearchParams",
  test(value) {
    if (typeof URLSearchParams === "undefined") {
      return false;
    }
    return value instanceof URLSearchParams;
  },
  parse: {
    sync(value, ctx) {
      return {
        value: ctx.parse(value.toString())
      };
    },
    async async(value, ctx) {
      return {
        value: await ctx.parse(value.toString())
      };
    },
    stream(value, ctx) {
      return {
        value: ctx.parse(value.toString())
      };
    }
  },
  serialize(node, ctx) {
    return "new URLSearchParams(" + ctx.serialize(node.value) + ")";
  },
  deserialize(node, ctx) {
    return new URLSearchParams(ctx.deserialize(node.value));
  }
});
var url_search_params_default = URLSearchParamsPlugin;
export {
  abort_signal_default as AbortSignalPlugin,
  blob_default as BlobPlugin,
  custom_event_default as CustomEventPlugin,
  dom_exception_default as DOMExceptionPlugin,
  event_default as EventPlugin,
  file_default as FilePlugin,
  form_data_default as FormDataPlugin,
  headers_default as HeadersPlugin,
  image_data_default as ImageDataPlugin,
  readable_stream_default as ReadableStreamPlugin,
  request_default as RequestPlugin,
  response_default as ResponsePlugin,
  url_default as URLPlugin,
  url_search_params_default as URLSearchParamsPlugin
};
//# sourceMappingURL=web.mjs.map
