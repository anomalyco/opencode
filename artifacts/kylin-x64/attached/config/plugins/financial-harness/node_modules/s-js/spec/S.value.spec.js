describe("S.value", function () {
    it("takes and returns an initial value", function () {
        expect(S.value(1)()).toBe(1);
    });

    it("can be set by passing in a new value", function () {
        var d = S.value(1);
        d(2);
        expect(d()).toBe(2);
    });

    it("returns value being set", function () {
        var d = S.value(1);
        expect(d(2)).toBe(2);
    });

    it("does not propagate if set to equal value", function () {
        S.root(function () {
            var d = S.value(1),
                e = 0,
                f = S(function () { d(); return ++e; });

            expect(f()).toBe(1);
            d(1);
            expect(f()).toBe(1);
        });
    });

    it("propagate if set to unequal value", function () {
        S.root(function () {
            var d = S.value(1),
                e = 0,
                f = S(function () { d(); return ++e; });

            expect(f()).toBe(1);
            d(1);
            expect(f()).toBe(1);
            d(2);
            expect(f()).toBe(2);
        });
    });

    it("can take an equality predicate", function () {
        S.root(function () {
            var d = S.value([1], function (a, b) { return a[0] === b[0]; }),
                e = 0,
                f = S(function () { d(); return ++e; });

            expect(f()).toBe(1);
            d([1]);
            expect(f()).toBe(1);
            d([2]);
            expect(f()).toBe(2);
        });
    });
});
