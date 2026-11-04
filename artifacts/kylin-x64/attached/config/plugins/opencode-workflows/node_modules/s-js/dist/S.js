(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global.S = factory());
}(this, (function () { 'use strict';

    // Public interface
    var S = function S(fn, value) {
        var node = new ComputationNode(fn, value);
        return function computation() {
            return node.current();
        };
    };
    // compatibility with commonjs systems that expect default export to be at require('s.js').default rather than just require('s-js')
    Object.defineProperty(S, 'default', { value: S });
    S.root = function root(fn) {
        var owner = Owner, root = fn.length === 0 ? UNOWNED : new ComputationNode(null, null), result = undefined, disposer = fn.length === 0 ? null : function _dispose() {
            if (RunningClock !== null) {
                RootClock.disposes.add(root);
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
    S.effect = function effect(fn, value) {
        new ComputationNode(fn, value);
    };
    S.data = function data(value) {
        var node = new DataNode(value);
        return function data(value) {
            if (arguments.length === 0) {
                return node.current();
            }
            else {
                return node.next(value);
            }
        };
    };
    S.value = function value(current, eq) {
        var data = S.data(current), age = -1;
        return function value(update) {
            if (arguments.length === 0) {
                return data();
            }
            else {
                var same = eq ? eq(current, update) : current === update;
                if (!same) {
                    var time = RootClock.time;
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
    // experimental : exposing node constructors and some state
    S.makeDataNode = function makeDataNode(value) {
        return new DataNode(value);
    };
    S.makeComputationNode = function makeComputationNode(fn, seed) {
        return new ComputationNode(fn, seed);
    };
    S.isFrozen = function isFrozen() {
        return RunningClock !== null;
    };
    S.isListening = function isListening() {
        return RunningNode !== null;
    };
    // Internal implementation
    /// Graph classes and operations
    var Clock = /** @class */ (function () {
        function Clock() {
            this.time = 0;
            this.changes = new Queue(); // batched changes to data nodes
            this.updates = new Queue(); // computations to update
            this.disposes = new Queue(); // disposals to run after current batch of updates finishes
        }
        return Clock;
    }());
    var RootClockProxy = {
        time: function () { return RootClock.time; }
    };
    var DataNode = /** @class */ (function () {
        function DataNode(value) {
            this.value = value;
            this.pending = NOTPENDING;
            this.log = null;
        }
        DataNode.prototype.current = function () {
            if (RunningNode !== null) {
                logDataRead(this, RunningNode);
            }
            return this.value;
        };
        DataNode.prototype.next = function (value) {
            if (RunningClock !== null) {
                if (this.pending !== NOTPENDING) { // value has already been set once, check for conflicts
                    if (value !== this.pending) {
                        throw new Error("conflicting changes: " + value + " !== " + this.pending);
                    }
                }
                else { // add to list of changes
                    this.pending = value;
                    RootClock.changes.add(this);
                }
            }
            else { // not batching, respond to change now
                if (this.log !== null) {
                    this.pending = value;
                    RootClock.changes.add(this);
                    event();
                }
                else {
                    this.value = value;
                }
            }
            return value;
        };
        DataNode.prototype.clock = function () {
            return RootClockProxy;
        };
        return DataNode;
    }());
    var ComputationNode = /** @class */ (function () {
        function ComputationNode(fn, value) {
            this.state = CURRENT;
            this.source1 = null;
            this.source1slot = 0;
            this.sources = null;
            this.sourceslots = null;
            this.log = null;
            this.owned = null;
            this.cleanups = null;
            this.fn = fn;
            this.value = value;
            this.age = RootClock.time;
            if (fn === null)
                return;
            var owner = Owner, running = RunningNode;
            if (owner === null)
                console.warn("computations created without a root or parent will never be disposed");
            Owner = RunningNode = this;
            if (RunningClock === null) {
                toplevelComputation(this);
            }
            else {
                this.value = this.fn(this.value);
            }
            if (owner && owner !== UNOWNED) {
                if (owner.owned === null)
                    owner.owned = [this];
                else
                    owner.owned.push(this);
            }
            Owner = owner;
            RunningNode = running;
        }
        ComputationNode.prototype.current = function () {
            if (RunningNode !== null) {
                if (this.age === RootClock.time) {
                    if (this.state === RUNNING)
                        throw new Error("circular dependency");
                    else
                        updateNode(this); // checks for state === STALE internally, so don't need to check here
                }
                logComputationRead(this, RunningNode);
            }
            return this.value;
        };
        ComputationNode.prototype.clock = function () {
            return RootClockProxy;
        };
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
    var RootClock = new Clock(), RunningClock = null, // currently running clock 
    RunningNode = null, // currently running computation
    Owner = null, // owner for new computations
    UNOWNED = new ComputationNode(null, null);
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
    function event() {
        // b/c we might be under a top level S.root(), have to preserve current root
        var owner = Owner;
        RootClock.updates.reset();
        RootClock.time++;
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
        RootClock.updates.reset();
        try {
            node.value = node.fn(node.value);
            if (RootClock.changes.count > 0 || RootClock.updates.count > 0) {
                RootClock.time++;
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
        while (clock.changes.count !== 0 || clock.updates.count !== 0 || clock.disposes.count !== 0) {
            if (count > 0) // don't tick on first run, or else we expire already scheduled updates
                clock.time++;
            clock.changes.run(applyDataChange);
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
        var time = RootClock.time;
        if (node.age < time) {
            node.age = time;
            node.state = STALE;
            RootClock.updates.add(node);
            if (node.owned !== null)
                markOwnedNodesForDisposal(node.owned);
            if (node.log !== null)
                markComputationsStale(node.log);
        }
    }
    function markOwnedNodesForDisposal(owned) {
        for (var i = 0; i < owned.length; i++) {
            var child = owned[i];
            child.age = RootClock.time;
            child.state = CURRENT;
            if (child.owned !== null)
                markOwnedNodesForDisposal(child.owned);
        }
    }
    function updateNode(node) {
        if (node.state === STALE) {
            var owner = Owner, running = RunningNode;
            Owner = RunningNode = node;
            node.state = RUNNING;
            cleanup(node, false);
            node.value = node.fn(node.value);
            node.state = CURRENT;
            Owner = owner;
            RunningNode = running;
        }
    }
    function cleanup(node, final) {
        var source1 = node.source1, sources = node.sources, sourceslots = node.sourceslots, cleanups = node.cleanups, owned = node.owned, i, len;
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
        node.fn = null;
        node.log = null;
        cleanup(node, true);
    }

    return S;

})));
