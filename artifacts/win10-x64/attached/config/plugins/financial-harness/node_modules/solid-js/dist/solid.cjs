'use strict';

let taskIdCounter = 1,
  isCallbackScheduled = false,
  isPerformingWork = false,
  taskQueue = [],
  currentTask = null,
  shouldYieldToHost = null,
  yieldInterval = 5,
  deadline = 0,
  maxYieldInterval = 300,
  maxDeadline = 0,
  scheduleCallback = null,
  scheduledCallback = null;
const maxSigned31BitInt = 1073741823;
function setupScheduler() {
  const channel = new MessageChannel(),
    port = channel.port2;
  scheduleCallback = () => port.postMessage(null);
  channel.port1.onmessage = () => {
    if (scheduledCallback !== null) {
      const currentTime = performance.now();
      deadline = currentTime + yieldInterval;
      maxDeadline = currentTime + maxYieldInterval;
      try {
        const hasMoreWork = scheduledCallback(currentTime);
        if (!hasMoreWork) {
          scheduledCallback = null;
        } else port.postMessage(null);
      } catch (error) {
        port.postMessage(null);
        throw error;
      }
    }
  };
  if (navigator && navigator.scheduling && navigator.scheduling.isInputPending) {
    const scheduling = navigator.scheduling;
    shouldYieldToHost = () => {
      const currentTime = performance.now();
      if (currentTime >= deadline) {
        if (scheduling.isInputPending()) {
          return true;
        }
        return currentTime >= maxDeadline;
      } else {
        return false;
      }
    };
  } else {
    shouldYieldToHost = () => performance.now() >= deadline;
  }
}
function enqueue(taskQueue, task) {
  function findIndex() {
    let m = 0;
    let n = taskQueue.length - 1;
    while (m <= n) {
      const k = n + m >> 1;
      const cmp = task.expirationTime - taskQueue[k].expirationTime;
      if (cmp > 0) m = k + 1;else if (cmp < 0) n = k - 1;else return k;
    }
    return m;
  }
  taskQueue.splice(findIndex(), 0, task);
}
function requestCallback(fn, options) {
  if (!scheduleCallback) setupScheduler();
  let startTime = performance.now(),
    timeout = maxSigned31BitInt;
  if (options && options.timeout) timeout = options.timeout;
  const newTask = {
    id: taskIdCounter++,
    fn,
    startTime,
    expirationTime: startTime + timeout
  };
  enqueue(taskQueue, newTask);
  if (!isCallbackScheduled && !isPerformingWork) {
    isCallbackScheduled = true;
    scheduledCallback = flushWork;
    scheduleCallback();
  }
  return newTask;
}
function cancelCallback(task) {
  task.fn = null;
}
function flushWork(initialTime) {
  isCallbackScheduled = false;
  isPerformingWork = true;
  try {
    return workLoop(initialTime);
  } finally {
    currentTask = null;
    isPerformingWork = false;
  }
}
function workLoop(initialTime) {
  let currentTime = initialTime;
  currentTask = taskQueue[0] || null;
  while (currentTask !== null) {
    if (currentTask.expirationTime > currentTime && shouldYieldToHost()) {
      break;
    }
    const callback = currentTask.fn;
    if (callback !== null) {
      currentTask.fn = null;
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      callback(didUserCallbackTimeout);
      currentTime = performance.now();
      if (currentTask === taskQueue[0]) {
        taskQueue.shift();
      }
    } else taskQueue.shift();
    currentTask = taskQueue[0] || null;
  }
  return currentTask !== null;
}

const sharedConfig = {
  context: undefined,
  registry: undefined,
  effects: undefined,
  done: false,
  getContextId() {
    return getContextId(this.context.count);
  },
  getNextContextId() {
    return getContextId(this.context.count++);
  }
};
function getContextId(count) {
  const num = String(count),
    len = num.length - 1;
  return sharedConfig.context.id + (len ? String.fromCharCode(96 + len) : "") + num;
}
function setHydrateContext(context) {
  sharedConfig.context = context;
}
function nextHydrateContext() {
  return {
    ...sharedConfig.context,
    id: sharedConfig.getNextContextId(),
    count: 0
  };
}

