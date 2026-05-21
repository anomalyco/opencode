
export interface S {
    // Computation root
    root<T>(fn : (dispose : () => void) => T) : T;

    // Computation constructors
    <T>(fn : () => T) : () => T;
    <T>(fn : (v : T) => T, seed : T) : () => T;
    on<T>(ev : () => any, fn : () => T) : () => T;
    on<T>(ev : () => any, fn : (v : T) => T, seed : T, onchanges?: boolean) : () => T;

    // Data signal constructors
    data<T>(value : T) : DataSignal<T>;
    value<T>(value : T, eq? : (a : T, b : T) => boolean) : DataSignal<T>;

    // Batching changes
    freeze<T>(fn : () => T) : T;

    // Sampling a signal
    sample<T>(fn : () => T) : T;

    // Freeing external resources
    cleanup(fn : (final : boolean) => any) : void;

    // subclocks
    subclock() : <T>(fn : () => T) => T;
    subclock<T>(fn : () => T) : T;
}

export interface DataSignal<T> {
    () : T;
    (val : T) : T;
}

// Public interface
const S = <S>function S<T>(fn : (v : T) => T, value : T) : () => T {
    var owner  = Owner,
        clock  = RunningClock === null ? RootClock : RunningClock,
        running = RunningNode;

    if (owner === null) console.warn("computations created without a root or parent will never be disposed");

    var node = new ComputationNode(clock, fn, value);
        
    Owner = RunningNode = node;
    
    if (RunningClock === null) {
        toplevelComputation(node);
    } else {
        node.value = node.fn!(node.value);
    }
    
    if (owner && owner !== UNOWNED) {
        if (owner.owned === null) owner.owned = [node];
        else owner.owned.push(node);
    }
    
    Owner = owner;
    RunningNode = running;

    return function computation() {
        if (RunningNode !== null) {
            var rclock = RunningClock!,
                sclock = node.clock;

            while (rclock.depth > sclock.depth + 1) rclock = rclock.parent!;

            if (rclock === sclock || rclock.parent === sclock) {
                if (node.preclocks !== null) {
                    for (var i = 0; i < node.preclocks.count; i++) {
                        var preclock = node.preclocks.clocks[i];
                        updateClock(preclock);
                    }
                }

                if (node.age === node.clock.time()) {
                    if (node.state === RUNNING) throw new Error("circular dependency");
                    else updateNode(node); // checks for state === STALE internally, so don't need to check here
                }

                if (node.preclocks !== null) {
                    for (var i = 0; i < node.preclocks.count; i++) {
                        var preclock = node.preclocks.clocks[i];
                        if (rclock === sclock) logNodePreClock(preclock, RunningNode);
                        else logClockPreClock(preclock, rclock, RunningNode);
                    }
                }
            } else {
                if (rclock.depth > sclock.depth) rclock = rclock.parent!;

                while (sclock.depth > rclock.depth + 1) sclock = sclock.parent!;

                if (sclock.parent === rclock) {
                    logNodePreClock(sclock, RunningNode);
                } else {
                    if (sclock.depth > rclock.depth) sclock = sclock.parent!;
                    while (rclock.parent !== sclock.parent) rclock = rclock.parent!, sclock = sclock.parent!;
                    logClockPreClock(sclock, rclock, RunningNode);
                }

                updateClock(sclock);
            }

            logComputationRead(node, RunningNode);
        }

        return node.value;
    }
};

// compatibility with commonjs systems that expect default export to be at require('s.js').default rather than just require('s-js')
Object.defineProperty(S, 'default', { value : S });

export default S;

S.root = function root<T>(fn : (dispose : () => void) => T) : T {
    var owner = Owner,
        root = fn.length === 0 ? UNOWNED : new ComputationNode(RunningClock || RootClock, null, null),
        result : T = undefined!,
        disposer = fn.length === 0 ? null : function _dispose() {
            if (RunningClock !== null) {
                markClockStale(root.clock);
                root.clock.disposes.add(root);
            } else {
                dispose(root);
            }
        };

    Owner = root;

    if (RunningClock === null) {
        result = topLevelRoot(fn, disposer, owner);
    } else {
        result = disposer === null ? (fn as any)() : fn(disposer);
        Owner = owner;
    }

    return result;
};

