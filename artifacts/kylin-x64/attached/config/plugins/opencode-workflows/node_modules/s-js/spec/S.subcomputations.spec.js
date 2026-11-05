describe("S() with subcomputations", function () {

    it("does not register a dependency on the subcomputation", function () {
        S.root(function () {
            var d = S.data(1),
                spy = jasmine.createSpy("spy"),
                gspy = jasmine.createSpy("gspy"),
                f = S(function () { spy(); var g = S(function () { gspy(); return d(); }); })

            spy.calls.reset();
            gspy.calls.reset();

            d(2);

            expect(gspy.calls.count()).toBe(1);
            expect(spy.calls.count()).toBe(0);
        });
    });

    describe("with child", function () {
        var d, e, fspy, f, gspy, g, h;

        function init() {
            d = S.data(1);
            e = S.data(2);
            fspy = jasmine.createSpy("fspy");
            gspy = jasmine.createSpy("gspy");
            f = S(function () {
                fspy();
                d();
                g = S(function () {
                    gspy();
                    return e();
                });
            });
            h = g;
            h();
        }

        it("creates child on initialization", function () {
            S.root(function () {
                init();
                expect(h).toEqual(jasmine.any(Function));
                expect(h()).toBe(2);
            });
        });

        it("does not depend on child's dependencies", function () {
            S.root(function () {
                init();
                e(3);
                expect(fspy.calls.count()).toBe(1);
                expect(gspy.calls.count()).toBe(2);
            });
        });

        it("disposes old child when updated", function () {
            S.root(function () {
                init();
                // re-evalue parent, thereby disposing stale g, which we've stored at h
                d(2);
                e(3);
                // h is now disposed
                expect(h()).toBe(2);
            });
        });

        it("disposes child when it is disposed", function () {
            S.root(function (dispose) {
                init();
                dispose();
                e(3);
                expect(g()).toBe(2);
            });
        });
    });

    describe("which disposes sub that's being updated", function () {
        it("propagates successfully", function () {
            S.root(function () {
                var a = S.data(1),
                    b = S(function () {
                        var c = S(function () { return a(); });
                        a();
                        return { c: c };
                    }),
                    d = S(function () {
                        return b().c();
                    });
                
                expect(d()).toBe(1);
                a(2);
                expect(d()).toBe(2);
                a(3);
                expect(d()).toBe(3);
            });
        });
    });
    
    describe("which disposes a sub with a dependee with a sub", function () {
        it("propagates successfully", function () {
            S.root(function () {
                var a = S.data(1),
                    c,
                    b = S(function () {
                        c = S(function () {
                            return a();
                        });
                        a();
                        return { c : c };
                    }),
                    d = S(function () {
                        c();
                        var e = S(function () {
                            return a();
                        });
                        return { e : e };
                    });
                    
                expect(d().e()).toBe(1);
                a(2);
                expect(d().e()).toBe(2);
                a(3);
                expect(d().e()).toBe(3);
            });
        });
    });
});