const IS_DEV = false;
const equalFn = (a, b) => a === b;
const $PROXY = Symbol("solid-proxy");
const SUPPORTS_PROXY = typeof Proxy === "function";
const $TRACK = Symbol("solid-track");
const $DEVCOMP = Symbol("solid-dev-component");
const signalOptions = {
  equals: equalFn
};
let ERROR = null;
let runEffects = runQueue;
const STALE = 1;
const PENDING = 2;
const UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
const NO_INIT = {};
var Owner = null;
let Transition = null;
let Scheduler = null;
let ExternalSourceConfig = null;
let Listener = null;
let Updates = null;
let Effects = null;
let ExecCount = 0;
function createRoot(fn, detachedOwner) {
  const listener = Listener,
    owner = Owner,
    unowned = fn.length === 0,
    current = detachedOwner === undefined ? owner : detachedOwner,
    root = unowned ? UNOWNED : {
      owned: null,
      cleanups: null,
      context: current ? current.context : null,
      owner: current
    },
    updateFn = unowned ? fn : () => fn(() => untrack(() => cleanNode(root)));
  Owner = root;
  Listener = null;
  try {
    return runUpdates(updateFn, true);
  } finally {
    Listener = listener;
    Owner = owner;
  }
}
function createSignal(value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s = {
    value,
    observers: null,
    observerSlots: null,
    comparator: options.equals || undefined
  };
  const setter = value => {
    if (typeof value === "function") {
      if (Transition && Transition.running && Transition.sources.has(s)) value = value(s.tValue);else value = value(s.value);
    }
    return writeSignal(s, value);
  };
  return [readSignal.bind(s), setter];
}
function createComputed(fn, value, options) {
  const c = createComputation(fn, value, true, STALE);
  if (Scheduler && Transition && Transition.running) Updates.push(c);else updateComputation(c);
}
function createRenderEffect(fn, value, options) {
  const c = createComputation(fn, value, false, STALE);
  if (Scheduler && Transition && Transition.running) Updates.push(c);else updateComputation(c);
}
function createEffect(fn, value, options) {
  runEffects = runUserEffects;
  const c = createComputation(fn, value, false, STALE),
    s = SuspenseContext && useContext(SuspenseContext);
  if (s) c.suspense = s;
  if (!options || !options.render) c.user = true;
  Effects ? Effects.push(c) : updateComputation(c);
}
function createReaction(onInvalidate, options) {
  let fn;
  const c = createComputation(() => {
      fn ? fn() : untrack(onInvalidate);
      fn = undefined;
    }, undefined, false, 0),
    s = SuspenseContext && useContext(SuspenseContext);
  if (s) c.suspense = s;
  c.user = true;
  return tracking => {
    fn = tracking;
    updateComputation(c);
  };
}
function createMemo(fn, value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value, true, 0);
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  if (Scheduler && Transition && Transition.running) {
    c.tState = STALE;
    Updates.push(c);
  } else updateComputation(c);
  return readSignal.bind(c);
}
function isPromise(v) {
  return v && typeof v === "object" && "then" in v;
}
function createResource(pSource, pFetcher, pOptions) {
  let source;
  let fetcher;
  let options;
  if (typeof pFetcher === "function") {
    source = pSource;
    fetcher = pFetcher;
    options = pOptions || {};
  } else {
    source = true;
    fetcher = pSource;
    options = pFetcher || {};
  }
  let pr = null,
    initP = NO_INIT,
    id = null,
    loadedUnderTransition = false,
    scheduled = false,
    resolved = "initialValue" in options,
    dynamic = typeof source === "function" && createMemo(source);
  const contexts = new Set(),
    [value, setValue] = (options.storage || createSignal)(options.initialValue),
    [error, setError] = createSignal(undefined),
    [track, trigger] = createSignal(undefined, {
      equals: false
    }),
    [state, setState] = createSignal(resolved ? "ready" : "unresolved");
  if (sharedConfig.context) {
    id = sharedConfig.getNextContextId();
    if (options.ssrLoadFrom === "initial") initP = options.initialValue;else if (sharedConfig.load && sharedConfig.has(id)) initP = sharedConfig.load(id);
  }
  function loadEnd(p, v, error, key) {
    if (pr === p) {
      pr = null;
      key !== undefined && (resolved = true);
      if ((p === initP || v === initP) && options.onHydrated) queueMicrotask(() => options.onHydrated(key, {
        value: v
      }));
      initP = NO_INIT;
      if (Transition && p && loadedUnderTransition) {
        Transition.promises.delete(p);
        loadedUnderTransition = false;
        runUpdates(() => {
          Transition.running = true;
          completeLoad(v, error);
        }, false);
      } else completeLoad(v, error);
    }
    return v;
  }
  function completeLoad(v, err) {
    runUpdates(() => {
      if (err === undefined) setValue(() => v);
      setState(err !== undefined ? "errored" : resolved ? "ready" : "unresolved");
      setError(err);
      for (const c of contexts.keys()) c.decrement();
      contexts.clear();
    }, false);
  }
  function read() {
    const c = SuspenseContext && useContext(SuspenseContext),
      v = value(),
      err = error();
    if (err !== undefined && !pr) throw err;
    if (Listener && !Listener.user && c) {
      createComputed(() => {
        track();
        if (pr) {
          if (c.resolved && Transition && loadedUnderTransition) Transition.promises.add(pr);else if (!contexts.has(c)) {
            c.increment();
            contexts.add(c);
          }
        }
      });
    }
    return v;
  }
  function load(refetching = true) {
    if (refetching !== false && scheduled) return;
    scheduled = false;
    const lookup = dynamic ? dynamic() : source;
    loadedUnderTransition = Transition && Transition.running;
    if (lookup == null || lookup === false) {
      loadEnd(pr, untrack(value));
      return;
    }
    if (Transition && pr) Transition.promises.delete(pr);
    let error;
    const p = initP !== NO_INIT ? initP : untrack(() => {
      try {
        return fetcher(lookup, {
          value: value(),
          refetching
        });
      } catch (fetcherError) {
        error = fetcherError;
      }
    });
    if (error !== undefined) {
      loadEnd(pr, undefined, castError(error), lookup);
      return;
    } else if (!isPromise(p)) {
      loadEnd(pr, p, undefined, lookup);
      return p;
    }
    pr = p;
    if ("v" in p) {
      if (p.s === 1) loadEnd(pr, p.v, undefined, lookup);else loadEnd(pr, undefined, castError(p.v), lookup);
      return p;
    }
    scheduled = true;
    queueMicrotask(() => scheduled = false);
    runUpdates(() => {
      setState(resolved ? "refreshing" : "pending");
      trigger();
    }, false);
    return p.then(v => loadEnd(p, v, undefined, lookup), e => loadEnd(p, undefined, castError(e), lookup));
  }
  Object.defineProperties(read, {
    state: {
      get: () => state()
    },
    error: {
      get: () => error()
    },
    loading: {
      get() {
        const s = state();
        return s === "pending" || s === "refreshing";
      }
    },
    latest: {
      get() {
        if (!resolved) return read();
        const err = error();
        if (err && !pr) throw err;
        return value();
      }
    }
  });
  let owner = Owner;
  if (dynamic) createComputed(() => (owner = Owner, load(false)));else load(false);
  return [read, {
    refetch: info => runWithOwner(owner, () => load(info)),
    mutate: setValue
  }];
}
function createDeferred(source, options) {
  let t,
    timeout = options ? options.timeoutMs : undefined;
  const node = createComputation(() => {
    if (!t || !t.fn) t = requestCallback(() => setDeferred(() => node.value), timeout !== undefined ? {
      timeout
    } : undefined);
    return source();
  }, undefined, true);
  const [deferred, setDeferred] = createSignal(Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value, options);
  updateComputation(node);
  setDeferred(() => Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value);
  return deferred;
}
function createSelector(source, fn = equalFn, options) {
  const subs = new Map();
  const node = createComputation(p => {
    const v = source();
    for (const [key, val] of subs.entries()) if (fn(key, v) !== fn(key, p)) {
      for (const c of val.values()) {
        c.state = STALE;
        if (c.pure) Updates.push(c);else Effects.push(c);
      }
    }
    return v;
  }, undefined, true, STALE);
  updateComputation(node);
  return key => {
    const listener = Listener;
    if (listener) {
      let l;
      if (l = subs.get(key)) l.add(listener);else subs.set(key, l = new Set([listener]));
      onCleanup(() => {
        l.delete(listener);
        !l.size && subs.delete(key);
      });
    }
    return fn(key, Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value);
  };
}
function batch(fn) {
  return runUpdates(fn, false);
}
function untrack(fn) {
  if (!ExternalSourceConfig && Listener === null) return fn();
  const listener = Listener;
  Listener = null;
  try {
    if (ExternalSourceConfig) return ExternalSourceConfig.untrack(fn);
    return fn();
  } finally {
    Listener = listener;
  }
}
function on(deps, fn, options) {
  const isArray = Array.isArray(deps);
  let prevInput;
  let defer = options && options.defer;
  return prevValue => {
    let input;
    if (isArray) {
      input = Array(deps.length);
      for (let i = 0; i < deps.length; i++) input[i] = deps[i]();
    } else input = deps();
    if (defer) {
      defer = false;
      return prevValue;
    }
    const result = untrack(() => fn(input, prevInput, prevValue));
    prevInput = input;
    return result;
  };
}
function onMount(fn) {
  createEffect(() => untrack(fn));
}
function onCleanup(fn) {
  if (Owner === null) ;else if (Owner.cleanups === null) Owner.cleanups = [fn];else Owner.cleanups.push(fn);
  return fn;
}
function catchError(fn, handler) {
  ERROR || (ERROR = Symbol("error"));
  Owner = createComputation(undefined, undefined, true);
  Owner.context = {
    ...Owner.context,
    [ERROR]: [handler]
  };
  if (Transition && Transition.running) Transition.sources.add(Owner);
  try {
    return fn();
  } catch (err) {
    handleError(err);
  } finally {
    Owner = Owner.owner;
  }
}
function getListener() {
  return Listener;
}
function getOwner() {
  return Owner;
}
function runWithOwner(o, fn) {
  const prev = Owner;
  const prevListener = Listener;
  Owner = o;
  Listener = null;
  try {
    return runUpdates(fn, true);
  } catch (err) {
    handleError(err);
  } finally {
    Owner = prev;
    Listener = prevListener;
  }
}
function enableScheduling(scheduler = requestCallback) {
  Scheduler = scheduler;
}
function startTransition(fn) {
  if (Transition && Transition.running) {
    fn();
    return Transition.done;
  }
  const l = Listener;
  const o = Owner;
  return Promise.resolve().then(() => {
    Listener = l;
    Owner = o;
    let t;
    if (Scheduler || SuspenseContext) {
      t = Transition || (Transition = {
        sources: new Set(),
        effects: [],
        promises: new Set(),
        disposed: new Set(),
        queue: new Set(),
        running: true
      });
      t.done || (t.done = new Promise(res => t.resolve = res));
      t.running = true;
    }
    runUpdates(fn, false);
    Listener = Owner = null;
    return t ? t.done : undefined;
  });
}
const [transPending, setTransPending] = /*@__PURE__*/createSignal(false);
function useTransition() {
  return [transPending, startTransition];
}
function resumeEffects(e) {
  Effects.push.apply(Effects, e);
  e.length = 0;
}
function createContext(defaultValue, options) {
  const id = Symbol("context");
  return {
    id,
    Provider: createProvider(id),
    defaultValue
  };
}
function useContext(context) {
  let value;
  return Owner && Owner.context && (value = Owner.context[context.id]) !== undefined ? value : context.defaultValue;
}
function children(fn) {
  const children = createMemo(fn);
  const memo = createMemo(() => resolveChildren(children()));
  memo.toArray = () => {
    const c = memo();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo;
}
let SuspenseContext;
function getSuspenseContext() {
  return SuspenseContext || (SuspenseContext = createContext());
}
function enableExternalSource(factory, untrack = fn => fn()) {
  if (ExternalSourceConfig) {
    const {
      factory: oldFactory,
      untrack: oldUntrack
    } = ExternalSourceConfig;
    ExternalSourceConfig = {
      factory: (fn, trigger) => {
        const oldSource = oldFactory(fn, trigger);
        const source = factory(x => oldSource.track(x), trigger);
        return {
          track: x => source.track(x),
          dispose() {
            source.dispose();
            oldSource.dispose();
          }
        };
      },
      untrack: fn => oldUntrack(() => untrack(fn))
    };
  } else {
    ExternalSourceConfig = {
      factory,
      untrack
    };
  }
}
function readSignal() {
  const runningTransition = Transition && Transition.running;
  if (this.sources && (runningTransition ? this.tState : this.state)) {
    if ((runningTransition ? this.tState : this.state) === STALE) updateComputation(this);else {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(this), false);
      Updates = updates;
    }
  }
  if (Listener) {
    const sSlot = this.observers ? this.observers.length : 0;
    if (!Listener.sources) {
      Listener.sources = [this];
      Listener.sourceSlots = [sSlot];
    } else {
      Listener.sources.push(this);
      Listener.sourceSlots.push(sSlot);
    }
    if (!this.observers) {
      this.observers = [Listener];
      this.observerSlots = [Listener.sources.length - 1];
    } else {
      this.observers.push(Listener);
      this.observerSlots.push(Listener.sources.length - 1);
    }
  }
  if (runningTransition && Transition.sources.has(this)) return this.tValue;
  return this.value;
}
function writeSignal(node, value, isComp) {
  let current = Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value;
  if (!node.comparator || !node.comparator(current, value)) {
    if (Transition) {
      const TransitionRunning = Transition.running;
      if (TransitionRunning || !isComp && Transition.sources.has(node)) {
        Transition.sources.add(node);
        node.tValue = value;
      }
      if (!TransitionRunning) node.value = value;
    } else node.value = value;
    if (node.observers && node.observers.length) {
      runUpdates(() => {
        for (let i = 0; i < node.observers.length; i += 1) {
          const o = node.observers[i];
          const TransitionRunning = Transition && Transition.running;
          if (TransitionRunning && Transition.disposed.has(o)) continue;
          if (TransitionRunning ? !o.tState : !o.state) {
            if (o.pure) Updates.push(o);else Effects.push(o);
            if (o.observers) markDownstream(o);
          }
          if (!TransitionRunning) o.state = STALE;else o.tState = STALE;
        }
        if (Updates.length > 10e5) {
          Updates = [];
          if (IS_DEV) ;
          throw new Error();
        }
      }, false);
    }
  }
  return value;
}
function updateComputation(node) {
  if (!node.fn) return;
  cleanNode(node);
  const time = ExecCount;
  runComputation(node, Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value, time);
  if (Transition && !Transition.running && Transition.sources.has(node)) {
    queueMicrotask(() => {
      runUpdates(() => {
        Transition && (Transition.running = true);
        Listener = Owner = node;
        runComputation(node, node.tValue, time);
        Listener = Owner = null;
      }, false);
    });
  }
}
function runComputation(node, value, time) {
  let nextValue;
  const owner = Owner,
    listener = Listener;
  Listener = Owner = node;
  try {
    nextValue = node.fn(value);
  } catch (err) {
    if (node.pure) {
      if (Transition && Transition.running) {
        node.tState = STALE;
        node.tOwned && node.tOwned.forEach(cleanNode);
        node.tOwned = undefined;
      } else {
        node.state = STALE;
        node.owned && node.owned.forEach(cleanNode);
        node.owned = null;
      }
    }
    node.updatedAt = time + 1;
    return handleError(err);
  } finally {
    Listener = listener;
    Owner = owner;
  }
  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.updatedAt != null && "observers" in node) {
      writeSignal(node, nextValue, true);
    } else if (Transition && Transition.running && node.pure) {
      Transition.sources.add(node);
      node.tValue = nextValue;
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}
function createComputation(fn, init, pure, state = STALE, options) {
  const c = {
    fn,
    state: state,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: Owner ? Owner.context : null,
    pure
  };
  if (Transition && Transition.running) {
    c.state = 0;
    c.tState = state;
  }
  if (Owner === null) ;else if (Owner !== UNOWNED) {
    if (Transition && Transition.running && Owner.pure) {
      if (!Owner.tOwned) Owner.tOwned = [c];else Owner.tOwned.push(c);
    } else {
      if (!Owner.owned) Owner.owned = [c];else Owner.owned.push(c);
    }
  }
  if (ExternalSourceConfig && c.fn) {
    const [track, trigger] = createSignal(undefined, {
      equals: false
    });
    const ordinary = ExternalSourceConfig.factory(c.fn, trigger);
    onCleanup(() => ordinary.dispose());
    const triggerInTransition = () => startTransition(trigger).then(() => inTransition.dispose());
    const inTransition = ExternalSourceConfig.factory(c.fn, triggerInTransition);
    c.fn = x => {
      track();
      return Transition && Transition.running ? inTransition.track(x) : ordinary.track(x);
    };
  }
  return c;
}
function runTop(node) {
  const runningTransition = Transition && Transition.running;
  if ((runningTransition ? node.tState : node.state) === 0) return;
  if ((runningTransition ? node.tState : node.state) === PENDING) return lookUpstream(node);
  if (node.suspense && untrack(node.suspense.inFallback)) return node.suspense.effects.push(node);
  const ancestors = [node];
  while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
    if (runningTransition && Transition.disposed.has(node)) return;
    if (runningTransition ? node.tState : node.state) ancestors.push(node);
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i];
    if (runningTransition) {
      let top = node,
        prev = ancestors[i + 1];
      while ((top = top.owner) && top !== prev) {
        if (Transition.disposed.has(top)) return;
      }
    }
    if ((runningTransition ? node.tState : node.state) === STALE) {
      updateComputation(node);
    } else if ((runningTransition ? node.tState : node.state) === PENDING) {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(node, ancestors[0]), false);
      Updates = updates;
    }
  }
}
function runUpdates(fn, init) {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;else Effects = [];
  ExecCount++;
  try {
    const res = fn();
    completeUpdates(wait);
    return res;
  } catch (err) {
    if (!wait) Effects = null;
    Updates = null;
    handleError(err);
  }
}
function completeUpdates(wait) {
  if (Updates) {
    if (Scheduler && Transition && Transition.running) scheduleQueue(Updates);else runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  let res;
  if (Transition) {
    if (!Transition.promises.size && !Transition.queue.size) {
      const sources = Transition.sources;
      const disposed = Transition.disposed;
      Effects.push.apply(Effects, Transition.effects);
      res = Transition.resolve;
      for (const e of Effects) {
        "tState" in e && (e.state = e.tState);
        delete e.tState;
      }
      Transition = null;
      runUpdates(() => {
        for (const d of disposed) cleanNode(d);
        for (const v of sources) {
          v.value = v.tValue;
          if (v.owned) {
            for (let i = 0, len = v.owned.length; i < len; i++) cleanNode(v.owned[i]);
          }
          if (v.tOwned) v.owned = v.tOwned;
          delete v.tValue;
          delete v.tOwned;
          v.tState = 0;
        }
        setTransPending(false);
      }, false);
    } else if (Transition.running) {
      Transition.running = false;
      Transition.effects.push.apply(Transition.effects, Effects);
      Effects = null;
      setTransPending(true);
      return;
    }
  }
  const e = Effects;
  Effects = null;
  if (e.length) runUpdates(() => runEffects(e), false);
  if (res) res();
}
function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}
function scheduleQueue(queue) {
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const tasks = Transition.queue;
    if (!tasks.has(item)) {
      tasks.add(item);
      Scheduler(() => {
        tasks.delete(item);
        runUpdates(() => {
          Transition.running = true;
          runTop(item);
        }, false);
        Transition && (Transition.running = false);
      });
    }
  }
}
function runUserEffects(queue) {
  let i,
    userLength = 0;
  for (i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (!e.user) runTop(e);else queue[userLength++] = e;
  }
  if (sharedConfig.context) {
    if (sharedConfig.count) {
      sharedConfig.effects || (sharedConfig.effects = []);
      sharedConfig.effects.push(...queue.slice(0, userLength));
      return;
    }
    setHydrateContext();
  }
  if (sharedConfig.effects && (sharedConfig.done || !sharedConfig.count)) {
    queue = [...sharedConfig.effects, ...queue];
    userLength += sharedConfig.effects.length;
    delete sharedConfig.effects;
  }
  for (i = 0; i < userLength; i++) runTop(queue[i]);
}
function lookUpstream(node, ignore) {
  const runningTransition = Transition && Transition.running;
  if (runningTransition) node.tState = 0;else node.state = 0;
  for (let i = 0; i < node.sources.length; i += 1) {
    const source = node.sources[i];
    if (source.sources) {
      const state = runningTransition ? source.tState : source.state;
      if (state === STALE) {
        if (source !== ignore && (!source.updatedAt || source.updatedAt < ExecCount)) runTop(source);
      } else if (state === PENDING) lookUpstream(source, ignore);
    }
  }
}
function markDownstream(node) {
  const runningTransition = Transition && Transition.running;
  for (let i = 0; i < node.observers.length; i += 1) {
    const o = node.observers[i];
    if (runningTransition ? !o.tState : !o.state) {
      if (runningTransition) o.tState = PENDING;else o.state = PENDING;
      if (o.pure) Updates.push(o);else Effects.push(o);
      o.observers && markDownstream(o);
    }
  }
}
function cleanNode(node) {
  let i;
  if (node.sources) {
    while (node.sources.length) {
      const source = node.sources.pop(),
        index = node.sourceSlots.pop(),
        obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop(),
          s = source.observerSlots.pop();
        if (index < obs.length) {
          n.sourceSlots[s] = index;
          obs[index] = n;
          source.observerSlots[index] = s;
        }
      }
    }
  }
  if (node.tOwned) {
    for (i = node.tOwned.length - 1; i >= 0; i--) cleanNode(node.tOwned[i]);
    delete node.tOwned;
  }
  if (Transition && Transition.running && node.pure) {
    reset(node, true);
  } else if (node.owned) {
    for (i = node.owned.length - 1; i >= 0; i--) cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
    node.cleanups = null;
  }
  if (Transition && Transition.running) node.tState = 0;else node.state = 0;
}
function reset(node, top) {
  if (!top) {
    node.tState = 0;
    Transition.disposed.add(node);
  }
  if (node.owned) {
    for (let i = 0; i < node.owned.length; i++) reset(node.owned[i]);
  }
}
function castError(err) {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error", {
    cause: err
  });
}
function runErrors(err, fns, owner) {
  try {
    for (const f of fns) f(err);
  } catch (e) {
    handleError(e, owner && owner.owner || null);
  }
}
function handleError(err, owner = Owner) {
  const fns = ERROR && owner && owner.context && owner.context[ERROR];
  const error = castError(err);
  if (!fns) throw error;
  if (Effects) Effects.push({
    fn() {
      runErrors(error, fns, owner);
    },
    state: STALE
  });else runErrors(error, fns, owner);
}
function resolveChildren(children) {
  if (typeof children === "function" && !children.length) return resolveChildren(children());
  if (Array.isArray(children)) {
    const results = [];
    for (let i = 0; i < children.length; i++) {
      const result = resolveChildren(children[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }
    return results;
  }
  return children;
}
function createProvider(id, options) {
  return function provider(props) {
    let res;
    createRenderEffect(() => res = untrack(() => {
      Owner.context = {
        ...Owner.context,
        [id]: props.value
      };
      return children(() => props.children);
    }), undefined);
    return res;
  };
}
function onError(fn) {
  ERROR || (ERROR = Symbol("error"));
  if (Owner === null) ;else if (Owner.context === null || !Owner.context[ERROR]) {
    Owner.context = {
      ...Owner.context,
      [ERROR]: [fn]
    };
    mutateContext(Owner, ERROR, [fn]);
  } else Owner.context[ERROR].push(fn);
}
function mutateContext(o, key, value) {
  if (o.owned) {
    for (let i = 0; i < o.owned.length; i++) {
      if (o.owned[i].context === o.context) mutateContext(o.owned[i], key, value);
      if (!o.owned[i].context) {
        o.owned[i].context = o.context;
        mutateContext(o.owned[i], key, value);
      } else if (!o.owned[i].context[key]) {
        o.owned[i].context[key] = value;
        mutateContext(o.owned[i], key, value);
      }
    }
  }
}

function observable(input) {
  return {
    subscribe(observer) {
      if (!(observer instanceof Object) || observer == null) {
        throw new TypeError("Expected the observer to be an object.");
      }
      const handler = typeof observer === "function" ? observer : observer.next && observer.next.bind(observer);
      if (!handler) {
        return {
          unsubscribe() {}
        };
      }
      const dispose = createRoot(disposer => {
        createEffect(() => {
          const v = input();
          untrack(() => handler(v));
        });
        return disposer;
      });
      if (getOwner()) onCleanup(dispose);
      return {
        unsubscribe() {
          dispose();
        }
      };
    },
    [Symbol.observable || "@@observable"]() {
      return this;
    }
  };
}
function from(producer, initalValue = undefined) {
  const [s, set] = createSignal(initalValue, {
    equals: false
  });
  if ("subscribe" in producer) {
    const unsub = producer.subscribe(v => set(() => v));
    onCleanup(() => "unsubscribe" in unsub ? unsub.unsubscribe() : unsub());
  } else {
    const clean = producer(set);
    onCleanup(clean);
  }
  return s;
}

const FALLBACK = Symbol("fallback");
function dispose(d) {
  for (let i = 0; i < d.length; i++) d[i]();
}
function mapArray(list, mapFn, options = {}) {
  let items = [],
    mapped = [],
    disposers = [],
    len = 0,
    indexes = mapFn.length > 1 ? [] : null;
  onCleanup(() => dispose(disposers));
  return () => {
    let newItems = list() || [],
      newLen = newItems.length,
      i,
      j;
    newItems[$TRACK];
    return untrack(() => {
      let newIndices, newIndicesNext, temp, tempdisposers, tempIndexes, start, end, newEnd, item;
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          indexes && (indexes = []);
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback();
          });
          len = 1;
        }
      }
      else if (len === 0) {
        mapped = new Array(newLen);
        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j];
          mapped[j] = createRoot(mapper);
        }
        len = newLen;
      } else {
        temp = new Array(newLen);
        tempdisposers = new Array(newLen);
        indexes && (tempIndexes = new Array(newLen));
        for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++);
        for (end = len - 1, newEnd = newLen - 1; end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
          temp[newEnd] = mapped[end];
          tempdisposers[newEnd] = disposers[end];
          indexes && (tempIndexes[newEnd] = indexes[end]);
        }
        newIndices = new Map();
        newIndicesNext = new Array(newEnd + 1);
        for (j = newEnd; j >= start; j--) {
          item = newItems[j];
          i = newIndices.get(item);
          newIndicesNext[j] = i === undefined ? -1 : i;
          newIndices.set(item, j);
        }
        for (i = start; i <= end; i++) {
          item = items[i];
          j = newIndices.get(item);
          if (j !== undefined && j !== -1) {
            temp[j] = mapped[i];
            tempdisposers[j] = disposers[i];
            indexes && (tempIndexes[j] = indexes[i]);
            j = newIndicesNext[j];
            newIndices.set(item, j);
          } else disposers[i]();
        }
        for (j = start; j < newLen; j++) {
          if (j in temp) {
            mapped[j] = temp[j];
            disposers[j] = tempdisposers[j];
            if (indexes) {
              indexes[j] = tempIndexes[j];
              indexes[j](j);
            }
          } else mapped[j] = createRoot(mapper);
        }
        mapped = mapped.slice(0, len = newLen);
        items = newItems.slice(0);
      }
      return mapped;
    });
    function mapper(disposer) {
      disposers[j] = disposer;
      if (indexes) {
        const [s, set] = createSignal(j);
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }
      return mapFn(newItems[j]);
    }
  };
}
function indexArray(list, mapFn, options = {}) {
  let items = [],
    mapped = [],
    disposers = [],
    signals = [],
    len = 0,
    i;
  onCleanup(() => dispose(disposers));
  return () => {
    const newItems = list() || [],
      newLen = newItems.length;
    newItems[$TRACK];
    return untrack(() => {
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          signals = [];
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback();
          });
          len = 1;
        }
        return mapped;
      }
      if (items[0] === FALLBACK) {
        disposers[0]();
        disposers = [];
        items = [];
        mapped = [];
        len = 0;
      }
      for (i = 0; i < newLen; i++) {
        if (i < items.length && items[i] !== newItems[i]) {
          signals[i](() => newItems[i]);
        } else if (i >= items.length) {
          mapped[i] = createRoot(mapper);
        }
      }
      for (; i < items.length; i++) {
        disposers[i]();
      }
      len = signals.length = disposers.length = newLen;
      items = newItems.slice(0);
      return mapped = mapped.slice(0, len);
    });
    function mapper(disposer) {
      disposers[i] = disposer;
      const [s, set] = createSignal(newItems[i]);
      signals[i] = set;
      return mapFn(s, i);
    }
  };
}