function topLevelRoot<T>(fn : (dispose : () => void) => T, disposer : (() => void) | null, owner : ComputationNode | null) {
    try {
        return disposer === null ? (fn as any)() : fn(disposer);
    } finally {
        Owner = owner;
    }
}

S.on = function on<T>(ev : () => any, fn : (v? : T) => T, seed? : T, onchanges? : boolean) {
    if (Array.isArray(ev)) ev = callAll(ev);
    onchanges = !!onchanges;

    return S(on, seed);
    
    function on(value : T | undefined) {
        var running = RunningNode;
        ev(); 
        if (onchanges) onchanges = false;
        else {
            RunningNode = null;
            value = fn(value);
            RunningNode = running;
        } 
        return value;
    }
};

function callAll(ss : (() => any)[]) {
    return function all() {
        for (var i = 0; i < ss.length; i++) ss[i]();
    }
}

S.data = function data<T>(value : T) : (value? : T) => T {
    var node = new DataNode(RunningClock === null ? RootClock : RunningClock, value);

    return function data(value? : T) : T {
        var rclock = RunningClock!,
            sclock = node.clock;

        if (RunningClock !== null) {
            while (rclock.depth > sclock.depth) rclock = rclock.parent!;
            while (sclock.depth > rclock.depth && sclock.parent !== rclock) sclock = sclock.parent!;
            if (sclock.parent !== rclock)
                while (rclock.parent !== sclock.parent) rclock = rclock.parent!, sclock = sclock.parent!;

            if (rclock !== sclock) {
                updateClock(sclock);
            }
        }

        var cclock = rclock === sclock ? sclock! : sclock.parent!;

        if (arguments.length > 0) {
            if (RunningClock !== null) {
                if (node.pending !== NOTPENDING) { // value has already been set once, check for conflicts
                    if (value !== node.pending) {
                        throw new Error("conflicting changes: " + value + " !== " + node.pending);
                    }
                } else { // add to list of changes
                    markClockStale(cclock);
                    node.pending = value;
                    cclock.changes.add(node);
                }
            } else { // not batching, respond to change now
                if (node.log !== null) {
                    node.pending = value;
                    RootClock.changes.add(node);
                    event();
                } else {
                    node.value = value;
                }
            }
            return value!;
        } else {
            if (RunningNode !== null) {
                logDataRead(node, RunningNode);
                if (sclock.parent === rclock) logNodePreClock(sclock, RunningNode);
                else if (sclock !== rclock) logClockPreClock(sclock, rclock, RunningNode);
            }
            return node.value;
        }
    }
};

S.value = function value<T>(current : T, eq? : (a : T, b : T) => boolean) : DataSignal<T> {
    var data  = S.data(current),
        clock = RunningClock || RootClock,
        age   = -1;
    return function value(update? : T) {
        if (arguments.length === 0) {
            return data();
        } else {
            var same = eq ? eq(current, update!) : current === update;
            if (!same) {
                var time = clock.time();
                if (age === time) 
                    throw new Error("conflicting values: " + update + " is not the same as " + current);
                age = time;
                current = update!;
                data(update!);
            }
            return update!;
        }
    }
};

S.freeze = function freeze<T>(fn : () => T) : T {
    var result : T = undefined!;
    
    if (RunningClock !== null) {
        result = fn();
    } else {
        RunningClock = RootClock;
        RunningClock.changes.reset();

        try {
            result = fn();
            event();
        } finally {
            RunningClock = null;
        }
    }
        
    return result;
};

S.sample = function sample<T>(fn : () => T) : T {
    var result : T,
        running = RunningNode;
    
    if (running !== null) {
        RunningNode = null;
        result = fn();
        RunningNode = running;
    } else {
        result = fn();
    }
    
    return result;
}

S.cleanup = function cleanup(fn : (final : boolean) => void) : void {
    if (Owner !== null) {
        if (Owner.cleanups === null) Owner.cleanups = [fn];
        else Owner.cleanups.push(fn);
    } else {
        console.warn("cleanups created without a root or parent will never be run");
    }
};

