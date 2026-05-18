/* globals describe, it, expect */
describe("S.sample(...)", function () {
    it("avoids a depdendency", function () {
        S.root(function () {
            var a = S.data(1),
                b = S.data(2),
                c = S.data(3),
                d = 0,
                e = S(function () { d++; a(); S.sample(b); c(); });
                
            expect(d).toBe(1);
            
            b(4);
            
            expect(d).toBe(1);
            
            a(5);
            c(6);
            
            expect(d).toBe(3);
        });
    })
})