if (S.subclock) {
    describe("S.subclock()", () => {
        it("runs computations to completion before they are visible to surrounding code", function () {
            S.root(() => {
                var d = S.data(1),
                    f = S.subclock()(() => {
                        var out = S.data(2);
                        S(() => d() >= 10 || out(d()));
                        return out;
                    }),
                    c = S.on(f, c => c + 1, 0);

                expect(f()).toBe(1);
                expect(c()).toBe(1);
                d(2);
                expect(f()).toBe(2);
                expect(c()).toBe(2);
                // setting d() to > 10 does not update f()
                d(12);
                expect(f()).toBe(2);
                expect(c()).toBe(2);
                // going back < 10 does update f()
                d(8);
                expect(f()).toBe(8);
                expect(c()).toBe(3);
            });
        });

        it("descendant computations see all states", () => {
            S.root(() => {
                var { d, f } = S.subclock(() => {
                    var d = S.data(5),
                        f = S.subclock(() =>
                            S.on(d, c => c + 1, 0)
                        );

                    S(() => d() >= 5 || d(d() + 1));

                    return { d, f };
                });
                
                expect(f()).toBe(1);
                d(1);
                expect(f()).toBe(6);
            });
        });
        
        it("ancestor computations only see final state", function () {
            S.root(function () {
                var { d, f } = S.subclock(() => {
                    var d = S.subclock(() => {
                            var d = S.data(5);
                            S(() => d() >= 5 || d(d() + 1));
                            return d;
                        }),
                        f = S.on(d, c => c + 1, 0);
                    return { d, f };
                });
                
                expect(d()).toBe(5);
                expect(f()).toBe(1);
                d(1);
                expect(d()).toBe(5);
                expect(f()).toBe(2);
            });
        });

        it("sibling processes and nodes only see final state", function () {
            S.root(()=>{
                var d = S.data("abcdefgh"),
                    c1 = S.subclock(()=>{
                        var d1 = S.data(""),
                            n1 = S(() => d1(d())),
                            n2 = S(() => d1().length < 6 || d1(d1().substr(1)));
                        return { d1, n1, n2 };
                    }),
                    c2 = S.subclock(()=>{
                        var d1 = S.data(""),
                            n1 = S(() => d1(c1.d1())),
                            n2 = S(() => d1().length < 4 || d1(d1().substr(0, d1().length - 1)));
                        return { d1, n1, n2 };
                    }),
                    n3 = S(() => c2.d1()),
                    n3c = S.on(n3, c => c + 1, 0);
                
                expect(d()).toBe("abcdefgh");
                expect(c1.d1()).toBe("defgh");
                expect(c2.d1()).toBe("def");
                expect(n3()).toBe("def");
                expect(n3c()).toBe(1);

                d("1234567");
                expect(c1.d1()).toBe("34567");
                expect(c2.d1()).toBe("345");
                expect(n3()).toBe("345");
                expect(n3c()).toBe(2);
            });
        });

        it("can reference computions in a higher clock", function () {
            S.root(() => {
                var a = S.data(1),
                    b = S(() => a()),
                    c = S.subclock(() => 
                            S(() => a() + b())
                        );

                a(2);

                expect(c()).toBe(4);
            });
        });

        it("allows mutations from inside and outside a subclock", function () {
            S.root(() => {
                var sub = S.subclock(() => {
                        var a = S.data(""),
                            b = S(() => (a().length % 3) === 0 || a(a() + "i"));
                        return { a };
                    }),
                    c = S(() => (sub.a().length % 5) === 0 || sub.a(sub.a() + "o"));

                expect(sub.a()).toBe("");
                sub.a("g");
                // doesn't stabilize until a().length is divisible by both 3 and 5, i.e. length of 15
                expect(sub.a()).toBe("giioiioiioiioii");
            });
        });

        it("throw an exception when there's a circular dependency between a computation and a clock", function () {
            S.root(() => {
                var a = S.data(true),
                    b = S(() => a() || sub.c()), // b() depends on sub when a() is false
                    sub = S.subclock(() => ({
                        c: S(() => a()),
                        d: S(() => b()) // sub depends on b()
                    }));

                expect(() => a(false)).toThrowError(/circular/);
            });
        });

        it("throw an exception when there's a circular dependency between two clocks", function () {
            S.root(() => {
                var a = S.data(true),
                    sub1 = S.subclock(() => ({
                        b: S(() => a() || sub2.c()) // sub1 depends on sub2 when a() is false
                    })), 
                    sub2 = S.subclock(() => ({
                        c: S(() => sub1.b()) // sub2 depends on sub1
                    }));

                expect(() => a(false)).toThrowError(/circular/);
            });
        });

        it("runs any changes in outer clocks when created at top level", function () {
            S.root(() => {
                var outer = S.data(1);

                S.subclock(() => {
                    outer(2);
                });

                expect(outer()).toBe(2);
                outer(3);
            });
        });

        it("runs any changes in sibling clocks when created at top level", function () {
            S.root(() => {
                var outer = S.subclock(() => S.data(1));

                S.subclock(() => {
                    outer(2);
                });

                expect(outer()).toBe(2);
                outer(3);
                expect(outer()).toBe(3);
            });
        });

        it("handles whiteboard case", function () {
            S.root(function () {
                var t = "",
                    d = S.data(1),
                    p1 = S.subclock()(function () {
                        var c1 = S(() => {
                                t += 'p1c1,';
                                return d() + (d() > 1 ? c2() : 0);
                            });
                        return { c1 };
                    }),
                    p2 = S.subclock()(function () {
                        var d1 = S.data(1),
                            c1 = S(() => {
                                t += 'p2c1,';
                                return d1(d());
                            });
                        return { d1, c1 };
                    }),
                    p3 = S.subclock()(function () {
                        var d1 = S.data(1),
                            c1 = S(() => {
                                t += 'p3c1,';
                                d1(p2.d1());
                            });
                        return { d1, c1 };
                    }),
                    c1 = S(() => {
                        t += 'c1,';
                        return p3.d1();
                    }),
                    c2 = S(() => {
                        t += 'c2,';
                        return c1(); 
                    });
                
                expect(p1.c1()).toBe(1);
                t = '';
                d(2);
                expect(p1.c1()).toBe(4);
                expect(t).toBe('p1c1,p2c1,p3c1,c2,c1,');
                t = '';
                d(1);
                expect(p1.c1()).toBe(1);
                expect(t).toBe('p2c1,p3c1,p1c1,c1,c2,');
                t = '';
                d(3);
                expect(p1.c1()).toBe(6);
                expect(t).toBe('p1c1,p2c1,p3c1,c2,c1,');
                t = '';
                d(2);
                expect(p1.c1()).toBe(4);
                expect(t).toBe('p2c1,p3c1,p1c1,c2,c1,');
                t = '';
                d(2);
                expect(p1.c1()).toBe(4);
                expect(t).toBe('p2c1,p3c1,p1c1,c2,c1,');
                t = '';
                d(5);
                expect(p1.c1()).toBe(10);
                expect(t).toBe('p2c1,p3c1,p1c1,c2,c1,');
            });
        });

        it("handles irisjay test case", function () {
            S.root(() => {
                var A = S.data(0),
                    log = S.data();

                S.subclock(() => {
                    S(() => log(A() + ' logged'));
                })

                var logs = [];
                S(() => logs.push(log()));
                
                expect(logs).toEqual(["0 logged"]);

                A(1);
                expect(logs).toEqual(["0 logged", "1 logged"]);
                A(8);
                expect(logs).toEqual(["0 logged", "1 logged", "8 logged"]);
            });
        });
    });
}