S.subclock = function subclock<T>(fn? : () => T) {
    var clock = new Clock(RunningClock || RootClock);

    return fn === undefined ? subclock : subclock(fn);
    
    function subclock<T>(fn : () => T) {
        var result : T = null!,
            running = RunningClock;
        RunningClock = clock;
        clock.state = STALE;
        try {
            result = fn();
            clock.subtime++;
            run(clock);
        } finally {
            RunningClock = running;
        }
        // if we were run from top level, have to flush any changes in RootClock
        if (RunningClock === null) event();
        return result;
    }
}

// Internal implementation

/// Graph classes and operations
class Clock {
    static count = 0;

    id        = Clock.count++;
    depth     : number;
    age       : number;
    state     = CURRENT;
    subtime   = 0;

    preclocks = null as ClockPreClockLog | null;
    changes   = new Queue<DataNode>(); // batched changes to data nodes
    subclocks = new Queue<Clock>(); // subclocks that need to be updated
    updates   = new Queue<ComputationNode>(); // computations to update
    disposes  = new Queue<ComputationNode>(); // disposals to run after current batch of updates finishes

    constructor(
        public parent : Clock | null
    ) { 
        if (parent !== null) {
            this.age = parent.time();
            this.depth = parent.depth + 1;
        } else {
            this.age = 0;
            this.depth = 0;
        }
    }

    time () {
        var time = this.subtime,
            p = this as Clock;
        while ((p = p.parent!) !== null) time += p.subtime;
        return time;
    }
}

class DataNode {
    pending = NOTPENDING as any;   
    log     = null as Log | null;
    
    constructor(
        public clock : Clock,
        public value : any
    ) { }
}

class ComputationNode {
    age       : number;
    state     = CURRENT;
    source1   = null as null | Log;
    source1slot = 0;
    sources   = null as null | Log[];
    sourceslots = null as null | number[];
    log       = null as Log | null;
    preclocks = null as NodePreClockLog | null;
    owned     = null as ComputationNode[] | null;
    cleanups  = null as (((final : boolean) => void)[]) | null;
    
    constructor(
        public clock : Clock,
        public fn    : ((v : any) => any) | null,
        public value : any
    ) { 
        this.age = this.clock.time();
    }
}

class Log {
    node1 = null as null | ComputationNode;
    node1slot = 0;
    nodes = null as null | ComputationNode[];
    nodeslots = null as null | number[];
}

class NodePreClockLog {
    count     = 0;
    clocks    = [] as Clock[]; // [clock], where clock.parent === node.clock
    ages      = [] as number[]; // clock.id -> node.age
    ucount    = 0; // number of ancestor clocks with preclocks from this node
    uclocks   = [] as Clock[];
    uclockids = [] as number[];
}

class ClockPreClockLog {
    count       = 0;
    clockcounts = [] as number[]; // clock.id -> ref count
    clocks      = [] as (Clock | null)[]; // clock.id -> clock 
    ids         = [] as number[]; // [clock.id]
}
    
class Queue<T> {
    items = [] as T[];
    count = 0;
    
    reset() {
        this.count = 0;
    }
    
    add(item : T) {
        this.items[this.count++] = item;
    }
    
    run(fn : (item : T) => void) {
        var items = this.items;
        for (var i = 0; i < this.count; i++) {
            fn(items[i]!);
            items[i] = null!;
        }
        this.count = 0;
    }
}

// Constants
var NOTPENDING = {},
    CURRENT    = 0,
    STALE      = 1,
    RUNNING    = 2;

// "Globals" used to keep track of current system state
var RootClock    = new Clock(null),
    RunningClock = null as Clock | null, // currently running clock 
    RunningNode  = null as ComputationNode | null, // currently running computation
    Owner        = null as ComputationNode | null, // owner for new computations
    UNOWNED      = new ComputationNode(RootClock, null, null);

// Functions
function logRead(from : Log, to : ComputationNode) {
    var fromslot : number,
        toslot = to.source1 === null ? -1 : to.sources === null ? 0 : to.sources.length;
        
    if (from.node1 === null) {
        from.node1 = to;
        from.node1slot = toslot;
        fromslot = -1;
    } else if (from.nodes === null) {
        from.nodes = [to];
        from.nodeslots = [toslot];
        fromslot = 0;
    } else {
        fromslot = from.nodes.length;
        from.nodes.push(to);
        from.nodeslots!.push(toslot);
    }

    if (to.source1 === null) {
        to.source1 = from;
        to.source1slot = fromslot;
    } else if (to.sources === null) {
        to.sources = [from];
        to.sourceslots = [fromslot];
    } else {
        to.sources.push(from);
        to.sourceslots!.push(fromslot);
    }
}

