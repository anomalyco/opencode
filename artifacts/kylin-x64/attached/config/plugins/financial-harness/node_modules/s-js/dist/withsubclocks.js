(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global.S = factory());
}(this, (function () { 'use strict';

    // Public interface
    var S = function S(fn, value) {
        var owner = Owner, clock = RunningClock === null ? RootClock : RunningClock, running = RunningNode;
        if (owner === null)
            console.warn("computations created without a root or parent will never be disposed");
        var node = new ComputationNode(clock, fn, value);
        Owner = RunningNode = node;
        if (RunningClock === null) {
            toplevelComputation(node);
        }
        else {
            node.value = node.fn(node.value);
        }
        if (owner && owner !== UNOWNED) {
            if (owner.owned === null)
                owner.owned = [node];
            else
                owner.owned.push(node);
        }
        Owner = owner;
        RunningNode = running;
        return function computation() {
            if (RunningNode !== null) {
                var rclock = RunningClock, sclock = node.clock;
                while (rclock.depth > sclock.depth + 1)
                    rclock = rclock.parent;
                if (rclock === sclock || rclock.parent === sclock) {
                    if (node.preclocks !== null) {
                        for (var i = 0; i < node.preclocks.count; i++) {
                            var preclock = node.preclocks.clocks[i];
                            updateClock(preclock);
                        }
                    }
                    if (node.age === node.clock.time()) {
                        if (node.state === RUNNING)
                            throw new Error("circular dependency");
                        else
                            updateNode(node); // checks for state === STALE internally, so don't need to check here
                    }
                    if (node.preclocks !== null) {
                        for (var i = 0; i < node.preclocks.count; i++) {
                            var preclock = node.preclocks.clocks[i];
                            if (rclock === sclock)
                                logNodePreClock(preclock, RunningNode);
                            else
                                logClockPreClock(preclock, rclock, RunningNode);
                        }
                    }
                }
                else {
                    if (rclock.depth > sclock.depth)
                        rclock = rclock.parent;
                    while (sclock.depth > rclock.depth + 1)
                        sclock = sclock.parent;
                    if (sclock.parent === rclock) {
                        logNodePreClock(sclock, RunningNode);
                    }
                    else {
                        if (sclock.depth > rclock.depth)
                            sclock = sclock.parent;
                        while (rclock.parent !== sclock.parent)
                            rclock = rclock.parent, sclock = sclock.parent;
                        logClockPreClock(sclock, rclock, RunningNode);
                    }
                    updateClock(sclock);
                }
                logComputationRead(node, RunningNode);
            }
            return node.value;
        };
    };
    // compatibility with commonjs systems that expect default export to be at require('s.js').default rather than just require('s-js')
    Object.defineProperty(S, 'default', { value: S });
    S.root = function root(fn) {
        var owner = Owner, root = fn.length === 0 ? UNOWNED : new ComputationNode(RunningClock || RootClock, null, null), result = undefined, disposer = fn.length === 0 ? null : function _dispose() {
            if (RunningClock !== null) {
                markClockStale(root.clock);
                root.clock.disposes.add(root);
            }
            else {
                dispose(root);
            }
        };
        Owner = root;
        if (RunningClock === null) {
            result = topLevelRoot(fn, disposer, owner);
        }
        else {
            result = disposer === null ? fn() : fn(disposer);
            Owner = owner;
        }
        return result;
    };
    function topLevelRoot(fn, disposer, owner) {
        try {
            return disposer === null ? fn() : fn(disposer);
        }
        finally {
            Owner = owner;
        }
    }
    S.on = function on(ev, fn, seed, onchanges) {
        if (Array.isArray(ev))
            ev = callAll(ev);
        onchanges = !!onchanges;
        return S(on, seed);
        function on(value) {
            var running = RunningNode;
            ev();
            if (onchanges)
                onchanges = false;
            else {
                RunningNode = null;
                value = fn(value);
                RunningNode = running;
            }
            return value;
        }
    };
    function callAll(ss) {
        return function all() {
            for (var i = 0; i < ss.length; i++)
                ss[i]();
        };
    }
    S.data = function data(value) {
        var node = new DataNode(RunningClock === null ? RootClock : RunningClock, value);
        return function data(value) {
            var rclock = RunningClock, sclock = node.clock;
            if (RunningClock !== null) {
                while (rclock.depth > sclock.depth)
                    rclock = rclock.parent;
                while (sclock.depth > rclock.depth && sclock.parent !== rclock)
                    sclock = sclock.parent;
                if (sclock.parent !== rclock)
                    while (rclock.parent !== sclock.parent)
                        rclock = rclock.parent, sclock = sclock.parent;
                if (rclock !== sclock) {
                    updateClock(sclock);
                }
            }
            var cclock = rclock === sclock ? sclock : sclock.parent;
            if (arguments.length > 0) {
                if (RunningClock !== null) {
                    if (node.pending !== NOTPENDING) { // value has already been set once, check for conflicts
                        if (value !== node.pending) {
                            throw new Error("conflicting changes: " + value + " !== " + node.pending);
                        }
                    }
                    else { // add to list of changes
                        markClockStale(cclock);
                        node.pending = value;
                        cclock.changes.add(node);
                    }
                }
                else { // not batching, respond to change now
                    if (node.log !== null) {
                        node.pending = value;
                        RootClock.changes.add(node);
                        event();
                    }
                    else {
                        node.value = value;
                    }
                }
                return value;
            }
            else {
                if (RunningNode !== null) {
                    logDataRead(node, RunningNode);
                    if (sclock.parent === rclock)
                        logNodePreClock(sclock, RunningNode);
                    else if (sclock !== rclock)
                        logClockPreClock(sclock, rclock, RunningNode);
                }
                return node.value;
            }
        };
    };
    S.value = function value(current, eq) {
        var data = S.data(current), clock = RunningClock || RootClock, age = -1;
        return function value(update) {
            if (arguments.length === 0) {
                return data();
            }
            else {
                var same = eq ? eq(current, update) : current === update;
                if (!same) {
                    var time = clock.time();
                    if (age === time)
                        throw new Error("conflicting values: " + update + " is not the same as " + current);
                    age = time;
                    current = update;
                    data(update);
                }
                return update;
            }
        };
    };
    S.freeze = function freeze(fn) {
        var result = undefined;
        if (RunningClock !== null) {
            result = fn();
        }
        else {
            RunningClock = RootClock;
            RunningClock.changes.reset();
            try {
                result = fn();
                event();
            }
            finally {
                RunningClock = null;
            }
        }
        return result;
    };
    S.sample = function sample(fn) {
        var result, running = RunningNode;
        if (running !== null) {
            RunningNode = null;
            result = fn();
            RunningNode = running;
        }
        else {
            result = fn();
        }
        return result;
    };
    S.cleanup = function cleanup(fn) {
        if (Owner !== null) {
            if (Owner.cleanups === null)
                Owner.cleanups = [fn];
            else
                Owner.cleanups.push(fn);
        }
        else {
            console.warn("cleanups created without a root or parent will never be run");
        }
    };
    S.subclock = function subclock(fn) {
        var clock = new Clock(RunningClock || RootClock);
        return fn === undefined ? subclock : subclock(fn);
        function subclock(fn) {
            var result = null, running = RunningClock;
            RunningClock = clock;
            clock.state = STALE;
            try {
                result = fn();
                clock.subtime++;
                run(clock);
            }
            finally {
                RunningClock = running;
            }
            // if we were run from top level, have to flush any changes in RootClock
            if (RunningClock === null)
                event();
            return result;
        }
    };
    // Internal implementation
    /// Graph classes and operations
    var Clock = /** @class */ (function () {
        function Clock(parent) {
            this.parent = parent;
            this.id = Clock.count++;
            this.state = CURRENT;
            this.subtime = 0;
            this.preclocks = null;
            this.changes = new Queue(); // batched changes to data nodes
            this.subclocks = new Queue(); // subclocks that need to be updated
            this.updates = new Queue(); // computations to update
            this.disposes = new Queue(); // disposals to run after current batch of updates finishes
            if (parent !== null) {
                this.age = parent.time();
                this.depth = parent.depth + 1;
            }
            else {
                this.age = 0;
                this.depth = 0;
            }
        }
        Clock.prototype.time = function () {
            var time = this.subtime, p = this;
            while ((p = p.parent) !== null)
                time += p.subtime;
            return time;
        };
        Clock.count = 0;
        return Clock;
    }());
    var DataNode = /** @class */ (function () {
        function DataNode(clock, value) {
            this.clock = clock;
            this.value = value;
            this.pending = NOTPENDING;
            this.log = null;
        }
        return DataNode;
    }());
    var ComputationNode = /** @class */ (function () {
        function ComputationNode(clock, fn, value) {
            this.clock = clock;
            this.fn = fn;
            this.value = value;
            this.state = CURRENT;
            this.source1 = null;
            this.source1slot = 0;
            this.sources = null;
            this.sourceslots = null;
            this.log = null;
            this.preclocks = null;
            this.owned = null;
            this.cleanups = null;
            this.age = this.clock.time();
        }
        return ComputationNode;
    }());
    var Log = /** @class */ (function () {
        function Log() {
            this.node1 = null;
            this.node1slot = 0;
            this.nodes = null;
            this.nodeslots = null;
        }
        return Log;
    }());
    var NodePreClockLog = /** @class */ (function () {
        function NodePreClockLog() {
            this.count = 0;
            this.clocks = []; // [clock], where clock.parent === node.clock
            this.ages = []; // clock.id -> node.age
            this.ucount = 0; // number of ancestor clocks with preclocks from this node
            this.uclocks = [];
            this.uclockids = [];
        }
        return NodePreClockLog;
    }());
    var ClockPreClockLog = /** @class */ (function () {
        function ClockPreClockLog() {
            this.count = 0;
            this.clockcounts = []; // clock.id -> ref count
            this.clocks = []; // clock.id -> clock 
            this.ids = []; // [clock.id]
        }
        return ClockPreClockLog;
    }());
    var Queue = /** @class */ (function () {
        function Queue() {
            this.items = [];
            this.count = 0;
        }
        Queue.prototype.reset = function () {
            this.count = 0;
        };
        Queue.prototype.add = function (item) {
            this.items[this.count++] = item;
        };
        Queue.prototype.run = function (fn) {
            var items = this.items;
            for (var i = 0; i < this.count; i++) {
                fn(items[i]);
                items[i] = null;
            }
            this.count = 0;
        };
        return Queue;
    }());
    // Constants
    var NOTPENDING = {}, CURRENT = 0, STALE = 1, RUNNING = 2;
    // "Globals" used to keep track of current system state
    var RootClock = new Clock(null), RunningClock = null, // currently running clock 
    RunningNode = null, // currently running computation
    Owner = null, // owner for new computations
    UNOWNED = new ComputationNode(RootClock, null, null);
    // Functions
    function logRead(from, to) {
        var fromslot, toslot = to.source1 === null ? -1 : to.sources === null ? 0 : to.sources.length;
        if (from.node1 === null) {
            from.node1 = to;
            from.node1slot = toslot;
            fromslot = -1;
        }
        else if (from.nodes === null) {
            from.nodes = [to];
            from.nodeslots = [toslot];
            fromslot = 0;
        }
        else {
            fromslot = from.nodes.length;
            from.nodes.push(to);
            from.nodeslots.push(toslot);
        }
        if (to.source1 === null) {
            to.source1 = from;
            to.source1slot = fromslot;
        }
        else if (to.sources === null) {
            to.sources = [from];
            to.sourceslots = [fromslot];
        }
        else {
            to.sources.push(from);
            to.sourceslots.push(fromslot);
        }
    }
    function logDataRead(data, to) {
        if (data.log === null)
            data.log = new Log();
        logRead(data.log, to);
    }
    function logComputationRead(node, to) {
        if (node.log === null)
            node.log = new Log();
        logRead(node.log, to);
    }
    function logNodePreClock(clock, to) {
        if (to.preclocks === null)
            to.preclocks = new NodePreClockLog();
        else if (to.preclocks.ages[clock.id] === to.age)
            return;
        to.preclocks.ages[clock.id] = to.age;
        to.preclocks.clocks[to.preclocks.count++] = clock;
    }
    function logClockPreClock(sclock, rclock, rnode) {
        var clocklog = rclock.preclocks === null ? (rclock.preclocks = new ClockPreClockLog()) : rclock.preclocks, nodelog = rnode.preclocks === null ? (rnode.preclocks = new NodePreClockLog()) : rnode.preclocks;
        if (nodelog.ages[sclock.id] === rnode.age)
            return;
        nodelog.ages[sclock.id] = rnode.age;
        nodelog.uclocks[nodelog.ucount] = rclock;
        nodelog.uclockids[nodelog.ucount++] = sclock.id;
        var clockcount = clocklog.clockcounts[sclock.id];
        if (clockcount === undefined) {
            clocklog.ids[clocklog.count++] = sclock.id;
            clocklog.clockcounts[sclock.id] = 1;
            clocklog.clocks[sclock.id] = sclock;
        }
        else if (clockcount === 0) {
            clocklog.clockcounts[sclock.id] = 1;
            clocklog.clocks[sclock.id] = sclock;
        }
        else {
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
        }
        finally {
            RunningClock = RunningNode = null;
            Owner = owner;
        }
    }
    function toplevelComputation(node) {
        RunningClock = RootClock;
        RootClock.changes.reset();
        RootClock.subclocks.reset();
        RootClock.updates.reset();
        try {
            node.value = node.fn(node.value);
            if (RootClock.changes.count > 0 || RootClock.subclocks.count > 0 || RootClock.updates.count > 0) {
                RootClock.subtime++;
                run(RootClock);
            }
        }
        finally {
            RunningClock = Owner = RunningNode = null;
        }
    }
    function run(clock) {
        var running = RunningClock, count = 0;
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
    function applyDataChange(data) {
        data.value = data.pending;
        data.pending = NOTPENDING;
        if (data.log)
            markComputationsStale(data.log);
    }
    function markComputationsStale(log) {
        var node1 = log.node1, nodes = log.nodes;
        // mark all downstream nodes stale which haven't been already
        if (node1 !== null)
            markNodeStale(node1);
        if (nodes !== null) {
            for (var i = 0, len = nodes.length; i < len; i++) {
                markNodeStale(nodes[i]);
            }
        }
    }
    function markNodeStale(node) {
        var time = node.clock.time();
        if (node.age < time) {
            markClockStale(node.clock);
            node.age = time;
            node.state = STALE;
            node.clock.updates.add(node);
            if (node.owned !== null)
                markOwnedNodesForDisposal(node.owned);
            if (node.log !== null)
                markComputationsStale(node.log);
        }
    }
    function markOwnedNodesForDisposal(owned) {
        for (var i = 0; i < owned.length; i++) {
            var child = owned[i];
            child.age = child.clock.time();
            child.state = CURRENT;
            if (child.owned !== null)
                markOwnedNodesForDisposal(child.owned);
        }
    }
    function markClockStale(clock) {
        var time = 0;
        if ((clock.parent !== null && clock.age < (time = clock.parent.time())) || clock.state === CURRENT) {
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
    function updateClock(clock) {
        var time = clock.parent.time();
        if (clock.age < time || clock.state === STALE) {
            if (clock.age < time)
                clock.state = CURRENT;
            if (clock.preclocks !== null) {
                for (var i = 0; i < clock.preclocks.ids.length; i++) {
                    var preclock = clock.preclocks.clocks[clock.preclocks.ids[i]];
                    if (preclock)
                        updateClock(preclock);
                }
            }
            clock.age = time;
        }
        if (clock.state === RUNNING) {
            throw new Error("clock circular reference");
        }
        else if (clock.state === STALE) {
            clock.state = RUNNING;
            run(clock);
            clock.state = CURRENT;
        }
    }
    function updateNode(node) {
        if (node.state === STALE) {
            var owner = Owner, running = RunningNode, clock = RunningClock;
            Owner = RunningNode = node;
            RunningClock = node.clock;
            node.state = RUNNING;
            cleanup(node, false);
            node.value = node.fn(node.value);
            node.state = CURRENT;
            Owner = owner;
            RunningNode = running;
            RunningClock = clock;
        }
    }
    function cleanup(node, final) {
        var source1 = node.source1, sources = node.sources, sourceslots = node.sourceslots, cleanups = node.cleanups, owned = node.owned, preclocks = node.preclocks, i, len;
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
                cleanupSource(sources.pop(), sourceslots.pop());
            }
        }
        if (preclocks !== null) {
            for (i = 0; i < preclocks.count; i++) {
                preclocks.clocks[i] = null;
            }
            preclocks.count = 0;
            for (i = 0; i < preclocks.ucount; i++) {
                var upreclocks = preclocks.uclocks[i].preclocks, uclockid = preclocks.uclockids[i];
                if (--upreclocks.clockcounts[uclockid] === 0) {
                    upreclocks.clocks[uclockid] = null;
                }
            }
            preclocks.ucount = 0;
        }
    }
    function cleanupSource(source, slot) {
        var nodes = source.nodes, nodeslots = source.nodeslots, last, lastslot;
        if (slot === -1) {
            source.node1 = null;
        }
        else {
            last = nodes.pop();
            lastslot = nodeslots.pop();
            if (slot !== nodes.length) {
                nodes[slot] = last;
                nodeslots[slot] = lastslot;
                if (lastslot === -1) {
                    last.source1slot = slot;
                }
                else {
                    last.sourceslots[lastslot] = slot;
                }
            }
        }
    }
    function dispose(node) {
        node.clock = null;
        node.fn = null;
        node.log = null;
        node.preclocks = null;
        cleanup(node, true);
    }

    return S;

})));
