describe("S.freeze", function () {
	it("batches changes until end", function () {
		var d = S.data(1);
			
		S.freeze(function () {
			d(2);
			expect(d()).toBe(1);
		});
		
		expect(d()).toBe(2);
	});
	
	it("halts propagation within its scope", function () {
        S.root(function () {
			var d = S.data(1),
				f = S(function() { return d(); });
				
			S.freeze(function () {
				d(2);
				expect(f()).toBe(1);
			});
			
			expect(f()).toBe(2);
		});
	});
});