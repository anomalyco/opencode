/* globals S, describe, it, expect */

describe("S.root()", function () {
    it("allows subcomputations to escape their parents", function () {
        S.root(function () {
            var outerTrigger = S.data(null),
                innerTrigger = S.data(null),
                outer,
                innerRuns = 0;

            outer = S(function () {
                // register dependency to outer trigger
                outerTrigger();
                // inner computation
                S.root(function () {
                    S(function () {
                        // register dependency on inner trigger
                        innerTrigger();
                        // count total runs
                        innerRuns++;
                    });
                });
            });

            // at start, we have one inner computation, that's run once
            expect(innerRuns).toBe(1);

            // trigger the outer computation, making more inners
            outerTrigger(null);
            outerTrigger(null);

            expect(innerRuns).toBe(3);

            // now trigger inner signal: three orphaned computations should equal three runs
            innerRuns = 0;
            innerTrigger(null);

            expect(innerRuns).toBe(3);
        });
    });

    //it("is necessary to create a toplevel computation", function () {
    //    expect(() => {
    //        S(() => 1)
    //    }).toThrowError(/root/);
    //});

    it("does not freeze updates when used at top level", function () {
        S.root(() => {
            var s = S.data(1),
                c = S(() => s());
            
            expect(c()).toBe(1);

            s(2);

            expect(c()).toBe(2);

            s(3);

            expect(c()).toBe(3);
        });
    });

    it("persists through entire scope when used at top level", () => {
        S.root(() => {
            var s = S.data(1),
                c1 = S(() => s());
            
            s(2);

            var c2 = S(() => s());

            s(3);

            expect(c2()).toBe(3);
        });
    });
});