let hydrationEnabled = false;
function enableHydration() {
  hydrationEnabled = true;
}
function createComponent(Comp, props) {
  if (hydrationEnabled) {
    if (sharedConfig.context) {
      const c = sharedConfig.context;
      setHydrateContext(nextHydrateContext());
      const r = untrack(() => Comp(props || {}));
      setHydrateContext(c);
      return r;
    }
  }
  return untrack(() => Comp(props || {}));
}
function trueFn() {
  return true;
}
const propTraps = {
  get(_, property, receiver) {
    if (property === $PROXY) return receiver;
    return _.get(property);
  },
  has(_, property) {
    if (property === $PROXY) return true;
    return _.has(property);
  },
  set: trueFn,
  deleteProperty: trueFn,
  getOwnPropertyDescriptor(_, property) {
    return {
      configurable: true,
      enumerable: true,
      get() {
        return _.get(property);
      },
      set: trueFn,
      deleteProperty: trueFn
    };
  },
  ownKeys(_) {
    return _.keys();
  }
};
function resolveSource(s) {
  return !(s = typeof s === "function" ? s() : s) ? {} : s;
}
function resolveSources() {
  for (let i = 0, length = this.length; i < length; ++i) {
    const v = this[i]();
    if (v !== undefined) return v;
  }
}
function mergeProps(...sources) {
  let proxy = false;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    proxy = proxy || !!s && $PROXY in s;
    sources[i] = typeof s === "function" ? (proxy = true, createMemo(s)) : s;
  }
  if (SUPPORTS_PROXY && proxy) {
    return new Proxy({
      get(property) {
        for (let i = sources.length - 1; i >= 0; i--) {
          const v = resolveSource(sources[i])[property];
          if (v !== undefined) return v;
        }
      },
      has(property) {
        for (let i = sources.length - 1; i >= 0; i--) {
          if (property in resolveSource(sources[i])) return true;
        }
        return false;
      },
      keys() {
        const keys = [];
        for (let i = 0; i < sources.length; i++) keys.push(...Object.keys(resolveSource(sources[i])));
        return [...new Set(keys)];
      }
    }, propTraps);
  }
  const sourcesMap = {};
  const defined = Object.create(null);
  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i];
    if (!source) continue;
    const sourceKeys = Object.getOwnPropertyNames(source);
    for (let i = sourceKeys.length - 1; i >= 0; i--) {
      const key = sourceKeys[i];
      if (key === "__proto__" || key === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(source, key);
      if (!defined[key]) {
        defined[key] = desc.get ? {
          enumerable: true,
          configurable: true,
          get: resolveSources.bind(sourcesMap[key] = [desc.get.bind(source)])
        } : desc.value !== undefined ? desc : undefined;
      } else {
        const sources = sourcesMap[key];
        if (sources) {
          if (desc.get) sources.push(desc.get.bind(source));else if (desc.value !== undefined) sources.push(() => desc.value);
        }
      }
    }
  }
  const target = {};
  const definedKeys = Object.keys(defined);
  for (let i = definedKeys.length - 1; i >= 0; i--) {
    const key = definedKeys[i],
      desc = defined[key];
    if (desc && desc.get) Object.defineProperty(target, key, desc);else target[key] = desc ? desc.value : undefined;
  }
  return target;
}
function splitProps(props, ...keys) {
  const len = keys.length;
  if (SUPPORTS_PROXY && $PROXY in props) {
    const blocked = len > 1 ? keys.flat() : keys[0];
    const res = keys.map(k => {
      return new Proxy({
        get(property) {
          return k.includes(property) ? props[property] : undefined;
        },
        has(property) {
          return k.includes(property) && property in props;
        },
        keys() {
          return k.filter(property => property in props);
        }
      }, propTraps);
    });
    res.push(new Proxy({
      get(property) {
        return blocked.includes(property) ? undefined : props[property];
      },
      has(property) {
        return blocked.includes(property) ? false : property in props;
      },
      keys() {
        return Object.keys(props).filter(k => !blocked.includes(k));
      }
    }, propTraps));
    return res;
  }
  const objects = [];
  for (let i = 0; i <= len; i++) {
    objects[i] = {};
  }
  for (const propName of Object.getOwnPropertyNames(props)) {
    let keyIndex = len;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].includes(propName)) {
        keyIndex = i;
        break;
      }
    }
    const desc = Object.getOwnPropertyDescriptor(props, propName);
    const isDefaultDesc = !desc.get && !desc.set && desc.enumerable && desc.writable && desc.configurable;
    isDefaultDesc ? objects[keyIndex][propName] = desc.value : Object.defineProperty(objects[keyIndex], propName, desc);
  }
  return objects;
}
function lazy(fn) {
  let comp;
  let p;
  const wrap = props => {
    const ctx = sharedConfig.context;
    if (ctx) {
      const [s, set] = createSignal();
      sharedConfig.count || (sharedConfig.count = 0);
      sharedConfig.count++;
      (p || (p = fn())).then(mod => {
        !sharedConfig.done && setHydrateContext(ctx);
        sharedConfig.count--;
        set(() => mod.default);
        setHydrateContext();
      });
      comp = s;
    } else if (!comp) {
      const [s] = createResource(() => (p || (p = fn())).then(mod => mod.default));
      comp = s;
    }
    let Comp;
    return createMemo(() => (Comp = comp()) ? untrack(() => {
      if (IS_DEV) ;
      if (!ctx || sharedConfig.done) return Comp(props);
      const c = sharedConfig.context;
      setHydrateContext(ctx);
      const r = Comp(props);
      setHydrateContext(c);
      return r;
    }) : "");
  };
  wrap.preload = () => p || ((p = fn()).then(mod => comp = () => mod.default), p);
  return wrap;
}
let counter = 0;
function createUniqueId() {
  const ctx = sharedConfig.context;
  return ctx ? sharedConfig.getNextContextId() : `cl-${counter++}`;
}

