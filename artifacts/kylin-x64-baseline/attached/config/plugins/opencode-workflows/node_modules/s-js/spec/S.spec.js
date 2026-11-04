/* global S, describe, it, expect, beforeEach, jasmine */

describe("S()", function () {
    describe("creation", function () {
        it("throws if no function passed in", function () {
            S.root(function () {
                expect(function() { S(); }).toThrow();
            });
        });

        it("throws if arg is not a function", function () {
            S.root(function () {
                expect(function() { S(1); }).toThrow();
            });
        });

        it("generates a function", function () {
            S.root(function () {
                var f = S(function () { return 1; });
                expect(f).toEqual(jasmine.any(Function));
            });
        });

        it("returns initial value of wrapped function", function () {
            S.root(function () {
                var f = S(function () { return 1; });
                expect(f()).toBe(1);
            });
        });
    });

    describe("evaluation", function () {
        it("occurs once intitially", function () {
            S.root(function () {
                var spy = jasmine.createSpy(),
                    f = S(spy);
                expect(spy.calls.count()).toBe(1);
            });
        });

        it("does not re-occur when read", function () {
            S.root(function () {
                var spy = jasmine.createSpy(),
                    f = S(spy);
                f(); f(); f();

                expect(spy.calls.count()).toBe(1);
            });
        });
    });

    describe("with a dependency on an S.data", function () {
        it("updates when S.data is set", function () {
            S.root(function () {
                var d = S.data(1),
                    fevals = 0,
                    f = S(function () { fevals++; return d(); });

                fevals = 0;

                d(1);
                expect(fevals).toBe(1);
            });
        });

        it("does not update when S.data is read", function () {
            S.root(function () {
                var d = S.data(1),
                    fevals = 0,
                    f = S(function () { fevals++; return d(); });

                fevals = 0;

                d();
                expect(fevals).toBe(0);
            });
        });

        it("updates return value", function () {
            S.root(function () {
                var d = S.data(1),
                    fevals = 0,
                    f = S(function () { fevals++; return d(); });

                fevals = 0;

                d(2);
                expect(f()).toBe(2);
            });
        });
    });

    describe("with changing dependencies", function () {
        var i, t, e, fevals, f;

        function init() {
            i = S.data(true);
            t = S.data(1);
            e = S.data(2);
            fevals = 0;
            f = S(function () { fevals++; return i() ? t() : e(); });
            fevals = 0;
        }

        it("updates on active dependencies", function () {
            S.root(function () {
                init();
                t(5);
                expect(fevals).toBe(1);
                expect(f()).toBe(5);
            });
        });

        it("does not update on inactive dependencies", function () {
            S.root(function () {
                init();
                e(5);
                expect(fevals).toBe(0);
                expect(f()).toBe(1);
            });
        });

        it("deactivates obsolete dependencies", function () {
            S.root(function () {
                init();
                i(false);
                fevals = 0;
                t(5);
                expect(fevals).toBe(0);
            });
        });

        it("activates new dependencies", function () {
            S.root(function () {
                init();
                i(false);
                fevals = 0;
                e(5);
                expect(fevals).toBe(1);
            });
        });

        it("insures that new dependencies are updated before dependee", function () {
            S.root(function () {
                var order = "",
                    a = S.data(0),
                    b = S(function () { order += "b"; return a() + 1; }),
                    c = S(function () { order += "c"; return b() || d(); }),
                    d = S(function () { order += "d"; return a() + 10; });

                expect(order).toBe("bcd");

                order = "";
                a(-1);

                expect(order).toBe("bcd");
                expect(c()).toBe(9);

                order = "";
                a(0);

                expect(order).toBe("bcd");
                expect(c()).toBe(1);
            });
        });
    });

    describe("that creates an S.data", function () {
        it("does not register a dependency", function () {
            S.root(function () {
                var fevals = 0,
                    f = S(function () { fevals++; d = S.data(1); });
                fevals = 0;
                d(2);
                expect(fevals).toBe(0);
            });
        });
    });

    describe("from a function with no return value", function () {
        it("reads as undefined", function () {
            S.root(function () {
                var f = S(function () { });
                expect(f()).not.toBeDefined();
            });
        });
    });

    describe("with a seed", function () {
        it("reduces seed value", function () {
            S.root(function () {
                var a = S.data(5),
                    f = S(function (v) { return v + a(); }, 5);
                expect(f()).toBe(10);
                a(6);
                expect(f()).toBe(16);
            });
        });
    });

    describe("with a dependency on a computation", function () {
        var d, fcount, f, gcount, g;

        function init() {
            d = S.data(1),
            fcount = 0,
            f = S(function () { fcount++; return d(); }),
            gcount = 0,
            g = S(function () { gcount++; return f(); });
        }

        it("does not cause re-evaluation", function () {
            S.root(function () {
                init();
                expect(fcount).toBe(1);
            });
        });

        it("does not occur from a read", function () {
            S.root(function () {
                init();
                f();
                expect(gcount).toBe(1);
            });
        });

        it("does not occur from a read of the watcher", function () {
            S.root(function () {
                init();
                g();
                expect(gcount).toBe(1);
            });
        });

        it("occurs when computation updates", function () {
            S.root(function () {
                init();
                d(2);
                expect(fcount).toBe(2);
                expect(gcount).toBe(2);
                expect(g()).toBe(2);
            });
        });
    });

    describe("with unending changes", function () {
        it("throws when continually setting a direct dependency", function () {
            S.root(function () {
                var d = S.data(1);

                expect(function () {
                    S(function () { d(); d(2); });
                }).toThrow();
            });
        });

        it("throws when continually setting an indirect dependency", function () {
            S.root(function () {
                var d = S.data(1),
                    f1 = S(function () { return d(); }),
                    f2 = S(function () { return f1(); }),
                    f3 = S(function () { return f2(); });

                expect(function () {
                    S(function () { f3(); d(2); });
                }).toThrow();
            });
        });
    });
    
    describe("with circular dependencies", function () {
        it("throws when cycle created by modifying a branch", function () {
            S.root(function () {
                var d = S.data(1),
                    f = S(function () { return f ? f() : d(); });

                expect(function () { d(0); }).toThrow();
            });
        });
    });

    describe("with converging dependencies", function () {
        it("propagates in topological order", function () {
            S.root(function () {
                //
                //     c1
                //    /  \
                //   /    \
                //  b1     b2
                //   \    /
                //    \  /
                //     a1 
                //
                var seq = "",
                    a1 = S.data(true),
                    b1 = S(function () { a1();       seq += "b1"; }),
                    b2 = S(function () { a1();       seq += "b2"; }),
                    c1 = S(function () { b1(), b2(); seq += "c1"; });
        
                seq = "";
                a1(true);
        
                expect(seq).toBe("b1b2c1");
            });
        });

        it("only propagates once with linear convergences", function () {
            S.root(function () {
                //         d
                //         |
                // +---+---+---+---+
                // v   v   v   v   v
                // f1  f2  f3  f4  f5
                // |   |   |   |   |
                // +---+---+---+---+
                //         v
                //         g
                var d = S.data(0),
                    f1 = S(function () { return d(); }),
                    f2 = S(function () { return d(); }),
                    f3 = S(function () { return d(); }),
                    f4 = S(function () { return d(); }),
                    f5 = S(function () { return d(); }),
                    gcount = 0,
                    g = S(function () { gcount++; return f1() + f2() + f3() + f4() + f5(); });

                gcount = 0;
                d(0);
                expect(gcount).toBe(1);
            });
        });

        it("only propagates once with exponential convergence", function () {
            S.root(function () {
                //     d
                //     |
                // +---+---+
                // v   v   v
                // f1  f2 f3
                //   \ | /
                //     O
                //   / | \
                // v   v   v
                // g1  g2  g3
                // +---+---+
                //     v
                //     h
                var d = S.data(0),

                    f1 = S(function () { return d(); }),
                    f2 = S(function () { return d(); }),
                    f3 = S(function () { return d(); }),
        
                    g1 = S(function () { return f1() + f2() + f3(); }),
                    g2 = S(function () { return f1() + f2() + f3(); }),
                    g3 = S(function () { return f1() + f2() + f3(); }),
        
                    hcount = 0,
                    h  = S(function () { hcount++; return g1() + g2() + g3(); });

                hcount = 0;
                d(0);
                expect(hcount).toBe(1);
            });
        });
    });
});
