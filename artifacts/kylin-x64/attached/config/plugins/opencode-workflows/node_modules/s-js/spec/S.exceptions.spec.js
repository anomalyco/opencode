describe("exceptions within S computations", function () {
    it("halt updating", function () {
        S.root(function () {
            var a = S.data(false),
                b = S.data(1),
                c = S(() => { if (a()) throw new Error("xxx"); }),
                d = S(() => b());
            
            expect(() => S.freeze(() => {
                a(true);
                b(2);
            })).toThrowError(/xxx/);

            expect(b()).toBe(2);
            expect(d()).toBe(1);
        });
    });

    it("do not leave stale scheduled updates", function () {
        S.root(function () {
            var a = S.data(false),
                b = S.data(1),
                c = S(() => { if (a()) throw new Error("xxx"); }),
                d = S(() => b());
            
            expect(() => S.freeze(() => {
                a(true);
                b(2);
            })).toThrowError(/xxx/);

            expect(d()).toBe(1);

            // updating a() should not trigger previously scheduled updated of b(), since htat propagation excepted
            a(false);

            expect(d()).toBe(1);
        });
    });

    it("leave non-excepted parts of dependency tree intact", function () {
        S.root(function () {
            var a = S.data(false),
                b = S.data(1),
                c = S(() => { if (a()) throw new Error("xxx"); }),
                d = S(() => b());
            
            expect(() => S.freeze(() => {
                a(true);
                b(2);
            })).toThrowError(/xxx/);

            expect(b()).toBe(2);
            expect(d()).toBe(1);

            b(3);

            expect(b()).toBe(3);
            expect(d()).toBe(3);
        });
    });
});