const narrowedError = name => `Stale read from <${name}>.`;
function For(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(mapArray(() => props.each, props.children, fallback || undefined));
}
function Index(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(indexArray(() => props.each, props.children, fallback || undefined));
}
function Show(props) {
  const keyed = props.keyed;
  const conditionValue = createMemo(() => props.when, undefined, undefined);
  const condition = keyed ? conditionValue : createMemo(conditionValue, undefined, {
    equals: (a, b) => !a === !b
  });
  return createMemo(() => {
    const c = condition();
    if (c) {
      const child = props.children;
      const fn = typeof child === "function" && child.length > 0;
      return fn ? untrack(() => child(keyed ? c : () => {
        if (!untrack(condition)) throw narrowedError("Show");
        return conditionValue();
      })) : child;
    }
    return props.fallback;
  }, undefined, undefined);
}
function Switch(props) {
  const chs = children(() => props.children);
  const switchFunc = createMemo(() => {
    const ch = chs();
    const mps = Array.isArray(ch) ? ch : [ch];
    let func = () => undefined;
    for (let i = 0; i < mps.length; i++) {
      const index = i;
      const mp = mps[i];
      const prevFunc = func;
      const conditionValue = createMemo(() => prevFunc() ? undefined : mp.when, undefined, undefined);
      const condition = mp.keyed ? conditionValue : createMemo(conditionValue, undefined, {
        equals: (a, b) => !a === !b
      });
      func = () => prevFunc() || (condition() ? [index, conditionValue, mp] : undefined);
    }
    return func;
  });
  return createMemo(() => {
    const sel = switchFunc()();
    if (!sel) return props.fallback;
    const [index, conditionValue, mp] = sel;
    const child = mp.children;
    const fn = typeof child === "function" && child.length > 0;
    return fn ? untrack(() => child(mp.keyed ? conditionValue() : () => {
      if (untrack(switchFunc)()?.[0] !== index) throw narrowedError("Match");
      return conditionValue();
    })) : child;
  }, undefined, undefined);
}
function Match(props) {
  return props;
}
let Errors;
function resetErrorBoundaries() {
  Errors && [...Errors].forEach(fn => fn());
}
function ErrorBoundary(props) {
  let err;
  if (sharedConfig.context && sharedConfig.load) err = sharedConfig.load(sharedConfig.getContextId());
  const [errored, setErrored] = createSignal(err, undefined);
  Errors || (Errors = new Set());
  Errors.add(setErrored);
  onCleanup(() => Errors.delete(setErrored));
  return createMemo(() => {
    let e;
    if (e = errored()) {
      const f = props.fallback;
      return typeof f === "function" && f.length ? untrack(() => f(e, () => setErrored())) : f;
    }
    return catchError(() => props.children, setErrored);
  }, undefined, undefined);
}