function logDataRead(data : DataNode, to : ComputationNode) {
    if (data.log === null) data.log = new Log();
    logRead(data.log, to);
}

function logComputationRead(node : ComputationNode, to : ComputationNode) {
    if (node.log === null) node.log = new Log();
    logRead(node.log, to);
}

function logNodePreClock(clock : Clock, to : ComputationNode) {
    if (to.preclocks === null) to.preclocks = new NodePreClockLog();
    else if (to.preclocks.ages[clock.id] === to.age) return;
    to.preclocks.ages[clock.id] = to.age;
    to.preclocks.clocks[to.preclocks.count++] = clock;
}

function logClockPreClock(sclock : Clock, rclock : Clock, rnode : ComputationNode) {
    var clocklog = rclock.preclocks === null ? (rclock.preclocks = new ClockPreClockLog()) : rclock.preclocks,
        nodelog = rnode.preclocks === null ? (rnode.preclocks = new NodePreClockLog()) : rnode.preclocks;

    if (nodelog.ages[sclock.id] === rnode.age) return;

    nodelog.ages[sclock.id] = rnode.age;
    nodelog.uclocks[nodelog.ucount] = rclock;
    nodelog.uclockids[nodelog.ucount++] = sclock.id;

    var clockcount = clocklog.clockcounts[sclock.id];
    if (clockcount === undefined) {
        clocklog.ids[clocklog.count++] = sclock.id;
        clocklog.clockcounts[sclock.id] = 1;
        clocklog.clocks[sclock.id] = sclock;
    } else if (clockcount === 0) {
        clocklog.clockcounts[sclock.id] = 1;
        clocklog.clocks[sclock.id] = sclock;
    } else {
        clocklog.clockcounts[sclock.id]++;
    }
}

function event() {
    // b/c we might be under a top level S.root(), have to preserve current root
    var owner = Owner;
    RootClock.subclocks.reset();
    RootClock.updates.reset();
    RootClock.subtime++;
    try {
        run(RootClock);
    } finally {
        RunningClock = RunningNode = null;
        Owner = owner;
    }
}

function toplevelComputation<T>(node : ComputationNode) {
    RunningClock = RootClock;
    RootClock.changes.reset();
    RootClock.subclocks.reset();
    RootClock.updates.reset();

    try {
        node.value = node.fn!(node.value);

        if (RootClock.changes.count > 0 || RootClock.subclocks.count > 0 || RootClock.updates.count > 0) {
            RootClock.subtime++;
            run(RootClock);
        }
    } finally {
        RunningClock = Owner = RunningNode = null;
    }
}
    
function run(clock : Clock) {
    var running = RunningClock,
        count = 0;
        
    RunningClock = clock;

    clock.disposes.reset();
    
    // for each batch ...
    while (clock.changes.count !== 0 || clock.subclocks.count !== 0 || clock.updates.count !== 0 || clock.disposes.count !== 0) {
        if (count > 0) // don't tick on first run, or else we expire already scheduled updates
            clock.subtime++;

        clock.changes.run(applyDataChange);
        clock.subclocks.run(updateClock);
        clock.updates.run(updateNode);
        clock.disposes.run(dispose);

        // if there are still changes after excessive batches, assume runaway            
        if (count++ > 1e5) {
            throw new Error("Runaway clock detected");
        }
    }

    RunningClock = running;
}

function applyDataChange(data : DataNode) {
    data.value = data.pending;
    data.pending = NOTPENDING;
    if (data.log) markComputationsStale(data.log);
}

function markComputationsStale(log : Log) {
    var node1     = log.node1,
        nodes     = log.nodes;

    // mark all downstream nodes stale which haven't been already
    if (node1 !== null) markNodeStale(node1);
    if (nodes !== null) {
        for (var i = 0, len = nodes.length; i < len; i++) {
            markNodeStale(nodes[i]);
        }
    }
}

function markNodeStale(node : ComputationNode) {
    var time = node.clock.time();
    if (node.age < time) {
        markClockStale(node.clock);
        node.age = time;
        node.state = STALE;
        node.clock.updates.add(node);
        if (node.owned !== null) markOwnedNodesForDisposal(node.owned);
        if (node.log !== null) markComputationsStale(node.log);
    }
}

