describe("S.data", function () {
    it("takes and returns an initial value", function () {
        expect(S.data(1)()).toBe(1);
    });

    it("can be set by passing in a new value", function () {
        var d = S.data(1);
        d(2);
        expect(d()).toBe(2);
    });

    it("returns value being set", function () {
        var d = S.data(1);
        expect(d(2)).toBe(2);
    });

    it("does not throw if set to the same value twice in a freeze", function () {
        var d = S.data(1);
        S.freeze(() => {
            d(2);
            d(2);
        });
        expect(d()).toBe(2);
    });

    it("throws if set to two different values in a freeze", function () {
        var d = S.data(1);
        S.freeze(() => {
            d(2);
            expect(() => d(3)).toThrowError(/conflict/);
        });
    });

    it("does not throw if set to the same value twice in a computation", function () {
        S.root(() => {
            var d = S.data(1);
            S(() => {
                d(2);
                d(2);
            });
            expect(d()).toBe(2);
        });
    });

    it("throws if set to two different values in a computation", function () {
        S.root(() => {
            var d = S.data(1);
            S(() => {
                d(2);
                expect(() => d(3)).toThrowError(/conflict/);
            });
        });
    });
});