const suspenseListEquals = (a, b) => a.showContent === b.showContent && a.showFallback === b.showFallback;
const SuspenseListContext = /* #__PURE__ */createContext();
function SuspenseList(props) {
  let [wrapper, setWrapper] = createSignal(() => ({
      inFallback: false
    })),
    show;
  const listContext = useContext(SuspenseListContext);
  const [registry, setRegistry] = createSignal([]);
  if (listContext) {
    show = listContext.register(createMemo(() => wrapper()().inFallback));
  }
  const resolved = createMemo(prev => {
    const reveal = props.revealOrder,
      tail = props.tail,
      {
        showContent = true,
        showFallback = true
      } = show ? show() : {},
      reg = registry(),
      reverse = reveal === "backwards";
    if (reveal === "together") {
      const all = reg.every(inFallback => !inFallback());
      const res = reg.map(() => ({
        showContent: all && showContent,
        showFallback
      }));
      res.inFallback = !all;
      return res;
    }
    let stop = false;
    let inFallback = prev.inFallback;
    const res = [];
    for (let i = 0, len = reg.length; i < len; i++) {
      const n = reverse ? len - i - 1 : i,
        s = reg[n]();
      if (!stop && !s) {
        res[n] = {
          showContent,
          showFallback
        };
      } else {
        const next = !stop;
        if (next) inFallback = true;
        res[n] = {
          showContent: next,
          showFallback: !tail || next && tail === "collapsed" ? showFallback : false
        };
        stop = true;
      }
    }
    if (!stop) inFallback = false;
    res.inFallback = inFallback;
    return res;
  }, {
    inFallback: false
  });
  setWrapper(() => resolved);
  return createComponent(SuspenseListContext.Provider, {
    value: {
      register: inFallback => {
        let index;
        setRegistry(registry => {
          index = registry.length;
          return [...registry, inFallback];
        });
        return createMemo(() => resolved()[index], undefined, {
          equals: suspenseListEquals
        });
      }
    },
    get children() {
      return props.children;
    }
  });
}
function Suspense(props) {
  let counter = 0,
    show,
    ctx,
    p,
    flicker,
    error;
  const [inFallback, setFallback] = createSignal(false),
    SuspenseContext = getSuspenseContext(),
    store = {
      increment: () => {
        if (++counter === 1) setFallback(true);
      },
      decrement: () => {
        if (--counter === 0) setFallback(false);
      },
      inFallback,
      effects: [],
      resolved: false
    },
    owner = getOwner();
  if (sharedConfig.context && sharedConfig.load) {
    const key = sharedConfig.getContextId();
    let ref = sharedConfig.load(key);
    if (ref) {
      if (typeof ref !== "object" || ref.s !== 1) p = ref;else sharedConfig.gather(key);
    }
    if (p && p !== "$$f") {
      const [s, set] = createSignal(undefined, {
        equals: false
      });
      flicker = s;
      p.then(() => {
        if (sharedConfig.done) return set();
        sharedConfig.gather(key);
        setHydrateContext(ctx);
        set();
        setHydrateContext();
      }, err => {
        error = err;
        set();
      });
    }
  }
  const listContext = useContext(SuspenseListContext);
  if (listContext) show = listContext.register(store.inFallback);
  let dispose;
  onCleanup(() => dispose && dispose());
  return createComponent(SuspenseContext.Provider, {
    value: store,
    get children() {
      return createMemo(() => {
        if (error) throw error;
        ctx = sharedConfig.context;
        if (flicker) {
          flicker();
          return flicker = undefined;
        }
        if (ctx && p === "$$f") setHydrateContext();
        const rendered = createMemo(() => props.children);
        return createMemo(prev => {
          const inFallback = store.inFallback(),
            {
              showContent = true,
              showFallback = true
            } = show ? show() : {};
          if ((!inFallback || p && p !== "$$f") && showContent) {
            store.resolved = true;
            dispose && dispose();
            dispose = ctx = p = undefined;
            resumeEffects(store.effects);
            return rendered();
          }
          if (!showFallback) return;
          if (dispose) return prev;
          return createRoot(disposer => {
            dispose = disposer;
            if (ctx) {
              setHydrateContext({
                id: ctx.id + "F",
                count: 0
              });
              ctx = undefined;
            }
            return props.fallback;
          }, owner);
        });
      });
    }
  });
}