function markOwnedNodesForDisposal(owned : ComputationNode[]) {
    for (var i = 0; i < owned.length; i++) {
        var child = owned[i];
        child.age = child.clock.time();
        child.state = CURRENT;
        if (child.owned !== null) markOwnedNodesForDisposal(child.owned);
    }
}

function markClockStale(clock : Clock) {
    var time = 0;
    if ((clock.parent !== null && clock.age < (time = clock.parent!.time())) || clock.state === CURRENT) {
        if (clock.parent !== null) {
            clock.age = time;
            markClockStale(clock.parent);
            clock.parent.subclocks.add(clock);
        }
        clock.changes.reset();
        clock.subclocks.reset();
        clock.updates.reset();
        clock.state = STALE;
    }
}

function updateClock(clock : Clock) {
    var time = clock.parent!.time();
    if (clock.age < time || clock.state === STALE) {
        if (clock.age < time) clock.state = CURRENT;
        if (clock.preclocks !== null) {
            for (var i = 0; i < clock.preclocks.ids.length; i++) {
                var preclock = clock.preclocks.clocks[clock.preclocks.ids[i]];
                if (preclock) updateClock(preclock);
            }
        }
        clock.age = time;
    }

    if (clock.state === RUNNING) {
        throw new Error("clock circular reference");
    } else if (clock.state === STALE) {
        clock.state = RUNNING;
        run(clock);
        clock.state = CURRENT;
    }
}

function updateNode(node : ComputationNode) {
    if (node.state === STALE) {
        var owner = Owner,
            running = RunningNode,
            clock = RunningClock;
    
        Owner = RunningNode = node;
        RunningClock = node.clock;
    
        node.state = RUNNING;
        cleanup(node, false);
        node.value = node.fn!(node.value);
        node.state = CURRENT;
        
        Owner = owner;
        RunningNode = running;
        RunningClock = clock;
    }
}
    
function cleanup(node : ComputationNode, final : boolean) {
    var source1     = node.source1,
        sources     = node.sources,
        sourceslots = node.sourceslots,
        cleanups    = node.cleanups,
        owned       = node.owned,
        preclocks   = node.preclocks,
        i           : number,
        len         : number;
        
    if (cleanups !== null) {
        for (i = 0; i < cleanups.length; i++) {
            cleanups[i](final);
        }
        node.cleanups = null;
    }
    
    if (owned !== null) {
        for (i = 0; i < owned.length; i++) {
            dispose(owned[i]);
        }
        node.owned = null;
    }
    
    if (source1 !== null) {
        cleanupSource(source1, node.source1slot);
        node.source1 = null;
    }
    if (sources !== null) {
        for (i = 0, len = sources.length; i < len; i++) {
            cleanupSource(sources.pop()!, sourceslots!.pop()!);
        }
    }

    if (preclocks !== null) {
        for (i = 0; i < preclocks.count; i++) {
            preclocks.clocks[i] = null!;
        }
        preclocks.count = 0;

        for (i = 0; i < preclocks.ucount; i++) {
            var upreclocks = preclocks.uclocks[i].preclocks!,
                uclockid   = preclocks.uclockids[i];
            if (--upreclocks.clockcounts[uclockid] === 0) {
                upreclocks.clocks[uclockid] = null;
            }
        }
        preclocks.ucount = 0;
    }
}

function cleanupSource(source : Log, slot : number) {
    var nodes = source.nodes!,
        nodeslots = source.nodeslots!,
        last : ComputationNode,
        lastslot : number;
    if (slot === -1) {
        source.node1 = null;
    } else {
        last = nodes.pop()!;
        lastslot = nodeslots.pop()!;
        if (slot !== nodes.length) {
            nodes[slot] = last;
            nodeslots[slot] = lastslot;
            if (lastslot === -1) {
                last.source1slot = slot;
            } else {
                last.sourceslots![lastslot] = slot;
            }
        }
    }
}
    
function dispose(node : ComputationNode) {
    node.clock     = null!;
    node.fn        = null;
    node.log       = null;
    node.preclocks = null;
    
    cleanup(node, true);
}