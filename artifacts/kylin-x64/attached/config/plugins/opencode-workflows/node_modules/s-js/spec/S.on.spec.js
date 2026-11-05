/* globals jasmine */
describe("S.on(...)", function () {
    it("registers a dependency", function () {
        S.root(function () {
            var d = S.data(1),
                spy = jasmine.createSpy(),
                f = S.on(d, function () { spy(); });

            expect(spy.calls.count()).toBe(1);

            d(2);

            expect(spy.calls.count()).toBe(2);
        });
    });

    it("prohibits dynamic dependencies", function () {
        S.root(function () {
            var d = S.data(1),
                spy = jasmine.createSpy("spy"),
                s = S.on(function () {}, function () { spy(); return d(); });

            expect(spy.calls.count()).toBe(1);

            d(2);

            expect(spy.calls.count()).toBe(1);
        });
    });

    it("allows multiple dependencies", function () {
        S.root(function () {
            var a = S.data(1),
                b = S.data(2),
                c = S.data(3),
                spy = jasmine.createSpy(),
                f = S.on(function () { a(); b(); c(); }, function () { spy(); });

            expect(spy.calls.count()).toBe(1);

            a(4);
            b(5);
            c(6);

            expect(spy.calls.count()).toBe(4);
        });
    });
    
    it("allows an array of dependencies", function () {
        S.root(function () {
            var a = S.data(1),
                b = S.data(2),
                c = S.data(3),
                spy = jasmine.createSpy(),
                f = S.on([a, b, c], function () { spy(); });

            expect(spy.calls.count()).toBe(1);

            a(4);
            b(5);
            c(6);

            expect(spy.calls.count()).toBe(4);
        });
    });
    
    it("modifies its accumulator when reducing", function () {
        S.root(function () {
            var a = S.data(1),
                c = S.on(a, function (sum) { return sum + a(); }, 0);
                
            expect(c()).toBe(1);
            
            a(2);
            
            expect(c()).toBe(3);
            
            a(3);
            a(4);
            
            expect(c()).toBe(10);
        });
    });
    
    it("suppresses initial run when onchanges is true", function () {
        S.root(function () {
            var a = S.data(1),
                c = S.on(a, function () { return a() * 2; }, 0, true);
                
            expect(c()).toBe(0);
            
            a(2);
            
            expect(c()).toBe(4);
        });
    })
});