const DEV = undefined;

exports.$DEVCOMP = $DEVCOMP;
exports.$PROXY = $PROXY;
exports.$TRACK = $TRACK;
exports.DEV = DEV;
exports.ErrorBoundary = ErrorBoundary;
exports.For = For;
exports.Index = Index;
exports.Match = Match;
exports.Show = Show;
exports.Suspense = Suspense;
exports.SuspenseList = SuspenseList;
exports.Switch = Switch;
exports.batch = batch;
exports.cancelCallback = cancelCallback;
exports.catchError = catchError;
exports.children = children;
exports.createComponent = createComponent;
exports.createComputed = createComputed;
exports.createContext = createContext;
exports.createDeferred = createDeferred;
exports.createEffect = createEffect;
exports.createMemo = createMemo;
exports.createReaction = createReaction;
exports.createRenderEffect = createRenderEffect;
exports.createResource = createResource;
exports.createRoot = createRoot;
exports.createSelector = createSelector;
exports.createSignal = createSignal;
exports.createUniqueId = createUniqueId;
exports.enableExternalSource = enableExternalSource;
exports.enableHydration = enableHydration;
exports.enableScheduling = enableScheduling;
exports.equalFn = equalFn;
exports.from = from;
exports.getListener = getListener;
exports.getOwner = getOwner;
exports.indexArray = indexArray;
exports.lazy = lazy;
exports.mapArray = mapArray;
exports.mergeProps = mergeProps;
exports.observable = observable;
exports.on = on;
exports.onCleanup = onCleanup;
exports.onError = onError;
exports.onMount = onMount;
exports.requestCallback = requestCallback;
exports.resetErrorBoundaries = resetErrorBoundaries;
exports.runWithOwner = runWithOwner;
exports.sharedConfig = sharedConfig;
exports.splitProps = splitProps;
exports.startTransition = startTransition;
exports.untrack = untrack;
exports.useContext = useContext;
exports.useTransition = useTransition;
