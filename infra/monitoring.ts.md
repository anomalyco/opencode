# External tests for monitoring.ts

**Arquivo:** `infra/monitoring.ts`

## Checklist

- [ ] ./secret
- [ ] ./stage

## ./secret

**Consultas usadas no Horsebox:** `HoneycombWebhookSecret.result`, `result`, `./secret result`, `secret result`, `HoneycombWebhookSecret`, `./secret HoneycombWebhookSecret`, `secret HoneycombWebhookSecret`, `SECRET`, `./secret SECRET`, `secret SECRET`

**Arquivos de teste encontrados:** 21

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/utility.js

#### template

```ts
test('template', function(assert) {
    var basicTemplate = _.template("<%= thing %> is gettin' on my noives!");
    var result = basicTemplate({thing: 'This'});
    assert.equal(result, "This is gettin' on my noives!", 'can do basic attribute interpolation');

    var sansSemicolonTemplate = _.template('A <% this %> B');
    assert.equal(sansSemicolonTemplate(), 'A  B');

    var backslashTemplate = _.template('<%= thing %> is \\ridanculous');
    assert.equal(backslashTemplate({thing: 'This'}), 'This is \\ridanculous');

    var escapeTemplate = _.template('<%= a ? "checked=\\"checked\\"" : "" %>');
    assert.equal(escapeTemplate({a: true}), 'checked="checked"', 'can handle slash escapes in interpolations.');

    var fancyTemplate = _.template('<ul><% ' +
    '  for (var key in people) { ' +
    '%><li><%= people[key] %></li><% } %></ul>');
    result = fancyTemplate({people: {moe: 'Moe', larry: 'Larry', curly: 'Curly'}});
    assert.equal(result, '<ul><li>Moe</li><li>Larry</li><li>Curly</li></ul>', 'can run arbitrary javascript in templates');

    var escapedCharsInJavascriptTemplate = _.template('<ul><% _.each(numbers.split("\\n"), function(item) { %><li><%= item %></li><% }) %></ul>');
    result = escapedCharsInJavascriptTemplate({numbers: 'one\ntwo\nthree\nfour'});
    assert.equal(result, '<ul><li>one</li><li>two</li><li>three</li><li>four</li></ul>', 'Can use escaped characters (e.g. \\n) in JavaScript');

    var namespaceCollisionTemplate = _.template('<%= pageCount %> <%= thumbnails[pageCount] %> <% _.each(thumbnails, function(p) { %><div class="thumbnail" rel="<%= p %>"></div><% }); %>');
    result = namespaceCollisionTemplate({
      pageCount: 3,
      thumbnails: {
        1: 'p1-thumbnail.gif',
        2: 'p2-thumbnail.gif',
        3: 'p3-thumbnail.gif'
      }
    });
    assert.equal(result, '3 p3-thumbnail.gif <div class="thumbnail" rel="p1-thumbnail.gif"></div><div class="thumbnail" rel="p2-thumbnail.gif"></div><div class="thumbnail" rel="p3-thumbnail.gif"></div>');

    var noInterpolateTemplate = _.template('<div><p>Just some text. Hey, I know this is silly but it aids consistency.</p></div>');
    result = noInterpolateTemplate();
    assert.equal(result, '<div><p>Just some text. Hey, I know this is silly but it aids consistency.</p></div>');

    var quoteTemplate = _.template("It's its, not it's");
    assert.equal(quoteTemplate({}), "It's its, not it's");

    var quoteInStatementAndBody = _.template('<% ' +
    "  if(foo == 'bar'){ " +
    "%>Statement quotes and 'quotes'.<% } %>");
    assert.equal(quoteInStatementAndBody({foo: 'bar'}), "Statement quotes and 'quotes'.");

    var withNewlinesAndTabs = _.template('This\n\t\tis: <%= x %>.\n\tok.\nend.');
    assert.equal(withNewlinesAndTabs({x: 'that'}), 'This\n\t\tis: that.\n\tok.\nend.');

    var template = _.template('<i><%- value %></i>');
    result = template({value: '<script>'});
    assert.equal(result, '<i>&lt;script&gt;</i>');

    var stooge = {
      name: 'Moe',
      template: _.template("I'm <%= this.name %>")
    };
    assert.equal(stooge.template(), "I'm Moe");

    template = _.template('\n ' +
    '  <%\n ' +
    '  // a comment\n ' +
    '  if (data) { data += 12345; }; %>\n ' +
    '  <li><%= data %></li>\n '
    );
    assert.equal(template({data: 12345}).replace(/\s/g, ''), '<li>24690</li>');

    _.templateSettings = {
      evaluate: /\{\{([\s\S]+?)\}\}/g,
      interpolate: /\{\{=([\s\S]+?)\}\}/g
    };

    var custom = _.template('<ul>{{ for (var key in people) { }}<li>{{= people[key] }}</li>{{ } }}</ul>');
    result = custom({people: {moe: 'Moe', larry: 'Larry', curly: 'Curly'}});
    assert.equal(result, '<ul><li>Moe</li><li>Larry</li><li>Curly</li></ul>', 'can run arbitrary javascript in templates');

    var customQuote = _.template("It's its, not it's");
    assert.equal(customQuote({}), "It's its, not it's");

    quoteInStatementAndBody = _.template("{{ if(foo == 'bar'){ }}Statement quotes and 'quotes'.{{ } }}");
    assert.equal(quoteInStatementAndBody({foo: 'bar'}), "Statement quotes and 'quotes'.");

    _.templateSettings = {
      evaluate: /<\?([\s\S]+?)\?>/g,
      interpolate: /<\?=([\s\S]+?)\?>/g
    };

    var customWithSpecialChars = _.template('<ul><? for (var key in people) { ?><li><?= people[key] ?></li><? } ?></ul>');
    result = customWithSpecialChars({people: {moe: 'Moe', larry: 'Larry', curly: 'Curly'}});
    assert.equal(result, '<ul><li>Moe</li><li>Larry</li><li>Curly</li></ul>', 'can run arbitrary javascript in templates');

    var customWithSpecialCharsQuote = _.template("It's its, not it's");
    assert.equal(customWithSpecialCharsQuote({}), "It's its, not it's");

    quoteInStatementAndBody = _.template("<? if(foo == 'bar'){ ?>Statement quotes and 'quotes'.<? } ?>");
    assert.equal(quoteInStatementAndBody({foo: 'bar'}), "Statement quotes and 'quotes'.");

    _.templateSettings = {
      interpolate: /\{\{(.+?)\}\}/g
    };

    var mustache = _.template('Hello {{planet}}!');
    assert.equal(mustache({planet: 'World'}), 'Hello World!', 'can mimic mustache.js');

    var templateWithNull = _.template('a null undefined {{planet}}');
    assert.equal(templateWithNull({planet: 'world'}), 'a null undefined world', 'can handle missing escape and evaluate settings');
  }
```

#### result calls functions and returns primitives

```ts
test('result calls functions and returns primitives', function(assert) {
    var obj = {w: '', x: 'x', y: function(){ return this.x; }};
    assert.strictEqual(_.result(obj, 'w'), '');
    assert.strictEqual(_.result(obj, 'x'), 'x');
    assert.strictEqual(_.result(obj, 'y'), 'x');
    assert.strictEqual(_.result(obj, 'z'), void 0);
    assert.strictEqual(_.result(null, 'x'), void 0);
  }
```

#### result returns a default value if object is null or undefined

```ts
test('result returns a default value if object is null or undefined', function(assert) {
    assert.strictEqual(_.result(null, 'b', 'default'), 'default');
    assert.strictEqual(_.result(void 0, 'c', 'default'), 'default');
    assert.strictEqual(_.result(''.match('missing'), 1, 'default'), 'default');
  }
```

#### result returns a default value if property of object is missing

```ts
test('result returns a default value if property of object is missing', function(assert) {
    assert.strictEqual(_.result({d: null}, 'd', 'default'), null);
    assert.strictEqual(_.result({e: false}, 'e', 'default'), false);
  }
```

#### result only returns the default value if the object does not have the property or is undefined

```ts
test('result only returns the default value if the object does not have the property or is undefined', function(assert) {
    assert.strictEqual(_.result({}, 'b', 'default'), 'default');
    assert.strictEqual(_.result({d: void 0}, 'd', 'default'), 'default');
  }
```

#### result does not return the default if the property of an object is found in the prototype

```ts
test('result does not return the default if the property of an object is found in the prototype', function(assert) {
    var Foo = function(){};
    Foo.prototype.bar = 1;
    assert.strictEqual(_.result(new Foo, 'bar', 2), 1);
  }
```

#### result does use the fallback when the result of invoking the property is undefined

```ts
test('result does use the fallback when the result of invoking the property is undefined', function(assert) {
    var obj = {a: function() {}};
    assert.strictEqual(_.result(obj, 'a', 'failed'), void 0);
  }
```

#### result fallback can use a function

```ts
test('result fallback can use a function', function(assert) {
    var obj = {a: [1, 2, 3]};
    assert.strictEqual(_.result(obj, 'b', _.constant(5)), 5);
    assert.strictEqual(_.result(obj, 'b', function() {
      return this.a;
    }), obj.a, 'called with context');
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/arrays.js

#### first

```ts
test('first', function(assert) {
    assert.equal(_.first([1, 2, 3]), 1, 'can pull out the first element of an array');
    assert.equal(_([1, 2, 3]).first(), 1, 'can perform OO-style "first()"');
    assert.deepEqual(_.first([1, 2, 3], 0), [], 'returns an empty array when n <= 0 (0 case)');
    assert.deepEqual(_.first([1, 2, 3], -1), [], 'returns an empty array when n <= 0 (negative case)');
    assert.deepEqual(_.first([1, 2, 3], 2), [1, 2], 'can fetch the first n elements');
    assert.deepEqual(_.first([1, 2, 3], 5), [1, 2, 3], 'returns the whole array if n > length');
    var result = (function(){ return _.first(arguments); }(4, 3, 2, 1));
    assert.equal(result, 4, 'works on an arguments object');
    result = _.map([[1, 2, 3], [1, 2, 3]], _.first);
    assert.deepEqual(result, [1, 1], 'works well with _.map');
    assert.equal(_.first(null), void 0, 'returns undefined when called on null');

    Array.prototype[0] = 'boo';
    assert.equal(_.first([]), void 0, 'return undefined when called on a empty array');
    delete Array.prototype[0];
  }
```

#### rest

```ts
test('rest', function(assert) {
    var numbers = [1, 2, 3, 4];
    assert.deepEqual(_.rest(numbers), [2, 3, 4], 'fetches all but the first element');
    assert.deepEqual(_.rest(numbers, 0), [1, 2, 3, 4], 'returns the whole array when index is 0');
    assert.deepEqual(_.rest(numbers, 2), [3, 4], 'returns elements starting at the given index');
    var result = (function(){ return _(arguments).rest(); }(1, 2, 3, 4));
    assert.deepEqual(result, [2, 3, 4], 'works on an arguments object');
    result = _.map([[1, 2, 3], [1, 2, 3]], _.rest);
    assert.deepEqual(_.flatten(result), [2, 3, 2, 3], 'works well with _.map');
  }
```

#### initial

```ts
test('initial', function(assert) {
    assert.deepEqual(_.initial([1, 2, 3, 4, 5]), [1, 2, 3, 4], 'returns all but the last element');
    assert.deepEqual(_.initial([1, 2, 3, 4], 2), [1, 2], 'returns all but the last n elements');
    assert.deepEqual(_.initial([1, 2, 3, 4], 6), [], 'returns an empty array when n > length');
    var result = (function(){ return _(arguments).initial(); }(1, 2, 3, 4));
    assert.deepEqual(result, [1, 2, 3], 'works on an arguments object');
    result = _.map([[1, 2, 3], [1, 2, 3]], _.initial);
    assert.deepEqual(_.flatten(result), [1, 2, 1, 2], 'works well with _.map');
  }
```

#### last

```ts
test('last', function(assert) {
    assert.equal(_.last([1, 2, 3]), 3, 'can pull out the last element of an array');
    assert.equal(_([1, 2, 3]).last(), 3, 'can perform OO-style "last()"');
    assert.deepEqual(_.last([1, 2, 3], 0), [], 'returns an empty array when n <= 0 (0 case)');
    assert.deepEqual(_.last([1, 2, 3], -1), [], 'returns an empty array when n <= 0 (negative case)');
    assert.deepEqual(_.last([1, 2, 3], 2), [2, 3], 'can fetch the last n elements');
    assert.deepEqual(_.last([1, 2, 3], 5), [1, 2, 3], 'returns the whole array if n > length');
    var result = (function(){ return _(arguments).last(); }(1, 2, 3, 4));
    assert.equal(result, 4, 'works on an arguments object');
    result = _.map([[1, 2, 3], [1, 2, 3]], _.last);
    assert.deepEqual(result, [3, 3], 'works well with _.map');
    assert.equal(_.last(null), void 0, 'returns undefined when called on null');

    var arr = [];
    arr[-1] = 'boo';
    assert.equal(_.last(arr), void 0, 'return undefined when called on a empty array');
  }
```

#### compact

```ts
test('compact', function(assert) {
    assert.deepEqual(_.compact([1, false, null, 0, '', void 0, NaN, 2]), [1, 2], 'removes all falsy values');
    var result = (function(){ return _.compact(arguments); }(0, 1, false, 2, false, 3));
    assert.deepEqual(result, [1, 2, 3], 'works on an arguments object');
    result = _.map([[1, false, false], [false, false, 3]], _.compact);
    assert.deepEqual(result, [[1], [3]], 'works well with _.map');
  }
```

#### flatten

```ts
test('flatten', function(assert) {
    assert.deepEqual(_.flatten(null), [], 'supports null');
    assert.deepEqual(_.flatten(void 0), [], 'supports undefined');

    assert.deepEqual(_.flatten([[], [[]], []]), [], 'supports empty arrays');
    assert.deepEqual(_.flatten([[], [[]], []], true), [[]], 'can shallowly flatten empty arrays');

    var list = [1, [2], [3, [[[4]]]]];
    assert.deepEqual(_.flatten(list), [1, 2, 3, 4], 'can flatten nested arrays');
    assert.deepEqual(_.flatten(list, true), [1, 2, 3, [[[4]]]], 'can shallowly flatten nested arrays');
    var result = (function(){ return _.flatten(arguments); }(1, [2], [3, [[[4]]]]));
    assert.deepEqual(result, [1, 2, 3, 4], 'works on an arguments object');
    list = [[1], [2], [3], [[4]]];
    assert.deepEqual(_.flatten(list, true), [1, 2, 3, [4]], 'can shallowly flatten arrays containing only other arrays');

    assert.equal(_.flatten([_.range(10), _.range(10), 5, 1, 3], true).length, 23, 'can flatten medium length arrays');
    assert.equal(_.flatten([_.range(10), _.range(10), 5, 1, 3]).length, 23, 'can shallowly flatten medium length arrays');
    assert.equal(_.flatten([new Array(1000000), _.range(56000), 5, 1, 3]).length, 1056003, 'can handle massive arrays');
    assert.equal(_.flatten([new Array(1000000), _.range(56000), 5, 1, 3], true).length, 1056003, 'can handle massive arrays in shallow mode');

    var x = _.range(100000);
    for (var i = 0; i < 1000; i++) x = [x];
    assert.deepEqual(_.flatten(x), _.range(100000), 'can handle very deep arrays');
    assert.deepEqual(_.flatten(x, true), x[0], 'can handle very deep arrays in shallow mode');
  }
```

#### without

```ts
test('without', function(assert) {
    var list = [1, 2, 1, 0, 3, 1, 4];
    assert.deepEqual(_.without(list, 0, 1), [2, 3, 4], 'removes all instances of the given values');
    var result = (function(){ return _.without(arguments, 0, 1); }(1, 2, 1, 0, 3, 1, 4));
    assert.deepEqual(result, [2, 3, 4], 'works on an arguments object');

    list = [{one: 1}, {two: 2}];
    assert.deepEqual(_.without(list, {one: 1}), list, 'compares objects by reference (value case)');
    assert.deepEqual(_.without(list, list[0]), [{two: 2}], 'compares objects by reference (reference case)');
  }
```

#### sortedIndex

```ts
test('sortedIndex', function(assert) {
    var numbers = [10, 20, 30, 40, 50];
    var indexFor35 = _.sortedIndex(numbers, 35);
    assert.equal(indexFor35, 3, 'finds the index at which a value should be inserted to retain order');
    var indexFor30 = _.sortedIndex(numbers, 30);
    assert.equal(indexFor30, 2, 'finds the smallest index at which a value could be inserted to retain order');

    var objects = [{x: 10}, {x: 20}, {x: 30}, {x: 40}];
    var iterator = function(obj){ return obj.x; };
    assert.strictEqual(_.sortedIndex(objects, {x: 25}, iterator), 2, 'uses the result of `iterator` for order comparisons');
    assert.strictEqual(_.sortedIndex(objects, {x: 35}, 'x'), 3, 'when `iterator` is a string, uses that key for order comparisons');

    var context = {1: 2, 2: 3, 3: 4};
    iterator = function(obj){ return this[obj]; };
    assert.strictEqual(_.sortedIndex([1, 3], 2, iterator, context), 1, 'can execute its iterator in the given context');

    var values = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535, 131071, 262143, 524287,
        1048575, 2097151, 4194303, 8388607, 16777215, 33554431, 67108863, 134217727, 268435455, 536870911, 1073741823, 2147483647];
    var largeArray = Array(Math.pow(2, 32) - 1);
    var length = values.length;
    // Sparsely populate `array`
    while (length--) {
      largeArray[values[length]] = values[length];
    }
    assert.equal(_.sortedIndex(largeArray, 2147483648), 2147483648, 'works with large indexes');
  }
```

#### uniq

```ts
test('uniq', function(assert) {
    var list = [1, 2, 1, 3, 1, 4];
    assert.deepEqual(_.uniq(list), [1, 2, 3, 4], 'can find the unique values of an unsorted array');
    list = [1, 1, 1, 2, 2, 3];
    assert.deepEqual(_.uniq(list, true), [1, 2, 3], 'can find the unique values of a sorted array faster');

    list = [{name: 'Moe'}, {name: 'Curly'}, {name: 'Larry'}, {name: 'Curly'}];
    var expected = [{name: 'Moe'}, {name: 'Curly'}, {name: 'Larry'}];
    var iterator = function(stooge) { return stooge.name; };
    assert.deepEqual(_.uniq(list, false, iterator), expected, 'uses the result of `iterator` for uniqueness comparisons (unsorted case)');
    assert.deepEqual(_.uniq(list, iterator), expected, '`sorted` argument defaults to false when omitted');
    assert.deepEqual(_.uniq(list, 'name'), expected, 'when `iterator` is a string, uses that key for comparisons (unsorted case)');

    list = [{score: 8}, {score: 10}, {score: 10}];
    expected = [{score: 8}, {score: 10}];
    iterator = function(item) { return item.score; };
    assert.deepEqual(_.uniq(list, true, iterator), expected, 'uses the result of `iterator` for uniqueness comparisons (sorted case)');
    assert.deepEqual(_.uniq(list, true, 'score'), expected, 'when `iterator` is a string, uses that key for comparisons (sorted case)');

    assert.deepEqual(_.uniq([{0: 1}, {0: 1}, {0: 1}, {0: 2}], 0), [{0: 1}, {0: 2}], 'can use falsey pluck like iterator');

    var result = (function(){ return _.uniq(arguments); }(1, 2, 1, 3, 1, 4));
    assert.deepEqual(result, [1, 2, 3, 4], 'works on an arguments object');

    var a = {}, b = {}, c = {};
    assert.deepEqual(_.uniq([a, b, a, b, c]), [a, b, c], 'works on values that can be tested for equivalency but not ordered');

    assert.deepEqual(_.uniq(null), [], 'returns an empty array when `array` is not iterable');

    var context = {};
    list = [3];
    _.uniq(list, function(value, index, array) {
      assert.strictEqual(this, context, 'executes its iterator in the given context');
      assert.strictEqual(value, 3, 'passes its iterator the value');
      assert.strictEqual(index, 0, 'passes its iterator the index');
      assert.strictEqual(array, list, 'passes its iterator the entire array');
    }, context);

  }
```

#### intersection

```ts
test('intersection', function(assert) {
    var stooges = ['moe', 'curly', 'larry'], leaders = ['moe', 'groucho'];
    assert.deepEqual(_.intersection(stooges, leaders), ['moe'], 'can find the set intersection of two arrays');
    assert.deepEqual(_(stooges).intersection(leaders), ['moe'], 'can perform an OO-style intersection');
    var result = (function(){ return _.intersection(arguments, leaders); }('moe', 'curly', 'larry'));
    assert.deepEqual(result, ['moe'], 'works on an arguments object');
    var theSixStooges = ['moe', 'moe', 'curly', 'curly', 'larry', 'larry'];
    assert.deepEqual(_.intersection(theSixStooges, leaders), ['moe'], 'returns a duplicate-free array');
    result = _.intersection([2, 4, 3, 1], [1, 2, 3]);
    assert.deepEqual(result, [2, 3, 1], 'preserves the order of the first array');
    result = _.intersection(null, [1, 2, 3]);
    assert.deepEqual(result, [], 'returns an empty array when passed null as the first argument');
    result = _.intersection([1, 2, 3], null);
    assert.deepEqual(result, [], 'returns an empty array when passed null as an argument beyond the first');
  }
```

#### union

```ts
test('union', function(assert) {
    var result = _.union([1, 2, 3], [2, 30, 1], [1, 40]);
    assert.deepEqual(result, [1, 2, 3, 30, 40], 'can find the union of a list of arrays');

    result = _([1, 2, 3]).union([2, 30, 1], [1, 40]);
    assert.deepEqual(result, [1, 2, 3, 30, 40], 'can perform an OO-style union');

    result = _.union([1, 2, 3], [2, 30, 1], [1, 40, [1]]);
    assert.deepEqual(result, [1, 2, 3, 30, 40, [1]], 'can find the union of a list of nested arrays');

    result = _.union([10, 20], [1, 30, 10], [0, 40]);
    assert.deepEqual(result, [10, 20, 1, 30, 0, 40], 'orders values by their first encounter');

    result = (function(){ return _.union(arguments, [2, 30, 1], [1, 40]); }(1, 2, 3));
    assert.deepEqual(result, [1, 2, 3, 30, 40], 'works on an arguments object');

    assert.deepEqual(_.union([1, 2, 3], 4), [1, 2, 3], 'restricts the union to arrays only');
  }
```

#### difference

```ts
test('difference', function(assert) {
    var result = _.difference([1, 2, 3], [2, 30, 40]);
    assert.deepEqual(result, [1, 3], 'can find the difference of two arrays');

    result = _([1, 2, 3]).difference([2, 30, 40]);
    assert.deepEqual(result, [1, 3], 'can perform an OO-style difference');

    result = _.difference([1, 2, 3, 4], [2, 30, 40], [1, 11, 111]);
    assert.deepEqual(result, [3, 4], 'can find the difference of three arrays');

    result = _.difference([8, 9, 3, 1], [3, 8]);
    assert.deepEqual(result, [9, 1], 'preserves the order of the first array');

    result = (function(){ return _.difference(arguments, [2, 30, 40]); }(1, 2, 3));
    assert.deepEqual(result, [1, 3], 'works on an arguments object');

    result = _.difference([1, 2, 3], 1);
    assert.deepEqual(result, [1, 2, 3], 'restrict the difference to arrays only');
  }
```

#### object

```ts
test('object', function(assert) {
    var result = _.object(['moe', 'larry', 'curly'], [30, 40, 50]);
    var shouldBe = {moe: 30, larry: 40, curly: 50};
    assert.deepEqual(result, shouldBe, 'two arrays zipped together into an object');

    result = _.object([['one', 1], ['two', 2], ['three', 3]]);
    shouldBe = {one: 1, two: 2, three: 3};
    assert.deepEqual(result, shouldBe, 'an array of pairs zipped together into an object');

    var stooges = {moe: 30, larry: 40, curly: 50};
    assert.deepEqual(_.object(_.pairs(stooges)), stooges, 'an object converted to pairs and back to an object');

    assert.deepEqual(_.object(null), {}, 'handles nulls');
  }
```

#### indexOf

```ts
test('indexOf', function(assert) {
    var numbers = [1, 2, 3];
    assert.equal(_.indexOf(numbers, 2), 1, 'can compute indexOf');
    var result = (function(){ return _.indexOf(arguments, 2); }(1, 2, 3));
    assert.equal(result, 1, 'works on an arguments object');

    _.each([null, void 0, [], false], function(val) {
      var msg = 'Handles: ' + (_.isArray(val) ? '[]' : val);
      assert.equal(_.indexOf(val, 2), -1, msg);
      assert.equal(_.indexOf(val, 2, -1), -1, msg);
      assert.equal(_.indexOf(val, 2, -20), -1, msg);
      assert.equal(_.indexOf(val, 2, 15), -1, msg);
    });

    var num = 35;
    numbers = [10, 20, 30, 40, 50];
    var index = _.indexOf(numbers, num, true);
    assert.equal(index, -1, '35 is not in the list');

    numbers = [10, 20, 30, 40, 50]; num = 40;
    index = _.indexOf(numbers, num, true);
    assert.equal(index, 3, '40 is in the list');

    numbers = [1, 40, 40, 40, 40, 40, 40, 40, 50, 60, 70]; num = 40;
    assert.equal(_.indexOf(numbers, num, true), 1, '40 is in the list');
    assert.equal(_.indexOf(numbers, 6, true), -1, '6 isnt in the list');
    assert.equal(_.indexOf([1, 2, 5, 4, 6, 7], 5, true), -1, 'sorted indexOf doesn\'t uses binary search');
    assert.ok(_.every(['1', [], {}, null], function() {
      return _.indexOf(numbers, num, {}) === 1;
    }), 'non-nums as fromIndex make indexOf assume sorted');

    numbers = [1, 2, 3, 1, 2, 3, 1, 2, 3];
    index = _.indexOf(numbers, 2, 5);
    assert.equal(index, 7, 'supports the fromIndex argument');

    index = _.indexOf([,,, 0], void 0);
    assert.equal(index, 0, 'treats sparse arrays as if they were dense');

    var array = [1, 2, 3, 1, 2, 3];
    assert.strictEqual(_.indexOf(array, 1, -3), 3, 'neg `fromIndex` starts at the right index');
    assert.strictEqual(_.indexOf(array, 1, -2), -1, 'neg `fromIndex` starts at the right index');
    assert.strictEqual(_.indexOf(array, 2, -3), 4);
    _.each([-6, -8, -Infinity], function(fromIndex) {
      assert.strictEqual(_.indexOf(array, 1, fromIndex), 0);
    });
    assert.strictEqual(_.indexOf([1, 2, 3], 1, true), 0);

    index = _.indexOf([], void 0, true);
    assert.equal(index, -1, 'empty array with truthy `isSorted` returns -1');
  }
```

#### indexOf with NaN

```ts
test('indexOf with NaN', function(assert) {
    assert.strictEqual(_.indexOf([1, 2, NaN, NaN], NaN), 2, 'Expected [1, 2, NaN] to contain NaN');
    assert.strictEqual(_.indexOf([1, 2, Infinity], NaN), -1, 'Expected [1, 2, NaN] to contain NaN');

    assert.strictEqual(_.indexOf([1, 2, NaN, NaN], NaN, 1), 2, 'startIndex does not affect result');
    assert.strictEqual(_.indexOf([1, 2, NaN, NaN], NaN, -2), 2, 'startIndex does not affect result');

    (function() {
      assert.strictEqual(_.indexOf(arguments, NaN), 2, 'Expected arguments [1, 2, NaN] to contain NaN');
    }(1, 2, NaN, NaN));
  }
```

#### lastIndexOf

```ts
test('lastIndexOf', function(assert) {
    var numbers = [1, 0, 1];
    var falsey = [void 0, '', 0, false, NaN, null, void 0];
    assert.equal(_.lastIndexOf(numbers, 1), 2);

    numbers = [1, 0, 1, 0, 0, 1, 0, 0, 0];
    numbers.lastIndexOf = null;
    assert.equal(_.lastIndexOf(numbers, 1), 5, 'can compute lastIndexOf, even without the native function');
    assert.equal(_.lastIndexOf(numbers, 0), 8, 'lastIndexOf the other element');
    var result = (function(){ return _.lastIndexOf(arguments, 1); }(1, 0, 1, 0, 0, 1, 0, 0, 0));
    assert.equal(result, 5, 'works on an arguments object');

    _.each([null, void 0, [], false], function(val) {
      var msg = 'Handles: ' + (_.isArray(val) ? '[]' : val);
      assert.equal(_.lastIndexOf(val, 2), -1, msg);
      assert.equal(_.lastIndexOf(val, 2, -1), -1, msg);
      assert.equal(_.lastIndexOf(val, 2, -20), -1, msg);
      assert.equal(_.lastIndexOf(val, 2, 15), -1, msg);
    });

    numbers = [1, 2, 3, 1, 2, 3, 1, 2, 3];
    var index = _.lastIndexOf(numbers, 2, 2);
    assert.equal(index, 1, 'supports the fromIndex argument');

    var array = [1, 2, 3, 1, 2, 3];

    assert.strictEqual(_.lastIndexOf(array, 1, 0), 0, 'starts at the correct from idx');
    assert.strictEqual(_.lastIndexOf(array, 3), 5, 'should return the index of the last matched value');
    assert.strictEqual(_.lastIndexOf(array, 4), -1, 'should return `-1` for an unmatched value');

    assert.strictEqual(_.lastIndexOf(array, 1, 2), 0, 'should work with a positive `fromIndex`');

    _.each([6, 8, Math.pow(2, 32), Infinity], function(fromIndex) {
      assert.strictEqual(_.lastIndexOf(array, void 0, fromIndex), -1);
      assert.strictEqual(_.lastIndexOf(array, 1, fromIndex), 3);
      assert.strictEqual(_.lastIndexOf(array, '', fromIndex), -1);
    });

    var expected = _.map(falsey, function(value) {
      return typeof value == 'number' ? -1 : 5;
    });

    var actual = _.map(falsey, function(fromIndex) {
      return _.lastIndexOf(array, 3, fromIndex);
    });

    assert.deepEqual(actual, expected, 'should treat falsey `fromIndex` values, except `0` and `NaN`, as `array.length`');
    assert.strictEqual(_.lastIndexOf(array, 3, '1'), 5, 'should treat non-number `fromIndex` values as `array.length`');
    assert.strictEqual(_.lastIndexOf(array, 3, true), 5, 'should treat non-number `fromIndex` values as `array.length`');

    assert.strictEqual(_.lastIndexOf(array, 2, -3), 1, 'should work with a negative `fromIndex`');
    assert.strictEqual(_.lastIndexOf(array, 1, -3), 3, 'neg `fromIndex` starts at the right index');

    assert.deepEqual(_.map([-6, -8, -Infinity], function(fromIndex) {
      return _.lastIndexOf(array, 1, fromIndex);
    }), [0, -1, -1]);
  }
```

#### lastIndexOf with NaN

```ts
test('lastIndexOf with NaN', function(assert) {
    assert.strictEqual(_.lastIndexOf([1, 2, NaN, NaN], NaN), 3, 'Expected [1, 2, NaN] to contain NaN');
    assert.strictEqual(_.lastIndexOf([1, 2, Infinity], NaN), -1, 'Expected [1, 2, NaN] to contain NaN');

    assert.strictEqual(_.lastIndexOf([1, 2, NaN, NaN], NaN, 2), 2, 'fromIndex does not affect result');
    assert.strictEqual(_.lastIndexOf([1, 2, NaN, NaN], NaN, -2), 2, 'fromIndex does not affect result');

    (function() {
      assert.strictEqual(_.lastIndexOf(arguments, NaN), 3, 'Expected arguments [1, 2, NaN] to contain NaN');
    }(1, 2, NaN, NaN));
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/objects.js

#### extend

```ts
test('extend', function(assert) {
    var result;
    assert.equal(_.extend({}, {a: 'b'}).a, 'b', 'can extend an object with the attributes of another');
    assert.equal(_.extend({a: 'x'}, {a: 'b'}).a, 'b', 'properties in source override destination');
    assert.equal(_.extend({x: 'x'}, {a: 'b'}).x, 'x', "properties not in source don't get overriden");
    result = _.extend({x: 'x'}, {a: 'a'}, {b: 'b'});
    assert.deepEqual(result, {x: 'x', a: 'a', b: 'b'}, 'can extend from multiple source objects');
    result = _.extend({x: 'x'}, {a: 'a', x: 2}, {a: 'b'});
    assert.deepEqual(result, {x: 2, a: 'b'}, 'extending from multiple source objects last property trumps');
    result = _.extend({}, {a: void 0, b: null});
    assert.deepEqual(_.keys(result), ['a', 'b'], 'extend copies undefined values');

    var F = function() {};
    F.prototype = {a: 'b'};
    var subObj = new F();
    subObj.c = 'd';
    assert.deepEqual(_.extend({}, subObj), {a: 'b', c: 'd'}, 'extend copies all properties from source');
    _.extend(subObj, {});
    assert.notOk(subObj.hasOwnProperty('a'), "extend does not convert destination object's 'in' properties to 'own' properties");

    try {
      result = {};
      _.extend(result, null, void 0, {a: 1});
    } catch (e) { /* ignored */ }

    assert.equal(result.a, 1, 'should not error on `null` or `undefined` sources');

    assert.strictEqual(_.extend(null, {a: 1}), null, 'extending null results in null');
    assert.strictEqual(_.extend(void 0, {a: 1}), void 0, 'extending undefined results in undefined');
  }
```

#### extendOwn

```ts
test('extendOwn', function(assert) {
    var result;
    assert.equal(_.extendOwn({}, {a: 'b'}).a, 'b', 'can extend an object with the attributes of another');
    assert.equal(_.extendOwn({a: 'x'}, {a: 'b'}).a, 'b', 'properties in source override destination');
    assert.equal(_.extendOwn({x: 'x'}, {a: 'b'}).x, 'x', "properties not in source don't get overriden");
    result = _.extendOwn({x: 'x'}, {a: 'a'}, {b: 'b'});
    assert.deepEqual(result, {x: 'x', a: 'a', b: 'b'}, 'can extend from multiple source objects');
    result = _.extendOwn({x: 'x'}, {a: 'a', x: 2}, {a: 'b'});
    assert.deepEqual(result, {x: 2, a: 'b'}, 'extending from multiple source objects last property trumps');
    assert.deepEqual(_.extendOwn({}, {a: void 0, b: null}), {a: void 0, b: null}, 'copies undefined values');

    var F = function() {};
    F.prototype = {a: 'b'};
    var subObj = new F();
    subObj.c = 'd';
    assert.deepEqual(_.extendOwn({}, subObj), {c: 'd'}, 'copies own properties from source');

    result = {};
    assert.deepEqual(_.extendOwn(result, null, void 0, {a: 1}), {a: 1}, 'should not error on `null` or `undefined` sources');

    _.each(['a', 5, null, false], function(val) {
      assert.strictEqual(_.extendOwn(val, {a: 1}), val, 'extending non-objects results in returning the non-object value');
    });

    assert.strictEqual(_.extendOwn(void 0, {a: 1}), void 0, 'extending undefined results in undefined');

    result = _.extendOwn({a: 1, 0: 2, 1: '5', length: 6}, {0: 1, 1: 2, length: 2});
    assert.deepEqual(result, {a: 1, 0: 1, 1: 2, length: 2}, 'should treat array-like objects like normal objects');
  }
```

#### pick

```ts
test('pick', function(assert) {
    var result;
    result = _.pick({a: 1, b: 2, c: 3}, 'a', 'c');
    assert.deepEqual(result, {a: 1, c: 3}, 'can restrict properties to those named');
    result = _.pick({a: 1, b: 2, c: 3}, ['b', 'c']);
    assert.deepEqual(result, {b: 2, c: 3}, 'can restrict properties to those named in an array');
    result = _.pick({a: 1, b: 2, c: 3}, ['a'], 'b');
    assert.deepEqual(result, {a: 1, b: 2}, 'can restrict properties to those named in mixed args');
    result = _.pick(['a', 'b'], 1);
    assert.deepEqual(result, {1: 'b'}, 'can pick numeric properties');

    _.each([null, void 0], function(val) {
      assert.deepEqual(_.pick(val, 'hasOwnProperty'), {}, 'Called with null/undefined');
      assert.deepEqual(_.pick(val, _.constant(true)), {});
    });
    assert.deepEqual(_.pick(5, 'toString', 'b'), {toString: Number.prototype.toString}, 'can iterate primitives');

    var data = {a: 1, b: 2, c: 3};
    var callback = function(value, key, object) {
      assert.strictEqual(key, {1: 'a', 2: 'b', 3: 'c'}[value]);
      assert.strictEqual(object, data);
      return value !== this.value;
    };
    result = _.pick(data, callback, {value: 2});
    assert.deepEqual(result, {a: 1, c: 3}, 'can accept a predicate and context');

    var Obj = function(){};
    Obj.prototype = {a: 1, b: 2, c: 3};
    var instance = new Obj();
    assert.deepEqual(_.pick(instance, 'a', 'c'), {a: 1, c: 3}, 'include prototype props');

    assert.deepEqual(_.pick(data, function(val, key) {
      return this[key] === 3 && this === instance;
    }, instance), {c: 3}, 'function is given context');

    assert.notOk(_.has(_.pick({}, 'foo'), 'foo'), 'does not set own property if property not in object');
    _.pick(data, function(value, key, obj) {
      assert.equal(obj, data, 'passes same object as third parameter of iteratee');
    });
  }
```

#### omit

```ts
test('omit', function(assert) {
    var result;
    result = _.omit({a: 1, b: 2, c: 3}, 'b');
    assert.deepEqual(result, {a: 1, c: 3}, 'can omit a single named property');
    result = _.omit({a: 1, b: 2, c: 3}, 'a', 'c');
    assert.deepEqual(result, {b: 2}, 'can omit several named properties');
    result = _.omit({a: 1, b: 2, c: 3}, ['b', 'c']);
    assert.deepEqual(result, {a: 1}, 'can omit properties named in an array');
    result = _.omit(['a', 'b'], 0);
    assert.deepEqual(result, {1: 'b'}, 'can omit numeric properties');

    assert.deepEqual(_.omit(null, 'a', 'b'), {}, 'non objects return empty object');
    assert.deepEqual(_.omit(void 0, 'toString'), {}, 'null/undefined return empty object');
    assert.deepEqual(_.omit(5, 'toString', 'b'), {}, 'returns empty object for primitives');

    var data = {a: 1, b: 2, c: 3};
    var callback = function(value, key, object) {
      assert.strictEqual(key, {1: 'a', 2: 'b', 3: 'c'}[value]);
      assert.strictEqual(object, data);
      return value !== this.value;
    };
    result = _.omit(data, callback, {value: 2});
    assert.deepEqual(result, {b: 2}, 'can accept a predicate');

    var Obj = function(){};
    Obj.prototype = {a: 1, b: 2, c: 3};
    var instance = new Obj();
    assert.deepEqual(_.omit(instance, 'b'), {a: 1, c: 3}, 'include prototype props');

    assert.deepEqual(_.omit(data, function(val, key) {
      return this[key] === 3 && this === instance;
    }, instance), {a: 1, b: 2}, 'function is given context');
  }
```

#### matcher

```ts
test('matcher', function(assert) {
    var moe = {name: 'Moe Howard', hair: true};
    var curly = {name: 'Curly Howard', hair: false};
    var stooges = [moe, curly];

    assert.equal(_.matcher({hair: true})(moe), true, 'Returns a boolean');
    assert.equal(_.matcher({hair: true})(curly), false, 'Returns a boolean');

    assert.equal(_.matcher({__x__: void 0})(5), false, 'can match undefined props on primitives');
    assert.equal(_.matcher({__x__: void 0})({__x__: void 0}), true, 'can match undefined props');

    assert.equal(_.matcher({})(null), true, 'Empty spec called with null object returns true');
    assert.equal(_.matcher({a: 1})(null), false, 'Non-empty spec called with null object returns false');

    assert.strictEqual(_.find(stooges, _.matcher({hair: false})), curly, 'returns a predicate that can be used by finding functions.');
    assert.strictEqual(_.find(stooges, _.matcher(moe)), moe, 'can be used to locate an object exists in a collection.');
    assert.deepEqual(_.filter([null, void 0], _.matcher({a: 1})), [], 'Do not throw on null values.');

    assert.deepEqual(_.filter([null, void 0], _.matcher(null)), [null, void 0], 'null matches null');
    assert.deepEqual(_.filter([null, void 0], _.matcher({})), [null, void 0], 'null matches {}');
    assert.deepEqual(_.filter([{b: 1}], _.matcher({a: void 0})), [], 'handles undefined values (1683)');

    _.each([true, 5, NaN, null, void 0], function(item) {
      assert.equal(_.matcher(item)({a: 1}), true, 'treats primitives as empty');
    });

    function Prototest() {}
    Prototest.prototype.x = 1;
    var specObj = new Prototest;
    var protospec = _.matcher(specObj);
    assert.equal(protospec({x: 2}), true, 'spec is restricted to own properties');

    specObj.y = 5;
    protospec = _.matcher(specObj);
    assert.equal(protospec({x: 1, y: 5}), true);
    assert.equal(protospec({x: 1, y: 4}), false);

    assert.ok(_.matcher({x: 1, y: 5})(specObj), 'inherited and own properties are checked on the test object');

    Prototest.x = 5;
    assert.ok(_.matcher(Prototest)({x: 5, y: 1}), 'spec can be a function');

    // #1729
    var o = {b: 1};
    var m = _.matcher(o);

    assert.equal(m({b: 1}), true);
    o.b = 2;
    o.a = 1;
    assert.equal(m({b: 1}), true, 'changing spec object doesnt change matches result');


    //null edge cases
    var oCon = _.matcher({constructor: Object});
    assert.deepEqual(_.map([null, void 0, 5, {}], oCon), [false, false, false, true], 'doesnt falsey match constructor on undefined/null');
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/collections.js

#### find

```ts
test('find', function(assert) {
    var array = [1, 2, 3, 4];
    assert.strictEqual(_.find(array, function(n) { return n > 2; }), 3, 'should return first found `value`');
    assert.strictEqual(_.find(array, function() { return false; }), void 0, 'should return `undefined` if `value` is not found');

    array.dontmatch = 55;
    assert.strictEqual(_.find(array, function(x) { return x === 55; }), void 0, 'iterates array-likes correctly');

    // Matching an object like _.findWhere.
    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}, {a: 2, b: 4}];
    assert.deepEqual(_.find(list, {a: 1}), {a: 1, b: 2}, 'can be used as findWhere');
    assert.deepEqual(_.find(list, {b: 4}), {a: 1, b: 4});
    assert.notOk(_.find(list, {c: 1}), 'undefined when not found');
    assert.notOk(_.find([], {c: 1}), 'undefined when searching empty list');

    var result = _.find([1, 2, 3], function(num){ return num * 2 === 4; });
    assert.equal(result, 2, 'found the first "2" and broke the loop');

    var obj = {
      a: {x: 1, z: 3},
      b: {x: 2, z: 2},
      c: {x: 3, z: 4},
      d: {x: 4, z: 1}
    };

    assert.deepEqual(_.find(obj, {x: 2}), {x: 2, z: 2}, 'works on objects');
    assert.deepEqual(_.find(obj, {x: 2, z: 1}), void 0);
    assert.deepEqual(_.find(obj, function(x) {
      return x.x === 4;
    }), {x: 4, z: 1});

    _.findIndex([{a: 1}], function(a, key, o) {
      assert.equal(key, 0);
      assert.deepEqual(o, [{a: 1}]);
      assert.strictEqual(this, _, 'called with context');
    }, _);
  }
```

#### invoke

```ts
test('invoke', function(assert) {
    assert.expect(5);
    var list = [[5, 1, 7], [3, 2, 1]];
    var result = _.invoke(list, 'sort');
    assert.deepEqual(result[0], [1, 5, 7], 'first array sorted');
    assert.deepEqual(result[1], [1, 2, 3], 'second array sorted');

    _.invoke([{
      method: function() {
        assert.deepEqual(_.toArray(arguments), [1, 2, 3], 'called with arguments');
      }
    }], 'method', 1, 2, 3);

    assert.deepEqual(_.invoke([{a: null}, {}, {a: _.constant(1)}], 'a'), [null, void 0, 1], 'handles null & undefined');

    assert.raises(function() {
      _.invoke([{a: 1}], 'a');
    }, TypeError, 'throws for non-functions');
  }
```

#### invoke w/ function reference

```ts
test('invoke w/ function reference', function(assert) {
    var list = [[5, 1, 7], [3, 2, 1]];
    var result = _.invoke(list, Array.prototype.sort);
    assert.deepEqual(result[0], [1, 5, 7], 'first array sorted');
    assert.deepEqual(result[1], [1, 2, 3], 'second array sorted');

    assert.deepEqual(_.invoke([1, 2, 3], function(a) {
      return a + this;
    }, 5), [6, 7, 8], 'receives params from invoke');
  }
```

#### invoke when strings have a call method

```ts
test('invoke when strings have a call method', function(assert) {
    String.prototype.call = function() {
      return 42;
    };
    var list = [[5, 1, 7], [3, 2, 1]];
    var s = 'foo';
    assert.equal(s.call(), 42, 'call function exists');
    var result = _.invoke(list, 'sort');
    assert.deepEqual(result[0], [1, 5, 7], 'first array sorted');
    assert.deepEqual(result[1], [1, 2, 3], 'second array sorted');
    delete String.prototype.call;
    assert.equal(s.call, void 0, 'call function removed');
  }
```

#### where

```ts
test('where', function(assert) {
    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}];
    var result = _.where(list, {a: 1});
    assert.equal(result.length, 3);
    assert.equal(result[result.length - 1].b, 4);
    result = _.where(list, {b: 2});
    assert.equal(result.length, 2);
    assert.equal(result[0].a, 1);
    result = _.where(list, {});
    assert.equal(result.length, list.length);

    function test() {}
    test.map = _.map;
    assert.deepEqual(_.where([_, {a: 1, b: 2}, _], test), [_, _], 'checks properties given function');
  }
```

#### findWhere

```ts
test('findWhere', function(assert) {
    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}, {a: 2, b: 4}];
    var result = _.findWhere(list, {a: 1});
    assert.deepEqual(result, {a: 1, b: 2});
    result = _.findWhere(list, {b: 4});
    assert.deepEqual(result, {a: 1, b: 4});

    result = _.findWhere(list, {c: 1});
    assert.ok(_.isUndefined(result), 'undefined when not found');

    result = _.findWhere([], {c: 1});
    assert.ok(_.isUndefined(result), 'undefined when searching empty list');

    function test() {}
    test.map = _.map;
    assert.equal(_.findWhere([_, {a: 1, b: 2}, _], test), _, 'checks properties given function');

    function TestClass() {
      this.y = 5;
      this.x = 'foo';
    }
    var expect = {c: 1, x: 'foo', y: 5};
    assert.deepEqual(_.findWhere([{y: 5, b: 6}, expect], new TestClass()), expect, 'uses class instance properties');
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/utils.js

#### should handle a type with a malformed parameter and break the loop in acceptParams

```ts
it('should handle a type with a malformed parameter and break the loop in acceptParams', () => {
    const result = utils.normalizeType('text/plain;invalid');
    assert.deepEqual(result,{
      value: 'text/plain',
      quality: 1,
      params: {} // No parameters are added since "invalid" has no "="
    });
  }
```

#### should default to application/octet-stream when mime lookup fails

```ts
it('should default to application/octet-stream when mime lookup fails', () => {
    const result = utils.normalizeType('unknown-extension-xyz');
    assert.deepEqual(result, {
      value: 'application/octet-stream',
      params: {}
    });
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/model.js

#### set falsy values in the correct order

```ts
test('set falsy values in the correct order', function(assert) {
    assert.expect(2);
    var model = new Backbone.Model({result: 'result'});
    model.on('change', function() {
      assert.equal(model.changed.result, void 0);
      assert.equal(model.previous('result'), false);
    });
    model.set({result: void 0}, {silent: true});
    model.set({result: null}, {silent: true});
    model.set({result: false}, {silent: true});
    model.set({result: void 0});
  }
```

#### validate

```ts
test('validate', function(assert) {
    var lastError;
    var model = new Backbone.Model();
    model.validate = function(attrs) {
      if (attrs.admin !== this.get('admin')) return "Can't change admin status.";
    };
    model.on('invalid', function(m, error) {
      lastError = error;
    });
    var result = model.set({a: 100});
    assert.equal(result, model);
    assert.equal(model.get('a'), 100);
    assert.equal(lastError, undefined);
    result = model.set({admin: true});
    assert.equal(model.get('admin'), true);
    result = model.set({a: 200, admin: false}, {validate: true});
    assert.equal(lastError, "Can't change admin status.");
    assert.equal(result, false);
    assert.equal(model.get('a'), 100);
  }
```

#### validate with error callback

```ts
test('validate with error callback', function(assert) {
    assert.expect(8);
    var lastError, boundError;
    var model = new Backbone.Model();
    model.validate = function(attrs) {
      if (attrs.admin) return "Can't change admin status.";
    };
    model.on('invalid', function(m, error) {
      boundError = true;
    });
    var result = model.set({a: 100}, {validate: true});
    assert.equal(result, model);
    assert.equal(model.get('a'), 100);
    assert.equal(model.validationError, null);
    assert.equal(boundError, undefined);
    result = model.set({a: 200, admin: true}, {validate: true});
    assert.equal(result, false);
    assert.equal(model.get('a'), 100);
    assert.equal(model.validationError, "Can't change admin status.");
    assert.equal(boundError, true);
  }
```

#### #1030 - `save` with `wait` results in correct attributes if success is called during sync

```ts
test('#1030 - `save` with `wait` results in correct attributes if success is called during sync', function(assert) {
    assert.expect(2);
    var model = new Backbone.Model({x: 1, y: 2});
    model.sync = function(method, m, options) {
      options.success();
    };
    model.on('change:x', function() { assert.ok(true); });
    model.save({x: 3}, {wait: true});
    assert.equal(model.get('x'), 3);
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/test/test-fp.js

#### should have correct aliases

```ts
test('should have correct aliases', function(assert) {
      assert.expect(1);

      var actual = _.transform(mapping.aliasToReal, function(result, realName, alias) {
        result.push([alias, fp[alias] === fp[realName]]);
      }, []);

      assert.deepEqual(_.reject(actual, 1), []);
    }
```

#### should have a cap of 1

```ts
test('should have a cap of 1', function(assert) {
      assert.expect(1);

      var funcMethods = [
        'curry', 'iteratee', 'memoize', 'over', 'overEvery', 'overSome',
        'method', 'methodOf', 'rest', 'runInContext'
      ];

      var exceptions = funcMethods.concat('mixin', 'nthArg', 'template'),
          expected = _.map(mapping.aryMethod[1], _.constant(true));

      var actual = _.map(mapping.aryMethod[1], function(methodName) {
        var arg = _.includes(funcMethods, methodName) ? _.noop : 1,
            result = _.attempt(function() { return fp[methodName](arg); });

        if (_.includes(exceptions, methodName)
              ? typeof result == 'function'
              : typeof result != 'function'
            ) {
          return true;
        }
        console.log(methodName, result);
        return false;
      });

      assert.deepEqual(actual, expected);
    }
```

#### should have a cap of 2

```ts
test('should have a cap of 2', function(assert) {
      assert.expect(1);

      var funcMethods = [
        'after', 'ary', 'before', 'bind', 'bindKey', 'curryN', 'debounce',
        'delay', 'overArgs', 'partial', 'partialRight', 'rearg', 'throttle',
        'wrap'
      ];

      var exceptions = _.without(funcMethods.concat('matchesProperty'), 'delay'),
          expected = _.map(mapping.aryMethod[2], _.constant(true));

      var actual = _.map(mapping.aryMethod[2], function(methodName) {
        var args = _.includes(funcMethods, methodName) ? [methodName == 'curryN' ? 1 : _.noop, _.noop] : [1, []],
            result = _.attempt(function() { return fp[methodName](args[0])(args[1]); });

        if (_.includes(exceptions, methodName)
              ? typeof result == 'function'
              : typeof result != 'function'
            ) {
          return true;
        }
        console.log(methodName, result);
        return false;
      });

      assert.deepEqual(actual, expected);
    }
```

#### should have a cap of 3

```ts
test('should have a cap of 3', function(assert) {
      assert.expect(1);

      var funcMethods = [
        'assignWith', 'extendWith', 'isEqualWith', 'isMatchWith', 'reduce',
        'reduceRight', 'transform', 'zipWith'
      ];

      var expected = _.map(mapping.aryMethod[3], _.constant(true));

      var actual = _.map(mapping.aryMethod[3], function(methodName) {
        var args = _.includes(funcMethods, methodName) ? [_.noop, 0, 1] : [0, 1, []],
            result = _.attempt(function() { return fp[methodName](args[0])(args[1])(args[2]); });

        if (typeof result != 'function') {
          return true;
        }
        console.log(methodName, result);
        return false;
      });

      assert.deepEqual(actual, expected);
    }
```

#### should support a `min` and `max` argument

```ts
test('should support a `min` and `max` argument', function(assert) {
      assert.expect(1);

      var min = 5,
          max = 10;

      assert.ok(_.some(array, function() {
        var result = fp.random(min)(max);
        return result >= min && result <= max;
      }));
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/collection.js

#### remove

```ts
test('remove', function(assert) {
    assert.expect(12);
    var removed = null;
    var result = null;
    col.on('remove', function(model, collection, options) {
      removed = model.get('label');
      assert.equal(options.index, 3);
      assert.equal(collection.get(model), undefined, '#3693: model cannot be fetched from collection');
    });
    result = col.remove(d);
    assert.equal(removed, 'd');
    assert.strictEqual(result, d);
    //if we try to remove d again, it's not going to actually get removed
    result = col.remove(d);
    assert.strictEqual(result, undefined);
    assert.equal(col.length, 3);
    assert.equal(col.first(), a);
    col.off();
    result = col.remove([c, d]);
    assert.equal(result.length, 1, 'only returns removed models');
    assert.equal(result[0], c, 'only returns removed models');
    result = col.remove([c, b]);
    assert.equal(result.length, 1, 'only returns removed models');
    assert.equal(result[0], b, 'only returns removed models');
    result = col.remove([]);
    assert.deepEqual(result, [], 'returns empty array when nothing removed');
  });

  QUnit.test('add and remove return values', function(assert) {
    assert.expect(13);
    var Even = Backbone.Model.extend({
      validate: function(attrs) {
        if (attrs.id % 2 !== 0) return 'odd';
      }
    });
    var collection = new Backbone.Collection;
    collection.model = Even;

    var list = collection.add([{id: 2}, {id: 4}], {validate: true});
    assert.equal(list.length, 2);
    assert.ok(list[0] instanceof Backbone.Model);
    assert.equal(list[1], collection.last());
    assert.equal(list[1].get('id'), 4);

    list = collection.add([{id: 3}, {id: 6}], {validate: true});
    assert.equal(collection.length, 3);
    assert.equal(list[0], false);
    assert.equal(list[1].get('id'), 6);

    var result = collection.add({id: 6});
    assert.equal(result.cid, list[1].cid);

    result = collection.remove({id: 6});
    assert.equal(collection.length, 2);
    assert.equal(result.id, 6);

    list = collection.remove([{id: 2}, {id: 8}]);
    assert.equal(collection.length, 1);
    assert.equal(list[0].get('id'), 2);
    assert.equal(list[1], null);
  });

  QUnit.test('shift and pop', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection([{a: 'a'}, {b: 'b'}, {c: 'c'}]);
    assert.equal(collection.shift().get('a'), 'a');
    assert.equal(collection.pop().get('c'), 'c');
  });

  QUnit.test('slice', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection([{a: 'a'}, {b: 'b'}, {c: 'c'}]);
    var array = collection.slice(1, 3);
    assert.equal(array.length, 2);
    assert.equal(array[0].get('b'), 'b');
  });

  QUnit.test('events are unbound on remove', function(assert) {
    assert.expect(3);
    var counter = 0;
    var dj = new Backbone.Model();
    var emcees = new Backbone.Collection([dj]);
    emcees.on('change', function(){ counter++; });
    dj.set({name: 'Kool'});
    assert.equal(counter, 1);
    emcees.reset([]);
    assert.equal(dj.collection, undefined);
    dj.set({name: 'Shadow'});
    assert.equal(counter, 1);
  });

  QUnit.test('remove in multiple collections', function(assert) {
    assert.expect(7);
    var modelData = {
      id: 5,
      title: 'Othello'
    };
    var passed = false;
    var m1 = new Backbone.Model(modelData);
    var m2 = new Backbone.Model(modelData);
    m2.on('remove', function() {
      passed = true;
    });
    var col1 = new Backbone.Collection([m1]);
    var col2 = new Backbone.Collection([m2]);
    assert.notEqual(m1, m2);
    assert.ok(col1.length === 1);
    assert.ok(col2.length === 1);
    col1.remove(m1);
    assert.equal(passed, false);
    assert.ok(col1.length === 0);
    col2.remove(m1);
    assert.ok(col2.length === 0);
    assert.equal(passed, true);
  });

  QUnit.test('remove same model in multiple collection', function(assert) {
    assert.expect(16);
    var counter = 0;
    var m = new Backbone.Model({id: 5, title: 'Othello'});
    m.on('remove', function(model, collection) {
      counter++;
      assert.equal(m, model);
      if (counter > 1) {
        assert.equal(collection, col1);
      } else {
        assert.equal(collection, col2);
      }
    });
    var col1 = new Backbone.Collection([m]);
    col1.on('remove', function(model, collection) {
      assert.equal(m, model);
      assert.equal(col1, collection);
    });
    var col2 = new Backbone.Collection([m]);
    col2.on('remove', function(model, collection) {
      assert.equal(m, model);
      assert.equal(col2, collection);
    });
    assert.equal(col1, m.collection);
    col2.remove(m);
    assert.ok(col2.length === 0);
    assert.ok(col1.length === 1);
    assert.equal(counter, 1);
    assert.equal(col1, m.collection);
    col1.remove(m);
    assert.equal(null, m.collection);
    assert.ok(col1.length === 0);
    assert.equal(counter, 2);
  });

  QUnit.test('model destroy removes from all collections', function(assert) {
    assert.expect(3);
    var m = new Backbone.Model({id: 5, title: 'Othello'});
    m.sync = function(method, model, options) { options.success(); };
    var col1 = new Backbone.Collection([m]);
    var col2 = new Backbone.Collection([m]);
    m.destroy();
    assert.ok(col1.length === 0);
    assert.ok(col2.length === 0);
    assert.equal(undefined, m.collection);
  });

  QUnit.test('Collection: non-persisted model destroy removes from all collections', function(assert) {
    assert.expect(3);
    var m = new Backbone.Model({title: 'Othello'});
    m.sync = function(method, model, options) { throw 'should not be called'; };
    var col1 = new Backbone.Collection([m]);
    var col2 = new Backbone.Collection([m]);
    m.destroy();
    assert.ok(col1.length === 0);
    assert.ok(col2.length === 0);
    assert.equal(undefined, m.collection);
  });

  QUnit.test('fetch', function(assert) {
    assert.expect(4);
    var collection = new Backbone.Collection;
    collection.url = '/test';
    collection.fetch();
    assert.equal(this.syncArgs.method, 'read');
    assert.equal(this.syncArgs.model, collection);
    assert.equal(this.syncArgs.options.parse, true);

    collection.fetch({parse: false});
    assert.equal(this.syncArgs.options.parse, false);
  });

  QUnit.test('fetch with an error response triggers an error event', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection();
    collection.on('error', function() {
      assert.ok(true);
    });
    collection.sync = function(method, model, options) { options.error(); };
    collection.fetch();
  });

  QUnit.test('#3283 - fetch with an error response calls error with context', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection();
    var obj = {};
    var options = {
      context: obj,
      error: function() {
        assert.equal(this, obj);
      }
    };
    collection.sync = function(method, model, opts) {
      opts.error.call(opts.context);
    };
    collection.fetch(options);
  });

  QUnit.test('ensure fetch only parses once', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection;
    var counter = 0;
    collection.parse = function(models) {
      counter++;
      return models;
    };
    collection.url = '/test';
    collection.fetch();
    this.syncArgs.options.success([]);
    assert.equal(counter, 1);
  });

  QUnit.test('create', function(assert) {
    assert.expect(4);
    var collection = new Backbone.Collection;
    collection.url = '/test';
    var model = collection.create({label: 'f'}, {wait: true});
    assert.equal(this.syncArgs.method, 'create');
    assert.equal(this.syncArgs.model, model);
    assert.equal(model.get('label'), 'f');
    assert.equal(model.collection, collection);
  });

  QUnit.test('create with validate:true enforces validation', function(assert) {
    assert.expect(3);
    var ValidatingModel = Backbone.Model.extend({
      validate: function(attrs) {
        return 'fail';
      }
    });
    var ValidatingCollection = Backbone.Collection.extend({
      model: ValidatingModel
    });
    var collection = new ValidatingCollection();
    collection.on('invalid', function(coll, error, options) {
      assert.equal(error, 'fail');
      assert.equal(options.validationError, 'fail');
    });
    assert.equal(collection.create({foo: 'bar'}, {validate: true}), false);
  });

  QUnit.test('create will pass extra options to success callback', function(assert) {
    assert.expect(1);
    var Model = Backbone.Model.extend({
      sync: function(method, model, options) {
        _.extend(options, {specialSync: true});
        return Backbone.Model.prototype.sync.call(this, method, model, options);
      }
    });

    var Collection = Backbone.Collection.extend({
      model: Model,
      url: '/test'
    });

    var collection = new Collection;

    var success = function(model, response, options) {
      assert.ok(options.specialSync, 'Options were passed correctly to callback');
    };

    collection.create({}, {success: success});
    this.ajaxSettings.success();
  });

  QUnit.test('create with wait:true should not call collection.parse', function(assert) {
    assert.expect(0);
    var Collection = Backbone.Collection.extend({
      url: '/test',
      parse: function() {
        assert.ok(false);
      }
    });

    var collection = new Collection;

    collection.create({}, {wait: true});
    this.ajaxSettings.success();
  });

  QUnit.test('a failing create returns model with errors', function(assert) {
    var ValidatingModel = Backbone.Model.extend({
      validate: function(attrs) {
        return 'fail';
      }
    });
    var ValidatingCollection = Backbone.Collection.extend({
      model: ValidatingModel
    });
    var collection = new ValidatingCollection();
    var m = collection.create({foo: 'bar'});
    assert.equal(m.validationError, 'fail');
    assert.equal(collection.length, 1);
  });

  QUnit.test('initialize', function(assert) {
    assert.expect(1);
    var Collection = Backbone.Collection.extend({
      initialize: function() {
        this.one = 1;
      }
    });
    var coll = new Collection;
    assert.equal(coll.one, 1);
  });

  QUnit.test('preinitialize', function(assert) {
    assert.expect(1);
    var Collection = Backbone.Collection.extend({
      preinitialize: function() {
        this.one = 1;
      }
    });
    var coll = new Collection;
    assert.equal(coll.one, 1);
  });

  QUnit.test('preinitialize occurs before the collection is set up', function(assert) {
    assert.expect(2);
    var Collection = Backbone.Collection.extend({
      preinitialize: function() {
        assert.notEqual(this.model, FooModel);
      }
    });
    var FooModel = Backbone.Model.extend({id: 'foo'});
    var coll = new Collection({}, {
      model: FooModel
    });
    assert.equal(coll.model, FooModel);
  });

  QUnit.test('toJSON', function(assert) {
    assert.expect(1);
    assert.equal(JSON.stringify(col), '[{"id":3,"label":"a"},{"id":2,"label":"b"},{"id":1,"label":"c"},{"id":0,"label":"d"}]');
  });

  QUnit.test('where and findWhere', function(assert) {
    assert.expect(8);
    var model = new Backbone.Model({a: 1});
    var coll = new Backbone.Collection([
      model,
      {a: 1},
      {a: 1, b: 2},
      {a: 2, b: 2},
      {a: 3}
    ]);
    assert.equal(coll.where({a: 1}).length, 3);
    assert.equal(coll.where({a: 2}).length, 1);
    assert.equal(coll.where({a: 3}).length, 1);
    assert.equal(coll.where({b: 1}).length, 0);
    assert.equal(coll.where({b: 2}).length, 2);
    assert.equal(coll.where({a: 1, b: 2}).length, 1);
    assert.equal(coll.findWhere({a: 1}), model);
    assert.equal(coll.findWhere({a: 4}), void 0);
  });

  QUnit.test('Underscore methods', function(assert) {
    assert.expect(21);
    assert.equal(col.map(function(model){ return model.get('label'); }).join(' '), 'a b c d');
    assert.equal(col.some(function(model){ return model.id === 100; }), false);
    assert.equal(col.some(function(model){ return model.id === 0; }), true);
    assert.equal(col.reduce(function(m1, m2) {return m1.id > m2.id ? m1 : m2;}).id, 3);
    assert.equal(col.reduceRight(function(m1, m2) {return m1.id > m2.id ? m1 : m2;}).id, 3);
    assert.equal(col.indexOf(b), 1);
    assert.equal(col.size(), 4);
    assert.equal(col.rest().length, 3);
    assert.ok(!_.includes(col.rest(), a));
    assert.ok(_.includes(col.rest(), d));
    assert.ok(!col.isEmpty());
    assert.ok(!_.includes(col.without(d), d));

    var wrapped = col.chain();
    assert.equal(wrapped.map('id').max().value(), 3);
    assert.equal(wrapped.map('id').min().value(), 0);
    assert.deepEqual(wrapped
      .filter(function(o){ return o.id % 2 === 0; })
      .map(function(o){ return o.id * 2; })
      .value(),
      [4, 0]);
    assert.deepEqual(col.difference([c, d]), [a, b]);
    assert.ok(col.includes(col.sample()));

    var first = col.first();
    assert.deepEqual(col.groupBy(function(model){ return model.id; })[first.id], [first]);
    assert.deepEqual(col.countBy(function(model){ return model.id; }), {0: 1, 1: 1, 2: 1, 3: 1});
    assert.deepEqual(col.sortBy(function(model){ return model.id; })[0], col.at(3));
    assert.ok(col.indexBy('id')[first.id] === first);
  });

  QUnit.test('Underscore methods with object-style and property-style iteratee', function(assert) {
    assert.expect(26);
    var model = new Backbone.Model({a: 4, b: 1, e: 3});
    var coll = new Backbone.Collection([
      {a: 1, b: 1},
      {a: 2, b: 1, c: 1},
      {a: 3, b: 1},
      model
    ]);
    assert.equal(coll.find({a: 0}), undefined);
    assert.deepEqual(coll.find({a: 4}), model);
    assert.equal(coll.find('d'), undefined);
    assert.deepEqual(coll.find('e'), model);
    assert.equal(coll.filter({a: 0}), false);
    assert.deepEqual(coll.filter({a: 4}), [model]);
    assert.equal(coll.some({a: 0}), false);
    assert.equal(coll.some({a: 1}), true);
    assert.equal(coll.reject({a: 0}).length, 4);
    assert.deepEqual(coll.reject({a: 4}), _.without(coll.models, model));
    assert.equal(coll.every({a: 0}), false);
    assert.equal(coll.every({b: 1}), true);
    assert.deepEqual(coll.partition({a: 0})[0], []);
    assert.deepEqual(coll.partition({a: 0})[1], coll.models);
    assert.deepEqual(coll.partition({a: 4})[0], [model]);
    assert.deepEqual(coll.partition({a: 4})[1], _.without(coll.models, model));
    assert.deepEqual(coll.map({a: 2}), [false, true, false, false]);
    assert.deepEqual(coll.map('a'), [1, 2, 3, 4]);
    assert.deepEqual(coll.sortBy('a')[3], model);
    assert.deepEqual(coll.sortBy('e')[0], model);
    assert.deepEqual(coll.countBy({a: 4}), {'false': 3, 'true': 1});
    assert.deepEqual(coll.countBy('d'), {'undefined': 4});
    assert.equal(coll.findIndex({b: 1}), 0);
    assert.equal(coll.findIndex({b: 9}), -1);
    assert.equal(coll.findLastIndex({b: 1}), 3);
    assert.equal(coll.findLastIndex({b: 9}), -1);
  });

  QUnit.test('reset', function(assert) {
    assert.expect(16);

    var resetCount = 0;
    var models = col.models;
    col.on('reset', function() { resetCount += 1; });
    col.reset([]);
    assert.equal(resetCount, 1);
    assert.equal(col.length, 0);
    assert.equal(col.last(), null);
    col.reset(models);
    assert.equal(resetCount, 2);
    assert.equal(col.length, 4);
    assert.equal(col.last(), d);
    col.reset(_.map(models, function(m){ return m.attributes; }));
    assert.equal(resetCount, 3);
    assert.equal(col.length, 4);
    assert.ok(col.last() !== d);
    assert.ok(_.isEqual(col.last().attributes, d.attributes));
    col.reset();
    assert.equal(col.length, 0);
    assert.equal(resetCount, 4);

    var f = new Backbone.Model({id: 20, label: 'f'});
    col.reset([undefined, f]);
    assert.equal(col.length, 2);
    assert.equal(resetCount, 5);

    col.reset(new Array(4));
    assert.equal(col.length, 4);
    assert.equal(resetCount, 6);
  });

  QUnit.test('reset with different values', function(assert) {
    var collection = new Backbone.Collection({id: 1});
    collection.reset({id: 1, a: 1});
    assert.equal(collection.get(1).get('a'), 1);
  });

  QUnit.test('same references in reset', function(assert) {
    var model = new Backbone.Model({id: 1});
    var collection = new Backbone.Collection({id: 1});
    collection.reset(model);
    assert.equal(collection.get(1), model);
  });

  QUnit.test('reset passes caller options', function(assert) {
    assert.expect(3);
    var Model = Backbone.Model.extend({
      initialize: function(attrs, options) {
        this.modelParameter = options.modelParameter;
      }
    });
    var collection = new (Backbone.Collection.extend({model: Model}))();
    collection.reset([{astring: 'green', anumber: 1}, {astring: 'blue', anumber: 2}], {modelParameter: 'model parameter'});
    assert.equal(collection.length, 2);
    collection.each(function(model) {
      assert.equal(model.modelParameter, 'model parameter');
    });
  });

  QUnit.test('reset does not alter options by reference', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection([{id: 1}]);
    var origOpts = {};
    collection.on('reset', function(coll, opts){
      assert.equal(origOpts.previousModels, undefined);
      assert.equal(opts.previousModels[0].id, 1);
    });
    collection.reset([], origOpts);
  });

  QUnit.test('trigger custom events on models', function(assert) {
    assert.expect(1);
    var fired = null;
    a.on('custom', function() { fired = true; });
    a.trigger('custom');
    assert.equal(fired, true);
  });

  QUnit.test('add does not alter arguments', function(assert) {
    assert.expect(2);
    var attrs = {};
    var models = [attrs];
    new Backbone.Collection().add(models);
    assert.equal(models.length, 1);
    assert.ok(attrs === models[0]);
  });

  QUnit.test('#714: access `model.collection` in a brand new model.', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection;
    collection.url = '/test';
    var Model = Backbone.Model.extend({
      set: function(attrs) {
        assert.equal(attrs.prop, 'value');
        assert.equal(this.collection, collection);
        return this;
      }
    });
    collection.model = Model;
    collection.create({prop: 'value'});
  });

  QUnit.test('#574, remove its own reference to the .models array.', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection([
      {id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}, {id: 6}
    ]);
    assert.equal(collection.length, 6);
    collection.remove(collection.models);
    assert.equal(collection.length, 0);
  });

  QUnit.test('#861, adding models to a collection which do not pass validation, with validate:true', function(assert) {
    assert.expect(2);
    var Model = Backbone.Model.extend({
      validate: function(attrs) {
        if (attrs.id === 3) return "id can't be 3";
      }
    });

    var Collection = Backbone.Collection.extend({
      model: Model
    });

    var collection = new Collection;
    collection.on('invalid', function() { assert.ok(true); });

    collection.add([{id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}, {id: 6}], {validate: true});
    assert.deepEqual(collection.pluck('id'), [1, 2, 4, 5, 6]);
  });

  QUnit.test('Invalid models are discarded with validate:true.', function(assert) {
    assert.expect(5);
    var collection = new Backbone.Collection;
    collection.on('test', function() { assert.ok(true); });
    collection.model = Backbone.Model.extend({
      validate: function(attrs){ if (!attrs.valid) return 'invalid'; }
    });
    var model = new collection.model({id: 1, valid: true});
    collection.add([model, {id: 2}], {validate: true});
    model.trigger('test');
    assert.ok(collection.get(model.cid));
    assert.ok(collection.get(1));
    assert.ok(!collection.get(2));
    assert.equal(collection.length, 1);
  });

  QUnit.test('multiple copies of the same model', function(assert) {
    assert.expect(3);
    var collection = new Backbone.Collection();
    var model = new Backbone.Model();
    collection.add([model, model]);
    assert.equal(collection.length, 1);
    collection.add([{id: 1}, {id: 1}]);
    assert.equal(collection.length, 2);
    assert.equal(collection.last().id, 1);
  });

  QUnit.test('#964 - collection.get return inconsistent', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection();
    assert.ok(collection.get(null) === undefined);
    assert.ok(collection.get() === undefined);
  });

  QUnit.test('#1112 - passing options.model sets collection.model', function(assert) {
    assert.expect(2);
    var Model = Backbone.Model.extend({});
    var collection = new Backbone.Collection([{id: 1}], {model: Model});
    assert.ok(collection.model === Model);
    assert.ok(collection.at(0) instanceof Model);
  });

  QUnit.test('null and undefined are invalid ids.', function(assert) {
    assert.expect(2);
    var model = new Backbone.Model({id: 1});
    var collection = new Backbone.Collection([model]);
    model.set({id: null});
    assert.ok(!collection.get('null'));
    model.set({id: 1});
    model.set({id: undefined});
    assert.ok(!collection.get('undefined'));
  });

  QUnit.test('falsy comparator', function(assert) {
    assert.expect(4);
    var Col = Backbone.Collection.extend({
      comparator: function(model){ return model.id; }
    });
    var collection = new Col();
    var colFalse = new Col(null, {comparator: false});
    var colNull = new Col(null, {comparator: null});
    var colUndefined = new Col(null, {comparator: undefined});
    assert.ok(collection.comparator);
    assert.ok(!colFalse.comparator);
    assert.ok(!colNull.comparator);
    assert.ok(colUndefined.comparator);
  });

  QUnit.test('#1355 - `options` is passed to success callbacks', function(assert) {
    assert.expect(2);
    var m = new Backbone.Model({x: 1});
    var collection = new Backbone.Collection();
    var opts = {
      opts: true,
      success: function(coll, resp, options) {
        assert.ok(options.opts);
      }
    };
    collection.sync = m.sync = function( method, coll, options ){
      options.success({});
    };
    collection.fetch(opts);
    collection.create(m, opts);
  });

  QUnit.test("#1412 - Trigger 'request' and 'sync' events.", function(assert) {
    assert.expect(4);
    var collection = new Backbone.Collection;
    collection.url = '/test';
    Backbone.ajax = function(settings){ settings.success(); };

    collection.on('request', function(obj, xhr, options) {
      assert.ok(obj === collection, "collection has correct 'request' event after fetching");
    });
    collection.on('sync', function(obj, response, options) {
      assert.ok(obj === collection, "collection has correct 'sync' event after fetching");
    });
    collection.fetch();
    collection.off();

    collection.on('request', function(obj, xhr, options) {
      assert.ok(obj === collection.get(1), "collection has correct 'request' event after one of its models save");
    });
    collection.on('sync', function(obj, response, options) {
      assert.ok(obj === collection.get(1), "collection has correct 'sync' event after one of its models save");
    });
    collection.create({id: 1});
    collection.off();
  });

  QUnit.test('#3283 - fetch, create calls success with context', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection;
    collection.url = '/test';
    Backbone.ajax = function(settings) {
      settings.success.call(settings.context);
    };
    var obj = {};
    var options = {
      context: obj,
      success: function() {
        assert.equal(this, obj);
      }
    };

    collection.fetch(options);
    collection.create({id: 1}, options);
  });

  QUnit.test('#1447 - create with wait adds model.', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection;
    var model = new Backbone.Model;
    model.sync = function(method, m, options){ options.success(); };
    collection.on('add', function(){ assert.ok(true); });
    collection.create(model, {wait: true});
  });

  QUnit.test('#1448 - add sorts collection after merge.', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([
      {id: 1, x: 1},
      {id: 2, x: 2}
    ]);
    collection.comparator = function(model){ return model.get('x'); };
    collection.add({id: 1, x: 3}, {merge: true});
    assert.deepEqual(collection.pluck('id'), [2, 1]);
  });

  QUnit.test('#1655 - groupBy can be used with a string argument.', function(assert) {
    assert.expect(3);
    var collection = new Backbone.Collection([{x: 1}, {x: 2}]);
    var grouped = collection.groupBy('x');
    assert.strictEqual(_.keys(grouped).length, 2);
    assert.strictEqual(grouped[1][0].get('x'), 1);
    assert.strictEqual(grouped[2][0].get('x'), 2);
  });

  QUnit.test('#1655 - sortBy can be used with a string argument.', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([{x: 3}, {x: 1}, {x: 2}]);
    var values = _.map(collection.sortBy('x'), function(model) {
      return model.get('x');
    });
    assert.deepEqual(values, [1, 2, 3]);
  });

  QUnit.test('#1604 - Removal during iteration.', function(assert) {
    assert.expect(0);
    var collection = new Backbone.Collection([{}, {}]);
    collection.on('add', function() {
      collection.at(0).destroy();
    });
    collection.add({}, {at: 0});
  });

  QUnit.test('#1638 - `sort` during `add` triggers correctly.', function(assert) {
    var collection = new Backbone.Collection;
    collection.comparator = function(model) { return model.get('x'); };
    var added = [];
    collection.on('add', function(model) {
      model.set({x: 3});
      collection.sort();
      added.push(model.id);
    });
    collection.add([{id: 1, x: 1}, {id: 2, x: 2}]);
    assert.deepEqual(added, [1, 2]);
  });

  QUnit.test('fetch parses models by default', function(assert) {
    assert.expect(1);
    var model = {};
    var Collection = Backbone.Collection.extend({
      url: 'test',
      model: Backbone.Model.extend({
        parse: function(resp) {
          assert.strictEqual(resp, model);
        }
      })
    });
    new Collection().fetch();
    this.ajaxSettings.success([model]);
  });

  QUnit.test("`sort` shouldn't always fire on `add`", function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([{id: 1}, {id: 2}, {id: 3}], {
      comparator: 'id'
    });
    collection.sort = function(){ assert.ok(true); };
    collection.add([]);
    collection.add({id: 1});
    collection.add([{id: 2}, {id: 3}]);
    collection.add({id: 4});
  });

  QUnit.test('#1407 parse option on constructor parses collection and models', function(assert) {
    assert.expect(2);
    var model = {
      namespace: [{id: 1}, {id: 2}]
    };
    var Collection = Backbone.Collection.extend({
      model: Backbone.Model.extend({
        parse: function(m) {
          m.name = 'test';
          return m;
        }
      }),
      parse: function(m) {
        return m.namespace;
      }
    });
    var collection = new Collection(model, {parse: true});

    assert.equal(collection.length, 2);
    assert.equal(collection.at(0).get('name'), 'test');
  });

  QUnit.test('#1407 parse option on reset parses collection and models', function(assert) {
    assert.expect(2);
    var model = {
      namespace: [{id: 1}, {id: 2}]
    };
    var Collection = Backbone.Collection.extend({
      model: Backbone.Model.extend({
        parse: function(m) {
          m.name = 'test';
          return m;
        }
      }),
      parse: function(m) {
        return m.namespace;
      }
    });
    var collection = new Collection();
    collection.reset(model, {parse: true});

    assert.equal(collection.length, 2);
    assert.equal(collection.at(0).get('name'), 'test');
  });


  QUnit.test('Reset includes previous models in triggered event.', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model();
    var collection = new Backbone.Collection([model]);
    collection.on('reset', function(coll, options) {
      assert.deepEqual(options.previousModels, [model]);
    });
    collection.reset([]);
  });

  QUnit.test('set', function(assert) {
    var m1 = new Backbone.Model();
    var m2 = new Backbone.Model({id: 2});
    var m3 = new Backbone.Model();
    var collection = new Backbone.Collection([m1, m2]);

    // Test add/change/remove events
    collection.on('add', function(model) {
      assert.strictEqual(model, m3);
    });
    collection.on('change', function(model) {
      assert.strictEqual(model, m2);
    });
    collection.on('remove', function(model) {
      assert.strictEqual(model, m1);
    });

    // remove: false doesn't remove any models
    collection.set([], {remove: false});
    assert.strictEqual(collection.length, 2);

    // add: false doesn't add any models
    collection.set([m1, m2, m3], {add: false});
    assert.strictEqual(collection.length, 2);

    // merge: false doesn't change any models
    collection.set([m1, {id: 2, a: 1}], {merge: false});
    assert.strictEqual(m2.get('a'), void 0);

    // add: false, remove: false only merges existing models
    collection.set([m1, {id: 2, a: 0}, m3, {id: 4}], {add: false, remove: false});
    assert.strictEqual(collection.length, 2);
    assert.strictEqual(m2.get('a'), 0);

    // default options add/remove/merge as appropriate
    collection.set([{id: 2, a: 1}, m3]);
    assert.strictEqual(collection.length, 2);
    assert.strictEqual(m2.get('a'), 1);

    // Test removing models not passing an argument
    collection.off('remove').on('remove', function(model) {
      assert.ok(model === m2 || model === m3);
    });
    collection.set([]);
    assert.strictEqual(collection.length, 0);

    // Test null models on set doesn't clear collection
    collection.off();
    collection.set([{id: 1}]);
    collection.set();
    assert.strictEqual(collection.length, 1);
  });

  QUnit.test('set with only cids', function(assert) {
    assert.expect(3);
    var m1 = new Backbone.Model;
    var m2 = new Backbone.Model;
    var collection = new Backbone.Collection;
    collection.set([m1, m2]);
    assert.equal(collection.length, 2);
    collection.set([m1]);
    assert.equal(collection.length, 1);
    collection.set([m1, m1, m1, m2, m2], {remove: false});
    assert.equal(collection.length, 2);
  });

  QUnit.test('set with only idAttribute', function(assert) {
    assert.expect(3);
    var m1 = {_id: 1};
    var m2 = {_id: 2};
    var Col = Backbone.Collection.extend({
      model: Backbone.Model.extend({
        idAttribute: '_id'
      })
    });
    var collection = new Col;
    collection.set([m1, m2]);
    assert.equal(collection.length, 2);
    collection.set([m1]);
    assert.equal(collection.length, 1);
    collection.set([m1, m1, m1, m2, m2], {remove: false});
    assert.equal(collection.length, 2);
  });

  QUnit.test('set + merge with default values defined', function(assert) {
    var Model = Backbone.Model.extend({
      defaults: {
        key: 'value'
      }
    });
    var m = new Model({id: 1});
    var collection = new Backbone.Collection([m], {model: Model});
    assert.equal(collection.first().get('key'), 'value');

    collection.set({id: 1, key: 'other'});
    assert.equal(collection.first().get('key'), 'other');

    collection.set({id: 1, other: 'value'});
    assert.equal(collection.first().get('key'), 'other');
    assert.equal(collection.length, 1);
  });

  QUnit.test('merge without mutation', function(assert) {
    var Model = Backbone.Model.extend({
      initialize: function(attrs, options) {
        if (attrs.child) {
          this.set('child', new Model(attrs.child, options), options);
        }
      }
    });
    var Collection = Backbone.Collection.extend({model: Model});
    var data = [{id: 1, child: {id: 2}}];
    var collection = new Collection(data);
    assert.equal(collection.first().id, 1);
    collection.set(data);
    assert.equal(collection.first().id, 1);
    collection.set([{id: 2, child: {id: 2}}].concat(data));
    assert.deepEqual(collection.pluck('id'), [2, 1]);
  });

  QUnit.test('`set` and model level `parse`', function(assert) {
    var Model = Backbone.Model.extend({});
    var Collection = Backbone.Collection.extend({
      model: Model,
      parse: function(res) { return _.map(res.models, 'model'); }
    });
    var model = new Model({id: 1});
    var collection = new Collection(model);
    collection.set({models: [
      {model: {id: 1}},
      {model: {id: 2}}
    ]}, {parse: true});
    assert.equal(collection.first(), model);
  });

  QUnit.test('`set` data is only parsed once', function(assert) {
    var collection = new Backbone.Collection();
    collection.model = Backbone.Model.extend({
      parse: function(data) {
        assert.equal(data.parsed, void 0);
        data.parsed = true;
        return data;
      }
    });
    collection.set({}, {parse: true});
  });

  QUnit.test('`set` matches input order in the absence of a comparator', function(assert) {
    var one = new Backbone.Model({id: 1});
    var two = new Backbone.Model({id: 2});
    var three = new Backbone.Model({id: 3});
    var collection = new Backbone.Collection([one, two, three]);
    collection.set([{id: 3}, {id: 2}, {id: 1}]);
    assert.deepEqual(collection.models, [three, two, one]);
    collection.set([{id: 1}, {id: 2}]);
    assert.deepEqual(collection.models, [one, two]);
    collection.set([two, three, one]);
    assert.deepEqual(collection.models, [two, three, one]);
    collection.set([{id: 1}, {id: 2}], {remove: false});
    assert.deepEqual(collection.models, [two, three, one]);
    collection.set([{id: 1}, {id: 2}, {id: 3}], {merge: false});
    assert.deepEqual(collection.models, [one, two, three]);
    collection.set([three, two, one, {id: 4}], {add: false});
    assert.deepEqual(collection.models, [one, two, three]);
  });

  QUnit.test('#1894 - Push should not trigger a sort', function(assert) {
    assert.expect(0);
    var Collection = Backbone.Collection.extend({
      comparator: 'id',
      sort: function() { assert.ok(false); }
    });
    new Collection().push({id: 1});
  });

  QUnit.test('#2428 - push duplicate models, return the correct one', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection;
    var model1 = collection.push({id: 101});
    var model2 = collection.push({id: 101});
    assert.ok(model2.cid === model1.cid);
  });

  QUnit.test('`set` with non-normal id', function(assert) {
    var Collection = Backbone.Collection.extend({
      model: Backbone.Model.extend({idAttribute: '_id'})
    });
    var collection = new Collection({_id: 1});
    collection.set([{_id: 1, a: 1}], {add: false});
    assert.equal(collection.first().get('a'), 1);
  });

  QUnit.test('#1894 - `sort` can optionally be turned off', function(assert) {
    assert.expect(0);
    var Collection = Backbone.Collection.extend({
      comparator: 'id',
      sort: function() { assert.ok(false); }
    });
    new Collection().add({id: 1}, {sort: false});
  });

  QUnit.test('#1915 - `parse` data in the right order in `set`', function(assert) {
    var collection = new (Backbone.Collection.extend({
      parse: function(data) {
        assert.strictEqual(data.status, 'ok');
        return data.data;
      }
    }));
    var res = {status: 'ok', data: [{id: 1}]};
    collection.set(res, {parse: true});
  });

  QUnit.test('#1939 - `parse` is passed `options`', function(assert) {
    var done = assert.async();
    assert.expect(1);
    var collection = new (Backbone.Collection.extend({
      url: '/',
      parse: function(data, options) {
        assert.strictEqual(options.xhr.someHeader, 'headerValue');
        return data;
      }
    }));
    var ajax = Backbone.ajax;
    Backbone.ajax = function(params) {
      _.defer(params.success, []);
      return {someHeader: 'headerValue'};
    };
    collection.fetch({
      success: function() { done(); }
    });
    Backbone.ajax = ajax;
  });

  QUnit.test('fetch will pass extra options to success callback', function(assert) {
    assert.expect(1);
    var SpecialSyncCollection = Backbone.Collection.extend({
      url: '/test',
      sync: function(method, collection, options) {
        _.extend(options, {specialSync: true});
        return Backbone.Collection.prototype.sync.call(this, method, collection, options);
      }
    });

    var collection = new SpecialSyncCollection();

    var onSuccess = function(coll, resp, options) {
      assert.ok(options.specialSync, 'Options were passed correctly to callback');
    };

    collection.fetch({success: onSuccess});
    this.ajaxSettings.success();
  });

  QUnit.test('`add` only `sort`s when necessary', function(assert) {
    assert.expect(2);
    var collection = new (Backbone.Collection.extend({
      comparator: 'a'
    }))([{id: 1}, {id: 2}, {id: 3}]);
    collection.on('sort', function() { assert.ok(true); });
    collection.add({id: 4}); // do sort, new model
    collection.add({id: 1, a: 1}, {merge: true}); // do sort, comparator change
    collection.add({id: 1, b: 1}, {merge: true}); // don't sort, no comparator change
    collection.add({id: 1, a: 1}, {merge: true}); // don't sort, no comparator change
    collection.add(collection.models); // don't sort, nothing new
    collection.add(collection.models, {merge: true}); // don't sort
  });

  QUnit.test('`add` only `sort`s when necessary with comparator function', function(assert) {
    assert.expect(3);
    var collection = new (Backbone.Collection.extend({
      comparator: function(m1, m2) {
        return m1.get('a') > m2.get('a') ? 1 : (m1.get('a') < m2.get('a') ? -1 : 0);
      }
    }))([{id: 1}, {id: 2}, {id: 3}]);
    collection.on('sort', function() { assert.ok(true); });
    collection.add({id: 4}); // do sort, new model
    collection.add({id: 1, a: 1}, {merge: true}); // do sort, model change
    collection.add({id: 1, b: 1}, {merge: true}); // do sort, model change
    collection.add({id: 1, a: 1}, {merge: true}); // don't sort, no model change
    collection.add(collection.models); // don't sort, nothing new
    collection.add(collection.models, {merge: true}); // don't sort
  }
```

#### #3871 - falsy parse result creates empty collection

```ts
test('#3871 - falsy parse result creates empty collection', function(assert) {
    var collection = new (Backbone.Collection.extend({
      parse: function(data, options) {}
    }));
    collection.set('', {parse: true});
    assert.equal(collection.length, 0);
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/view.js

#### $

```ts
test('$', function(assert) {
    assert.expect(2);
    var myView = new Backbone.View;
    myView.setElement('<p><a><b>test</b></a></p>');
    var result = myView.$('a b');

    assert.strictEqual(result[0].innerHTML, 'test');
    assert.ok(result.length === +result.length);
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

#### should avoid non-native built-ins

```ts
test('should avoid non-native built-ins', function(assert) {
      assert.expect(6);

      function message(lodashMethod, nativeMethod) {
        return '`' + lodashMethod + '` should avoid overwritten native `' + nativeMethod + '`';
      }

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var object = { 'a': 1 },
          otherObject = { 'b': 2 },
          largeArray = lodashStable.times(LARGE_ARRAY_SIZE, lodashStable.constant(object));

      if (lodashBizarro) {
        try {
          var actual = lodashBizarro.create(Foo.prototype);
        } catch (e) {
          actual = null;
        }
        var label = message('_.create', 'Object.create');
        assert.ok(actual instanceof Foo, label);

        try {
          actual = [
            lodashBizarro.difference([object, otherObject], largeArray),
            lodashBizarro.intersection(largeArray, [object]),
            lodashBizarro.uniq(largeArray)
          ];
        } catch (e) {
          actual = null;
        }
        label = message('_.difference`, `_.intersection`, and `_.uniq', 'Map');
        assert.deepEqual(actual, [[otherObject], [object], [object]], label);

        try {
          if (Symbol) {
            object[symbol] = {};
          }
          actual = [
            lodashBizarro.clone(object),
            lodashBizarro.cloneDeep(object)
          ];
        } catch (e) {
          actual = null;
        }
        label = message('_.clone` and `_.cloneDeep', 'Object.getOwnPropertySymbols');
        assert.deepEqual(actual, [object, object], label);

        try {
          // Avoid buggy symbol detection in Babel's `_typeof` helper.
          var symObject = setProperty(Object(symbol), 'constructor', Object);
          actual = [
            Symbol ? lodashBizarro.clone(symObject) : {},
            Symbol ? lodashBizarro.isEqual(symObject, Object(symbol)) : false,
            Symbol ? lodashBizarro.toString(symObject) : ''
          ];
        } catch (e) {
          actual = null;
        }
        label = message('_.clone`, `_.isEqual`, and `_.toString', 'Symbol');
        assert.deepEqual(actual, [{}, false, ''], label);

        try {
          var map = new lodashBizarro.memoize.Cache;
          actual = map.set('a', 1).get('a');
        } catch (e) {
          actual = null;
        }
        label = message('_.memoize.Cache', 'Map');
        assert.deepEqual(actual, 1, label);

        try {
          map = new (Map || Object);
          if (Symbol && Symbol.iterator) {
            map[Symbol.iterator] = null;
          }
          actual = lodashBizarro.toArray(map);
        } catch (e) {
          actual = null;
        }
        label = message('_.toArray', 'Map');
        assert.deepEqual(actual, [], label);
      }
      else {
        skipAssert(assert, 6);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('isIndex');

  (function() {
    var func = _._isIndex;

    QUnit.test('should return `true` for indexes', function(assert) {
      assert.expect(1);

      if (func) {
        var values = [[0], ['0'], ['1'], [3, 4], [MAX_SAFE_INTEGER - 1]],
            expected = lodashStable.map(values, stubTrue);

        var actual = lodashStable.map(values, function(args) {
          return func.apply(undefined, args);
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return `false` for non-indexes', function(assert) {
      assert.expect(1);

      if (func) {
        var values = [['1abc'], ['07'], ['0001'], [-1], [3, 3], [1.1], [MAX_SAFE_INTEGER]],
            expected = lodashStable.map(values, stubFalse);

        var actual = lodashStable.map(values, function(args) {
          return func.apply(undefined, args);
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('isIterateeCall');

  (function() {
    var array = [1],
        func = _._isIterateeCall,
        object =  { 'a': 1 };

    QUnit.test('should return `true` for iteratee calls', function(assert) {
      assert.expect(3);

      function Foo() {}
      Foo.prototype.a = 1;

      if (func) {
        assert.strictEqual(func(1, 0, array), true);
        assert.strictEqual(func(1, 'a', object), true);
        assert.strictEqual(func(1, 'a', new Foo), true);
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('should return `false` for non-iteratee calls', function(assert) {
      assert.expect(4);

      if (func) {
        assert.strictEqual(func(2, 0, array), false);
        assert.strictEqual(func(1, 1.1, array), false);
        assert.strictEqual(func(1, 0, { 'length': MAX_SAFE_INTEGER + 1 }), false);
        assert.strictEqual(func(1, 'b', object), false);
      }
      else {
        skipAssert(assert, 4);
      }
    });

    QUnit.test('should work with `NaN` values', function(assert) {
      assert.expect(2);

      if (func) {
        assert.strictEqual(func(NaN, 0, [NaN]), true);
        assert.strictEqual(func(NaN, 'a', { 'a': NaN }), true);
      }
      else {
        skipAssert(assert, 2);
      }
    });

    QUnit.test('should not error when `index` is an object without a `toString` method', function(assert) {
      assert.expect(1);

      if (func) {
        try {
          var actual = func(1, { 'toString': null }, [1]);
        } catch (e) {
          var message = e.message;
        }
        assert.strictEqual(actual, false, message || '');
      }
      else {
        skipAssert(assert);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('map caches');

  (function() {
    var keys = [null, undefined, false, true, 1, -Infinity, NaN, {}, 'a', symbol || noop];

    var pairs = lodashStable.map(keys, function(key, index) {
      var lastIndex = keys.length - 1;
      return [key, keys[lastIndex - index]];
    });

    function createCaches(pairs) {
      var largeStack = new mapCaches.Stack(pairs),
          length = pairs ? pairs.length : 0;

      lodashStable.times(LARGE_ARRAY_SIZE - length, function() {
        largeStack.set({}, {});
      });

      return {
        'hashes': new mapCaches.Hash(pairs),
        'list caches': new mapCaches.ListCache(pairs),
        'map caches': new mapCaches.MapCache(pairs),
        'stack caches': new mapCaches.Stack(pairs),
        'large stacks': largeStack
      };
    }

    lodashStable.forOwn(createCaches(pairs), function(cache, kind) {
      var isLarge = /^large/.test(kind);

      QUnit.test('should implement a `Map` interface for ' + kind, function(assert) {
        assert.expect(83);

        lodashStable.each(keys, function(key, index) {
          var value = pairs[index][1];

          assert.deepEqual(cache.get(key), value);
          assert.strictEqual(cache.has(key), true);
          assert.strictEqual(cache.delete(key), true);
          assert.strictEqual(cache.has(key), false);
          assert.strictEqual(cache.get(key), undefined);
          assert.strictEqual(cache.delete(key), false);
          assert.strictEqual(cache.set(key, value), cache);
          assert.strictEqual(cache.has(key), true);
        });

        assert.strictEqual(cache.size, isLarge ? LARGE_ARRAY_SIZE : keys.length);
        assert.strictEqual(cache.clear(), undefined);
        assert.ok(lodashStable.every(keys, function(key) {
          return !cache.has(key);
        }));
      });
    });

    lodashStable.forOwn(createCaches(), function(cache, kind) {
      QUnit.test('should support changing values of ' + kind, function(assert) {
        assert.expect(10);

        lodashStable.each(keys, function(key) {
          cache.set(key, 1).set(key, 2);
          assert.strictEqual(cache.get(key), 2);
        });
      });
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash constructor');

  (function() {
    var values = empties.concat(true, 1, 'a'),
        expected = lodashStable.map(values, stubTrue);

    QUnit.test('should create a new instance when called without the `new` operator', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var actual = lodashStable.map(values, function(value) {
          return _(value) instanceof _;
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return the given `lodash` instances', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var actual = lodashStable.map(values, function(value) {
          var wrapped = _(value);
          return _(wrapped) === wrapped;
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should convert foreign wrapped values to `lodash` instances', function(assert) {
      assert.expect(1);

      if (!isNpm && lodashBizarro) {
        var actual = lodashStable.map(values, function(value) {
          var wrapped = _(lodashBizarro(value)),
              unwrapped = wrapped.value();

          return wrapped instanceof _ &&
            ((unwrapped === value) || (unwrapped !== unwrapped && value !== value));
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.add');

  (function() {
    QUnit.test('should add two numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.add(6, 4), 10);
      assert.strictEqual(_.add(-6, 4), -2);
      assert.strictEqual(_.add(-6, -4), -10);
    });

    QUnit.test('should not coerce arguments to numbers', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.add('6', '4'), '64');
      assert.strictEqual(_.add('x', 'y'), 'xy');
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.after');

  (function() {
    function after(n, times) {
      var count = 0;
      lodashStable.times(times, _.after(n, function() { count++; }));
      return count;
    }

    QUnit.test('should create a function that invokes `func` after `n` calls', function(assert) {
      assert.expect(4);

      assert.strictEqual(after(5, 5), 1, 'after(n) should invoke `func` after being called `n` times');
      assert.strictEqual(after(5, 4), 0, 'after(n) should not invoke `func` before being called `n` times');
      assert.strictEqual(after(0, 0), 0, 'after(0) should not invoke `func` immediately');
      assert.strictEqual(after(0, 1), 1, 'after(0) should invoke `func` when called once');
    });

    QUnit.test('should coerce `n` values of `NaN` to `0`', function(assert) {
      assert.expect(1);

      assert.strictEqual(after(NaN, 1), 1);
    });

    QUnit.test('should use `this` binding of function', function(assert) {
      assert.expect(2);

      var after = _.after(1, function(assert) { return ++this.count; }),
          object = { 'after': after, 'count': 0 };

      object.after();
      assert.strictEqual(object.after(), 2);
      assert.strictEqual(object.count, 2);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.ary');

  (function() {
    function fn(a, b, c) {
      return slice.call(arguments);
    }

    QUnit.test('should cap the number of arguments provided to `func`', function(assert) {
      assert.expect(2);

      var actual = lodashStable.map(['6', '8', '10'], _.ary(parseInt, 1));
      assert.deepEqual(actual, [6, 8, 10]);

      var capped = _.ary(fn, 2);
      assert.deepEqual(capped('a', 'b', 'c', 'd'), ['a', 'b']);
    });

    QUnit.test('should use `func.length` if `n` is not given', function(assert) {
      assert.expect(1);

      var capped = _.ary(fn);
      assert.deepEqual(capped('a', 'b', 'c', 'd'), ['a', 'b', 'c']);
    });

    QUnit.test('should treat a negative `n` as `0`', function(assert) {
      assert.expect(1);

      var capped = _.ary(fn, -1);

      try {
        var actual = capped('a');
      } catch (e) {}

      assert.deepEqual(actual, []);
    });

    QUnit.test('should coerce `n` to an integer', function(assert) {
      assert.expect(1);

      var values = ['1', 1.6, 'xyz'],
          expected = [['a'], ['a'], []];

      var actual = lodashStable.map(values, function(n) {
        var capped = _.ary(fn, n);
        return capped('a', 'b');
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should not force a minimum argument count', function(assert) {
      assert.expect(1);

      var args = ['a', 'b', 'c'],
          capped = _.ary(fn, 3);

      var expected = lodashStable.map(args, function(arg, index) {
        return args.slice(0, index);
      });

      var actual = lodashStable.map(expected, function(array) {
        return capped.apply(undefined, array);
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should use `this` binding of function', function(assert) {
      assert.expect(1);

      var capped = _.ary(function(a, b) { return this; }, 1),
          object = { 'capped': capped };

      assert.strictEqual(object.capped(), object);
    });

    QUnit.test('should use the existing `ary` if smaller', function(assert) {
      assert.expect(1);

      var capped = _.ary(_.ary(fn, 1), 2);
      assert.deepEqual(capped('a', 'b', 'c'), ['a']);
    });

    QUnit.test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var funcs = lodashStable.map([fn], _.ary),
          actual = funcs[0]('a', 'b', 'c');

      assert.deepEqual(actual, ['a', 'b', 'c']);
    });

    QUnit.test('should work when combined with other methods that use metadata', function(assert) {
      assert.expect(2);

      var array = ['a', 'b', 'c'],
          includes = _.curry(_.rearg(_.ary(_.includes, 2), 1, 0), 2);

      assert.strictEqual(includes('b')(array, 2), true);

      if (!isNpm) {
        includes = _(_.includes).ary(2).rearg(1, 0).curry(2).value();
        assert.strictEqual(includes('b')(array, 2), true);
      }
      else {
        skipAssert(assert);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.assignIn');

  (function() {
    QUnit.test('should be aliased', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.extend, _.assignIn);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.assign and lodash.assignIn');

  lodashStable.each(['assign', 'assignIn'], function(methodName) {
    var func = _[methodName];

    QUnit.test('`_.' + methodName + '` should assign source properties to `object`', function(assert) {
      assert.expect(1);

      assert.deepEqual(func({ 'a': 1 }, { 'b': 2 }), { 'a': 1, 'b': 2 });
    });

    QUnit.test('`_.' + methodName + '` should accept multiple sources', function(assert) {
      assert.expect(2);

      var expected = { 'a': 1, 'b': 2, 'c': 3 };
      assert.deepEqual(func({ 'a': 1 }, { 'b': 2 }, { 'c': 3 }), expected);
      assert.deepEqual(func({ 'a': 1 }, { 'b': 2, 'c': 2 }, { 'c': 3 }), expected);
    });

    QUnit.test('`_.' + methodName + '` should overwrite destination properties', function(assert) {
      assert.expect(1);

      var expected = { 'a': 3, 'b': 2, 'c': 1 };
      assert.deepEqual(func({ 'a': 1, 'b': 2 }, expected), expected);
    });

    QUnit.test('`_.' + methodName + '` should assign source properties with nullish values', function(assert) {
      assert.expect(1);

      var expected = { 'a': null, 'b': undefined, 'c': null };
      assert.deepEqual(func({ 'a': 1, 'b': 2 }, expected), expected);
    });

    QUnit.test('`_.' + methodName + '` should skip assignments if values are the same', function(assert) {
      assert.expect(1);

      var object = {};

      var descriptor = {
        'configurable': true,
        'enumerable': true,
        'set': function() { throw new Error; }
      };

      var source = {
        'a': 1,
        'b': undefined,
        'c': NaN,
        'd': undefined,
        'constructor': Object,
        'toString': lodashStable.constant('source')
      };

      defineProperty(object, 'a', lodashStable.assign({}, descriptor, {
        'get': stubOne
      }));

      defineProperty(object, 'b', lodashStable.assign({}, descriptor, {
        'get': noop
      }));

      defineProperty(object, 'c', lodashStable.assign({}, descriptor, {
        'get': stubNaN
      }));

      defineProperty(object, 'constructor', lodashStable.assign({}, descriptor, {
        'get': lodashStable.constant(Object)
      }));

      try {
        var actual = func(object, source);
      } catch (e) {}

      assert.deepEqual(actual, source);
    });

    QUnit.test('`_.' + methodName + '` should treat sparse array sources as dense', function(assert) {
      assert.expect(1);

      var array = [1];
      array[2] = 3;

      assert.deepEqual(func({}, array), { '0': 1, '1': undefined, '2': 3 });
    });

    QUnit.test('`_.' + methodName + '` should assign values of prototype objects', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.prototype.a = 1;

      assert.deepEqual(func({}, Foo.prototype), { 'a': 1 });
    });

    QUnit.test('`_.' + methodName + '` should coerce string sources to objects', function(assert) {
      assert.expect(1);

      assert.deepEqual(func({}, 'a'), { '0': 'a' });
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.assignInWith');

  (function() {
    QUnit.test('should be aliased', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.extendWith, _.assignInWith);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.assignWith and lodash.assignInWith');

  lodashStable.each(['assignWith', 'assignInWith'], function(methodName) {
    var func = _[methodName];

    QUnit.test('`_.' + methodName + '` should work with a `customizer` callback', function(assert) {
      assert.expect(1);

      var actual = func({ 'a': 1, 'b': 2 }, { 'a': 3, 'c': 3 }, function(a, b) {
        return a === undefined ? b : a;
      });

      assert.deepEqual(actual, { 'a': 1, 'b': 2, 'c': 3 });
    });

    QUnit.test('`_.' + methodName + '` should work with a `customizer` that returns `undefined`', function(assert) {
      assert.expect(1);

      var expected = { 'a': 1 };
      assert.deepEqual(func({}, expected, noop), expected);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.at');

  (function() {
    var array = ['a', 'b', 'c'],
        object = { 'a': [{ 'b': { 'c': 3 } }, 4] };

    QUnit.test('should return the elements corresponding to the specified keys', function(assert) {
      assert.expect(1);

      var actual = _.at(array, [0, 2]);
      assert.deepEqual(actual, ['a', 'c']);
    });

    QUnit.test('should return `undefined` for nonexistent keys', function(assert) {
      assert.expect(1);

      var actual = _.at(array, [2, 4, 0]);
      assert.deepEqual(actual, ['c', undefined, 'a']);
    });

    QUnit.test('should work with non-index keys on array values', function(assert) {
      assert.expect(1);

      var values = lodashStable.reject(empties, function(value) {
        return (value === 0) || lodashStable.isArray(value);
      }).concat(-1, 1.1);

      var array = lodashStable.transform(values, function(result, value) {
        result[value] = 1;
      }, []);

      var expected = lodashStable.map(values, stubOne),
          actual = _.at(array, values);

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should return an empty array when no keys are given', function(assert) {
      assert.expect(2);

      assert.deepEqual(_.at(array), []);
      assert.deepEqual(_.at(array, [], []), []);
    });

    QUnit.test('should accept multiple key arguments', function(assert) {
      assert.expect(1);

      var actual = _.at(['a', 'b', 'c', 'd'], 3, 0, 2);
      assert.deepEqual(actual, ['d', 'a', 'c']);
    });

    QUnit.test('should work with a falsey `object` when keys are given', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, lodashStable.constant(Array(4)));

      var actual = lodashStable.map(falsey, function(object) {
        try {
          return _.at(object, 0, 1, 'pop', 'push');
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should work with an `arguments` object for `object`', function(assert) {
      assert.expect(1);

      var actual = _.at(args, [2, 0]);
      assert.deepEqual(actual, [3, 1]);
    });

    QUnit.test('should work with `arguments` object as secondary arguments', function(assert) {
      assert.expect(1);

      var actual = _.at([1, 2, 3, 4, 5], args);
      assert.deepEqual(actual, [2, 3, 4]);
    });

    QUnit.test('should work with an object for `object`', function(assert) {
      assert.expect(1);

      var actual = _.at(object, ['a[0].b.c', 'a[1]']);
      assert.deepEqual(actual, [3, 4]);
    });

    QUnit.test('should pluck inherited property values', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var actual = _.at(new Foo, 'b');
      assert.deepEqual(actual, [2]);
    });

    QUnit.test('should work in a lazy sequence', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        var largeArray = lodashStable.range(LARGE_ARRAY_SIZE),
            smallArray = array;

        lodashStable.each([[2], ['2'], [2, 1]], function(paths) {
          lodashStable.times(2, function(index) {
            var array = index ? largeArray : smallArray,
                wrapped = _(array).map(identity).at(paths);

            assert.deepEqual(wrapped.value(), _.at(_.map(array, identity), paths));
          });
        });
      }
      else {
        skipAssert(assert, 6);
      }
    });

    QUnit.test('should support shortcut fusion', function(assert) {
      assert.expect(8);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            count = 0,
            iteratee = function(value) { count++; return square(value); },
            lastIndex = LARGE_ARRAY_SIZE - 1;

        lodashStable.each([lastIndex, lastIndex + '', LARGE_ARRAY_SIZE, []], function(n, index) {
          count = 0;
          var actual = _(array).map(iteratee).at(n).value(),
              expected = index < 2 ? 1 : 0;

          assert.strictEqual(count, expected);

          expected = index == 3 ? [] : [index == 2 ? undefined : square(lastIndex)];
          assert.deepEqual(actual, expected);
        });
      }
      else {
        skipAssert(assert, 8);
      }
    });

    QUnit.test('work with an object for `object` when chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var paths = ['a[0].b.c', 'a[1]'],
            actual = _(object).map(identity).at(paths).value();

        assert.deepEqual(actual, _.at(_.map(object, identity), paths));

        var indexObject = { '0': 1 };
        actual = _(indexObject).at(0).value();
        assert.deepEqual(actual, _.at(indexObject, 0));
      }
      else {
        skipAssert(assert, 2);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.attempt');

  (function() {
    QUnit.test('should return the result of `func`', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.attempt(lodashStable.constant('x')), 'x');
    });

    QUnit.test('should provide additional arguments to `func`', function(assert) {
      assert.expect(1);

      var actual = _.attempt(function() { return slice.call(arguments); }, 1, 2);
      assert.deepEqual(actual, [1, 2]);
    });

    QUnit.test('should return the caught error', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(errors, stubTrue);

      var actual = lodashStable.map(errors, function(error) {
        return _.attempt(function() { throw error; }) === error;
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should coerce errors to error objects', function(assert) {
      assert.expect(1);

      var actual = _.attempt(function() { throw 'x'; });
      assert.ok(lodashStable.isEqual(actual, Error('x')));
    });

    QUnit.test('should preserve custom errors', function(assert) {
      assert.expect(1);

      var actual = _.attempt(function() { throw new CustomError('x'); });
      assert.ok(actual instanceof CustomError);
    });

    QUnit.test('should work with an error object from another realm', function(assert) {
      assert.expect(1);

      if (realm.errors) {
        var expected = lodashStable.map(realm.errors, stubTrue);

        var actual = lodashStable.map(realm.errors, function(error) {
          return _.attempt(function() { throw error; }) === error;
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.strictEqual(_(lodashStable.constant('x')).attempt(), 'x');
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(lodashStable.constant('x')).chain().attempt() instanceof _);
      }
      else {
        skipAssert(assert);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.before');

  (function() {
    function before(n, times) {
      var count = 0;
      lodashStable.times(times, _.before(n, function() { count++; }));
      return count;
    }

    QUnit.test('should create a function that invokes `func` after `n` calls', function(assert) {
      assert.expect(4);

      assert.strictEqual(before(5, 4), 4, 'before(n) should invoke `func` before being called `n` times');
      assert.strictEqual(before(5, 6), 4, 'before(n) should not invoke `func` after being called `n - 1` times');
      assert.strictEqual(before(0, 0), 0, 'before(0) should not invoke `func` immediately');
      assert.strictEqual(before(0, 1), 0, 'before(0) should not invoke `func` when called');
    });

    QUnit.test('should coerce `n` values of `NaN` to `0`', function(assert) {
      assert.expect(1);

      assert.strictEqual(before(NaN, 1), 0);
    });

    QUnit.test('should use `this` binding of function', function(assert) {
      assert.expect(2);

      var before = _.before(2, function(assert) { return ++this.count; }),
          object = { 'before': before, 'count': 0 };

      object.before();
      assert.strictEqual(object.before(), 1);
      assert.strictEqual(object.count, 1);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.bind');

  (function() {
    function fn() {
      var result = [this];
      push.apply(result, arguments);
      return result;
    }

    QUnit.test('should bind a function to an object', function(assert) {
      assert.expect(1);

      var object = {},
          bound = _.bind(fn, object);

      assert.deepEqual(bound('a'), [object, 'a']);
    });

    QUnit.test('should accept a falsey `thisArg`', function(assert) {
      assert.expect(1);

      var values = lodashStable.reject(falsey.slice(1), function(value) { return value == null; }),
          expected = lodashStable.map(values, function(value) { return [value]; });

      var actual = lodashStable.map(values, function(value) {
        try {
          var bound = _.bind(fn, value);
          return bound();
        } catch (e) {}
      });

      assert.ok(lodashStable.every(actual, function(value, index) {
        return lodashStable.isEqual(value, expected[index]);
      }));
    });

    QUnit.test('should bind a function to nullish values', function(assert) {
      assert.expect(6);

      var bound = _.bind(fn, null),
          actual = bound('a');

      assert.ok((actual[0] === null) || (actual[0] && actual[0].Array));
      assert.strictEqual(actual[1], 'a');

      lodashStable.times(2, function(index) {
        bound = index ? _.bind(fn, undefined) : _.bind(fn);
        actual = bound('b');

        assert.ok((actual[0] === undefined) || (actual[0] && actual[0].Array));
        assert.strictEqual(actual[1], 'b');
      });
    });

    QUnit.test('should partially apply arguments ', function(assert) {
      assert.expect(4);

      var object = {},
          bound = _.bind(fn, object, 'a');

      assert.deepEqual(bound(), [object, 'a']);

      bound = _.bind(fn, object, 'a');
      assert.deepEqual(bound('b'), [object, 'a', 'b']);

      bound = _.bind(fn, object, 'a', 'b');
      assert.deepEqual(bound(), [object, 'a', 'b']);
      assert.deepEqual(bound('c', 'd'), [object, 'a', 'b', 'c', 'd']);
    });

    QUnit.test('should support placeholders', function(assert) {
      assert.expect(4);

      var object = {},
          ph = _.bind.placeholder,
          bound = _.bind(fn, object, ph, 'b', ph);

      assert.deepEqual(bound('a', 'c'), [object, 'a', 'b', 'c']);
      assert.deepEqual(bound('a'), [object, 'a', 'b', undefined]);
      assert.deepEqual(bound('a', 'c', 'd'), [object, 'a', 'b', 'c', 'd']);
      assert.deepEqual(bound(), [object, undefined, 'b', undefined]);
    });

    QUnit.test('should use `_.placeholder` when set', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        var _ph = _.placeholder = {},
            ph = _.bind.placeholder,
            object = {},
            bound = _.bind(fn, object, _ph, 'b', ph);

        assert.deepEqual(bound('a', 'c'), [object, 'a', 'b', ph, 'c']);
        delete _.placeholder;
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should create a function with a `length` of `0`', function(assert) {
      assert.expect(2);

      var fn = function(a, b, c) {},
          bound = _.bind(fn, {});

      assert.strictEqual(bound.length, 0);

      bound = _.bind(fn, {}, 1);
      assert.strictEqual(bound.length, 0);
    });

    QUnit.test('should ignore binding when called with the `new` operator', function(assert) {
      assert.expect(3);

      function Foo() {
        return this;
      }

      var bound = _.bind(Foo, { 'a': 1 }),
          newBound = new bound;

      assert.strictEqual(bound().a, 1);
      assert.strictEqual(newBound.a, undefined);
      assert.ok(newBound instanceof Foo);
    });

    QUnit.test('should handle a number of arguments when called with the `new` operator', function(assert) {
      assert.expect(1);

      function Foo() {
        return this;
      }

      function Bar() {}

      var thisArg = { 'a': 1 },
          boundFoo = _.bind(Foo, thisArg),
          boundBar = _.bind(Bar, thisArg),
          count = 9,
          expected = lodashStable.times(count, lodashStable.constant([undefined, undefined]));

      var actual = lodashStable.times(count, function(index) {
        try {
          switch (index) {
            case 0: return [new boundFoo().a, new boundBar().a];
            case 1: return [new boundFoo(1).a, new boundBar(1).a];
            case 2: return [new boundFoo(1, 2).a, new boundBar(1, 2).a];
            case 3: return [new boundFoo(1, 2, 3).a, new boundBar(1, 2, 3).a];
            case 4: return [new boundFoo(1, 2, 3, 4).a, new boundBar(1, 2, 3, 4).a];
            case 5: return [new boundFoo(1, 2, 3, 4, 5).a, new boundBar(1, 2, 3, 4, 5).a];
            case 6: return [new boundFoo(1, 2, 3, 4, 5, 6).a, new boundBar(1, 2, 3, 4, 5, 6).a];
            case 7: return [new boundFoo(1, 2, 3, 4, 5, 6, 7).a, new boundBar(1, 2, 3, 4, 5, 6, 7).a];
            case 8: return [new boundFoo(1, 2, 3, 4, 5, 6, 7, 8).a, new boundBar(1, 2, 3, 4, 5, 6, 7, 8).a];
          }
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should ensure `new bound` is an instance of `func`', function(assert) {
      assert.expect(2);

      function Foo(value) {
        return value && object;
      }

      var bound = _.bind(Foo),
          object = {};

      assert.ok(new bound instanceof Foo);
      assert.strictEqual(new bound(true), object);
    });

    QUnit.test('should append array arguments to partially applied arguments', function(assert) {
      assert.expect(1);

      var object = {},
          bound = _.bind(fn, object, 'a');

      assert.deepEqual(bound(['b'], 'c'), [object, 'a', ['b'], 'c']);
    });

    QUnit.test('should not rebind functions', function(assert) {
      assert.expect(3);

      var object1 = {},
          object2 = {},
          object3 = {};

      var bound1 = _.bind(fn, object1),
          bound2 = _.bind(bound1, object2, 'a'),
          bound3 = _.bind(bound1, object3, 'b');

      assert.deepEqual(bound1(), [object1]);
      assert.deepEqual(bound2(), [object1, 'a']);
      assert.deepEqual(bound3(), [object1, 'b']);
    });

    QUnit.test('should not error when instantiating bound built-ins', function(assert) {
      assert.expect(2);

      var Ctor = _.bind(Date, null),
          expected = new Date(2012, 4, 23, 0, 0, 0, 0);

      try {
        var actual = new Ctor(2012, 4, 23, 0, 0, 0, 0);
      } catch (e) {}

      assert.deepEqual(actual, expected);

      Ctor = _.bind(Date, null, 2012, 4, 23);

      try {
        actual = new Ctor(0, 0, 0, 0);
      } catch (e) {}

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should not error when calling bound class constructors with the `new` operator', function(assert) {
      assert.expect(1);

      var createCtor = lodashStable.attempt(Function, '"use strict";return class A{}');

      if (typeof createCtor == 'function') {
        var bound = _.bind(createCtor()),
            count = 8,
            expected = lodashStable.times(count, stubTrue);

        var actual = lodashStable.times(count, function(index) {
          try {
            switch (index) {
              case 0: return !!(new bound);
              case 1: return !!(new bound(1));
              case 2: return !!(new bound(1, 2));
              case 3: return !!(new bound(1, 2, 3));
              case 4: return !!(new bound(1, 2, 3, 4));
              case 5: return !!(new bound(1, 2, 3, 4, 5));
              case 6: return !!(new bound(1, 2, 3, 4, 5, 6));
              case 7: return !!(new bound(1, 2, 3, 4, 5, 6, 7));
            }
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return a wrapped value when chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var object = {},
            bound = _(fn).bind({}, 'a', 'b');

        assert.ok(bound instanceof _);

        var actual = bound.value()('c');
        assert.deepEqual(actual, [object, 'a', 'b', 'c']);
      }
      else {
        skipAssert(assert, 2);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.bindAll');

  (function() {
    var args = toArgs(['a']);

    var source = {
      '_n0': -2,
      '_p0': -1,
      '_a': 1,
      '_b': 2,
      '_c': 3,
      '_d': 4,
      '-0': function() { return this._n0; },
      '0': function() { return this._p0; },
      'a': function() { return this._a; },
      'b': function() { return this._b; },
      'c': function() { return this._c; },
      'd': function() { return this._d; }
    };

    QUnit.test('should accept individual method names', function(assert) {
      assert.expect(1);

      var object = lodashStable.cloneDeep(source);
      _.bindAll(object, 'a', 'b');

      var actual = lodashStable.map(['a', 'b', 'c'], function(key) {
        return object[key].call({});
      });

      assert.deepEqual(actual, [1, 2, undefined]);
    });

    QUnit.test('should accept arrays of method names', function(assert) {
      assert.expect(1);

      var object = lodashStable.cloneDeep(source);
      _.bindAll(object, ['a', 'b'], ['c']);

      var actual = lodashStable.map(['a', 'b', 'c', 'd'], function(key) {
        return object[key].call({});
      });

      assert.deepEqual(actual, [1, 2, 3, undefined]);
    });

    QUnit.test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var props = [-0, Object(-0), 0, Object(0)];

      var actual = lodashStable.map(props, function(key) {
        var object = lodashStable.cloneDeep(source);
        _.bindAll(object, key);
        return object[lodashStable.toString(key)].call({});
      });

      assert.deepEqual(actual, [-2, -2, -1, -1]);
    });

    QUnit.test('should work with an array `object`', function(assert) {
      assert.expect(1);

      var array = ['push', 'pop'];
      _.bindAll(array);
      assert.strictEqual(array.pop, arrayProto.pop);
    });

    QUnit.test('should work with `arguments` objects as secondary arguments', function(assert) {
      assert.expect(1);

      var object = lodashStable.cloneDeep(source);
      _.bindAll(object, args);

      var actual = lodashStable.map(args, function(key) {
        return object[key].call({});
      });

      assert.deepEqual(actual, [1]);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.bindKey');

  (function() {
    QUnit.test('should work when the target function is overwritten', function(assert) {
      assert.expect(2);

      var object = {
        'user': 'fred',
        'greet': function(greeting) {
          return this.user + ' says: ' + greeting;
        }
      };

      var bound = _.bindKey(object, 'greet', 'hi');
      assert.strictEqual(bound(), 'fred says: hi');

      object.greet = function(greeting) {
        return this.user + ' says: ' + greeting + '!';
      };

      assert.strictEqual(bound(), 'fred says: hi!');
    });

    QUnit.test('should support placeholders', function(assert) {
      assert.expect(4);

      var object = {
        'fn': function() {
          return slice.call(arguments);
        }
      };

      var ph = _.bindKey.placeholder,
          bound = _.bindKey(object, 'fn', ph, 'b', ph);

      assert.deepEqual(bound('a', 'c'), ['a', 'b', 'c']);
      assert.deepEqual(bound('a'), ['a', 'b', undefined]);
      assert.deepEqual(bound('a', 'c', 'd'), ['a', 'b', 'c', 'd']);
      assert.deepEqual(bound(), [undefined, 'b', undefined]);
    });

    QUnit.test('should use `_.placeholder` when set', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        var object = {
          'fn': function() {
            return slice.call(arguments);
          }
        };

        var _ph = _.placeholder = {},
            ph = _.bindKey.placeholder,
            bound = _.bindKey(object, 'fn', _ph, 'b', ph);

        assert.deepEqual(bound('a', 'c'), ['a', 'b', ph, 'c']);
        delete _.placeholder;
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should ensure `new bound` is an instance of `object[key]`', function(assert) {
      assert.expect(2);

      function Foo(value) {
        return value && object;
      }

      var object = { 'Foo': Foo },
          bound = _.bindKey(object, 'Foo');

      assert.ok(new bound instanceof Foo);
      assert.strictEqual(new bound(true), object);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('case methods');

  lodashStable.each(['camel', 'kebab', 'lower', 'snake', 'start', 'upper'], function(caseName) {
    var methodName = caseName + 'Case',
        func = _[methodName];

    var strings = [
      'foo bar', 'Foo bar', 'foo Bar', 'Foo Bar',
      'FOO BAR', 'fooBar', '--foo-bar--', '__foo_bar__'
    ];

    var converted = (function() {
      switch (caseName) {
        case 'camel': return 'fooBar';
        case 'kebab': return 'foo-bar';
        case 'lower': return 'foo bar';
        case 'snake': return 'foo_bar';
        case 'start': return 'Foo Bar';
        case 'upper': return 'FOO BAR';
      }
    }());

    QUnit.test('`_.' + methodName + '` should convert `string` to ' + caseName + ' case', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(strings, function(string) {
        var expected = (caseName == 'start' && string == 'FOO BAR') ? string : converted;
        return func(string) === expected;
      });

      assert.deepEqual(actual, lodashStable.map(strings, stubTrue));
    });

    QUnit.test('`_.' + methodName + '` should handle double-converting strings', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(strings, function(string) {
        var expected = (caseName == 'start' && string == 'FOO BAR') ? string : converted;
        return func(func(string)) === expected;
      });

      assert.deepEqual(actual, lodashStable.map(strings, stubTrue));
    });

    QUnit.test('`_.' + methodName + '` should deburr letters', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(burredLetters, function(burred, index) {
        var letter = deburredLetters[index].replace(/['\u2019]/g, '');
        if (caseName == 'start') {
          letter = letter == 'IJ' ? letter : lodashStable.capitalize(letter);
        } else if (caseName == 'upper') {
          letter = letter.toUpperCase();
        } else {
          letter = letter.toLowerCase();
        }
        return func(burred) === letter;
      });

      assert.deepEqual(actual, lodashStable.map(burredLetters, stubTrue));
    });

    QUnit.test('`_.' + methodName + '` should remove contraction apostrophes', function(assert) {
      assert.expect(2);

      var postfixes = ['d', 'll', 'm', 're', 's', 't', 've'];

      lodashStable.each(["'", '\u2019'], function(apos) {
        var actual = lodashStable.map(postfixes, function(postfix) {
          return func('a b' + apos + postfix +  ' c');
        });

        var expected = lodashStable.map(postfixes, function(postfix) {
          switch (caseName) {
            case 'camel': return 'aB'  + postfix + 'C';
            case 'kebab': return 'a-b' + postfix + '-c';
            case 'lower': return 'a b' + postfix + ' c';
            case 'snake': return 'a_b' + postfix + '_c';
            case 'start': return 'A B' + postfix + ' C';
            case 'upper': return 'A B' + postfix.toUpperCase() + ' C';
          }
        });

        assert.deepEqual(actual, expected);
      });
    });

    QUnit.test('`_.' + methodName + '` should remove Latin mathematical operators', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(['\xd7', '\xf7'], func);
      assert.deepEqual(actual, ['', '']);
    });

    QUnit.test('`_.' + methodName + '` should coerce `string` to a string', function(assert) {
      assert.expect(2);

      var string = 'foo bar';
      assert.strictEqual(func(Object(string)), converted);
      assert.strictEqual(func({ 'toString': lodashStable.constant(string) }), converted);
    });

    QUnit.test('`_.' + methodName + '` should return an unwrapped value implicitly when chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.strictEqual(_('foo bar')[methodName](), converted);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('`_.' + methodName + '` should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_('foo bar').chain()[methodName]() instanceof _);
      }
      else {
        skipAssert(assert);
      }
    });
  }
```

#### should get the original value after cycling through all case methods

```ts
test('should get the original value after cycling through all case methods', function(assert) {
      assert.expect(1);

      var funcs = [_.camelCase, _.kebabCase, _.lowerCase, _.snakeCase, _.startCase, _.lowerCase, _.camelCase];

      var actual = lodashStable.reduce(funcs, function(result, func) {
        return func(result);
      }, 'enable 6h format');

      assert.strictEqual(actual, 'enable6HFormat');
    }
```

#### `_.' + methodName + '` should create an object from the same realm as `value`

```ts
test('`_.' + methodName + '` should create an object from the same realm as `value`', function(assert) {
        assert.expect(1);

        var props = [];

        var objects = lodashStable.transform(_, function(result, value, key) {
          if (lodashStable.startsWith(key, '_') && lodashStable.isObject(value) &&
              !lodashStable.isArguments(value) && !lodashStable.isElement(value) &&
              !lodashStable.isFunction(value)) {
            props.push(lodashStable.capitalize(lodashStable.camelCase(key)));
            result.push(value);
          }
        }, []);

        var expected = lodashStable.map(objects, stubTrue);

        var actual = lodashStable.map(objects, function(object) {
          var Ctor = object.constructor,
              result = func(object);

          return result !== object && ((result instanceof Ctor) || !(new Ctor instanceof Ctor));
        });

        assert.deepEqual(actual, expected, props.join(', '));
      }
```

#### should create a function that returns `value`

```ts
test('should create a function that returns `value`', function(assert) {
      assert.expect(1);

      var object = { 'a': 1 },
          values = Array(2).concat(empties, true, 1, 'a'),
          constant = _.constant(object);

      var results = lodashStable.map(values, function(value, index) {
        if (index < 2) {
          return index ? constant.call({}) : constant();
        }
        return constant(value);
      });

      assert.ok(lodashStable.every(results, function(result) {
        return result === object;
      }));
    }
```

#### should work with falsey values

```ts
test('should work with falsey values', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubTrue);

      var actual = lodashStable.map(falsey, function(value, index) {
        var constant = index ? _.constant(value) : _.constant(),
            result = constant();

        return (result === value) || (result !== result && value !== value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should debounce a function

```ts
test('should debounce a function', function(assert) {
      assert.expect(6);

      var done = assert.async();

      var callCount = 0;

      var debounced = _.debounce(function(value) {
        ++callCount;
        return value;
      }, 32);

      var results = [debounced('a'), debounced('b'), debounced('c')];
      assert.deepEqual(results, [undefined, undefined, undefined]);
      assert.strictEqual(callCount, 0);

      setTimeout(function() {
        assert.strictEqual(callCount, 1);

        var results = [debounced('d'), debounced('e'), debounced('f')];
        assert.deepEqual(results, ['c', 'c', 'c']);
        assert.strictEqual(callCount, 1);
      }, 128);

      setTimeout(function() {
        assert.strictEqual(callCount, 2);
        done();
      }, 256);
    }
```

#### subsequent debounced calls return the last `func` result

```ts
test('subsequent debounced calls return the last `func` result', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var debounced = _.debounce(identity, 32);
      debounced('a');

      setTimeout(function() {
        assert.notEqual(debounced('b'), 'b');
      }, 64);

      setTimeout(function() {
        assert.notEqual(debounced('c'), 'c');
        done();
      }, 128);
    }
```

#### subsequent leading debounced calls return the last `func` result

```ts
test('subsequent leading debounced calls return the last `func` result', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var debounced = _.debounce(identity, 32, { 'leading': true, 'trailing': false }),
          results = [debounced('a'), debounced('b')];

      assert.deepEqual(results, ['a', 'a']);

      setTimeout(function() {
        var results = [debounced('c'), debounced('d')];
        assert.deepEqual(results, ['c', 'c']);
        done();
      }, 64);
    }
```

#### `_.' + methodName + '` should work with ' + key + ' and a `fromIndex` >= `length`

```ts
test('`_.' + methodName + '` should work with ' + key + ' and a `fromIndex` >= `length`', function(assert) {
        assert.expect(1);

        var indexes = [4, 6, Math.pow(2, 32), Infinity];

        var expected = lodashStable.map(indexes, function() {
          var result = isIncludes ? false : undefined;
          return [result, result, result];
        });

        var actual = lodashStable.map(indexes, function(fromIndex) {
          return [
            func(collection, resolve(1), fromIndex),
            func(collection, resolve(undefined), fromIndex),
            func(collection, resolve(''), fromIndex)
          ];
        });

        assert.deepEqual(actual, expected);
      }
```

#### `_.' + methodName + '` should use `isArrayLike` to determine whether a value is array-like

```ts
test('`_.' + methodName + '` should use `isArrayLike` to determine whether a value is array-like', function(assert) {
        assert.expect(3);

        if (func) {
          var isIteratedAsObject = function(object) {
            var result = false;
            func(object, function() { result = true; }, 0);
            return result;
          };

          var values = [-1, '1', 1.1, Object(1), MAX_SAFE_INTEGER + 1],
              expected = lodashStable.map(values, stubTrue);

          var actual = lodashStable.map(values, function(length) {
            return isIteratedAsObject({ 'length': length });
          });

          var Foo = function(a) {};
          Foo.a = 1;

          assert.deepEqual(actual, expected);
          assert.ok(isIteratedAsObject(Foo));
          assert.notOk(isIteratedAsObject({ 'length': 0 }));
        }
        else {
          skipAssert(assert, 3);
        }
      }
```

#### should treat "__proto__" as a regular key in assignments

```ts
test('should treat "__proto__" as a regular key in assignments', function(assert) {
      assert.expect(2);

      var methods = [
        'assign',
        'assignIn',
        'defaults',
        'defaultsDeep',
        'merge'
      ];

      var source = create(null);
      source.__proto__ = [];

      var expected = lodashStable.map(methods, stubFalse);

      var actual = lodashStable.map(methods, function(methodName) {
        var result = _[methodName]({}, source);
        return result instanceof Array;
      });

      assert.deepEqual(actual, expected);

      actual = _.groupBy([{ 'a': '__proto__' }], 'a');
      assert.notOk(actual instanceof Array);
    }
```

#### should work with functions created by `_.partial` and `_.partialRight`

```ts
test('should work with functions created by `_.partial` and `_.partialRight`', function(assert) {
      assert.expect(2);

      var fn = function() {
        var result = [this.a];
        push.apply(result, arguments);
        return result;
      };

      var expected = [1, 2, 3],
          object = { 'a': 1 , 'iteratee': _.iteratee(_.partial(fn, 2)) };

      assert.deepEqual(object.iteratee(3), expected);

      object.iteratee = _.iteratee(_.partialRight(fn, 3));
      assert.deepEqual(object.iteratee(2), expected);
    }
```

#### `_.transform` should use `_.iteratee` internally

```ts
test('`_.transform` should use `_.iteratee` internally', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        _.iteratee = function() {
          return function(result, object) {
            result.sum += object.a;
          };
        };

        assert.deepEqual(_.transform(objects, undefined, { 'sum': 0 }), { 'sum': 2 });
        _.iteratee = iteratee;
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should return keys for custom properties on `arguments` objects

```ts
test('`_.' + methodName + '` should return keys for custom properties on `arguments` objects', function(assert) {
      assert.expect(1);

      var values = [args, strictArgs],
          expected = lodashStable.map(values, lodashStable.constant(['0', '1', '2', 'a']));

      var actual = lodashStable.map(values, function(value) {
        value.a = 1;
        var result = func(value).sort();
        delete value.a;
        return result;
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of `arguments` objects

```ts
test('`_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of `arguments` objects', function(assert) {
      assert.expect(1);

      var values = [args, strictArgs],
          expected = lodashStable.map(values, lodashStable.constant(isKeys ? ['0', '1', '2'] : ['0', '1', '2', 'a']));

      var actual = lodashStable.map(values, function(value) {
        objectProto.a = 1;
        var result = func(value).sort();
        delete objectProto.a;
        return result;
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should coerce primitives to objects (test in IE 9)

```ts
test('`_.' + methodName + '` should coerce primitives to objects (test in IE 9)', function(assert) {
      assert.expect(2);

      var expected = lodashStable.map(primitives, function(value) {
        return typeof value == 'string' ? ['0'] : [];
      });

      var actual = lodashStable.map(primitives, func);
      assert.deepEqual(actual, expected);

      // IE 9 doesn't box numbers in for-in loops.
      numberProto.a = 1;
      assert.deepEqual(func(0), isKeys ? [] : ['a']);
      delete numberProto.a;
    });

    QUnit.test('`_.' + methodName + '` skips the `constructor` property on prototype objects', function(assert) {
      assert.expect(3);

      function Foo() {}
      Foo.prototype.a = 1;

      var expected = ['a'];
      assert.deepEqual(func(Foo.prototype), expected);

      Foo.prototype = { 'constructor': Foo, 'a': 1 };
      assert.deepEqual(func(Foo.prototype), expected);

      var Fake = { 'prototype': {} };
      Fake.prototype.constructor = Fake;
      assert.deepEqual(func(Fake.prototype), ['constructor']);
    });

    QUnit.test('`_.' + methodName + '` should return an empty array when `object` is nullish', function(assert) {
      var values = [, null, undefined],
          expected = lodashStable.map(values, stubArray);

      var actual = lodashStable.map(values, function(value, index) {
        objectProto.a = 1;
        var result = index ? func(value) : func();
        delete objectProto.a;
        return result;
      });

      assert.deepEqual(actual, expected);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.last');

  (function() {
    var array = [1, 2, 3, 4];

    QUnit.test('should return the last element', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.last(array), 4);
    });

    QUnit.test('should return `undefined` when querying empty arrays', function(assert) {
      assert.expect(1);

      var array = [];
      array['-1'] = 1;

      assert.strictEqual(_.last([]), undefined);
    });

    QUnit.test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
          actual = lodashStable.map(array, _.last);

      assert.deepEqual(actual, [3, 6, 9]);
    });

    QUnit.test('should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.strictEqual(_(array).last(), 4);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(array).chain().last() instanceof _);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should not execute immediately when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _(array).chain().last();
        assert.strictEqual(wrapped.__wrapped__, array);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should work in a lazy sequence', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var largeArray = lodashStable.range(LARGE_ARRAY_SIZE),
            smallArray = array;

        lodashStable.times(2, function(index) {
          var array = index ? largeArray : smallArray,
              wrapped = _(array).filter(isEven);

          assert.strictEqual(wrapped.last(), _.last(_.filter(array, isEven)));
        });
      }
      else {
        skipAssert(assert, 2);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.lowerCase');

  (function() {
    QUnit.test('should lowercase as space-separated words', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.lowerCase('--Foo-Bar--'), 'foo bar');
      assert.strictEqual(_.lowerCase('fooBar'), 'foo bar');
      assert.strictEqual(_.lowerCase('__FOO_BAR__'), 'foo bar');
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.lowerFirst');

  (function() {
    QUnit.test('should lowercase only the first character', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.lowerFirst('fred'), 'fred');
      assert.strictEqual(_.lowerFirst('Fred'), 'fred');
      assert.strictEqual(_.lowerFirst('FRED'), 'fRED');
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.lt');

  (function() {
    QUnit.test('should return `true` if `value` is less than `other`', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.lt(1, 3), true);
      assert.strictEqual(_.lt('abc', 'def'), true);
    });

    QUnit.test('should return `false` if `value` >= `other`', function(assert) {
      assert.expect(4);

      assert.strictEqual(_.lt(3, 1), false);
      assert.strictEqual(_.lt(3, 3), false);
      assert.strictEqual(_.lt('def', 'abc'), false);
      assert.strictEqual(_.lt('def', 'def'), false);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.lte');

  (function() {
    QUnit.test('should return `true` if `value` is <= `other`', function(assert) {
      assert.expect(4);

      assert.strictEqual(_.lte(1, 3), true);
      assert.strictEqual(_.lte(3, 3), true);
      assert.strictEqual(_.lte('abc', 'def'), true);
      assert.strictEqual(_.lte('def', 'def'), true);
    });

    QUnit.test('should return `false` if `value` > `other`', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.lt(3, 1), false);
      assert.strictEqual(_.lt('def', 'abc'), false);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.findLastIndex and lodash.lastIndexOf');

  lodashStable.each(['findLastIndex', 'lastIndexOf'], function(methodName) {
    var array = [1, 2, 3, 1, 2, 3],
        func = _[methodName],
        resolve = methodName == 'findLastIndex' ? lodashStable.curry(lodashStable.eq) : identity;

    QUnit.test('`_.' + methodName + '` should return the index of the last matched value', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(array, resolve(3)), 5);
    });

    QUnit.test('`_.' + methodName + '` should work with a positive `fromIndex`', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(array, resolve(1), 2), 0);
    });

    QUnit.test('`_.' + methodName + '` should work with a `fromIndex` >= `length`', function(assert) {
      assert.expect(1);

      var values = [6, 8, Math.pow(2, 32), Infinity],
          expected = lodashStable.map(values, lodashStable.constant([-1, 3, -1]));

      var actual = lodashStable.map(values, function(fromIndex) {
        return [
          func(array, resolve(undefined), fromIndex),
          func(array, resolve(1), fromIndex),
          func(array, resolve(''), fromIndex)
        ];
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should work with a negative `fromIndex`', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(array, resolve(2), -3), 1);
    });

    QUnit.test('`_.' + methodName + '` should work with a negative `fromIndex` <= `-length`', function(assert) {
      assert.expect(1);

      var values = [-6, -8, -Infinity],
          expected = lodashStable.map(values, stubZero);

      var actual = lodashStable.map(values, function(fromIndex) {
        return func(array, resolve(1), fromIndex);
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should treat falsey `fromIndex` values correctly', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? 5 : -1;
      });

      var actual = lodashStable.map(falsey, function(fromIndex) {
        return func(array, resolve(3), fromIndex);
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should coerce `fromIndex` to an integer', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(array, resolve(2), 4.2), 4);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('indexOf methods');

  lodashStable.each(['indexOf', 'lastIndexOf', 'sortedIndexOf', 'sortedLastIndexOf'], function(methodName) {
    var func = _[methodName],
        isIndexOf = !/last/i.test(methodName),
        isSorted = /^sorted/.test(methodName);

    QUnit.test('`_.' + methodName + '` should accept a falsey `array`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, lodashStable.constant(-1));

      var actual = lodashStable.map(falsey, function(array, index) {
        try {
          return index ? func(array) : func();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should return `-1` for an unmatched value', function(assert) {
      assert.expect(5);

      var array = [1, 2, 3],
          empty = [];

      assert.strictEqual(func(array, 4), -1);
      assert.strictEqual(func(array, 4, true), -1);
      assert.strictEqual(func(array, undefined, true), -1);

      assert.strictEqual(func(empty, undefined), -1);
      assert.strictEqual(func(empty, undefined, true), -1);
    });

    QUnit.test('`_.' + methodName + '` should not match values on empty arrays', function(assert) {
      assert.expect(2);

      var array = [];
      array[-1] = 0;

      assert.strictEqual(func(array, undefined), -1);
      assert.strictEqual(func(array, 0, true), -1);
    });

    QUnit.test('`_.' + methodName + '` should match `NaN`', function(assert) {
      assert.expect(3);

      var array = isSorted
        ? [1, 2, NaN, NaN]
        : [1, NaN, 3, NaN, 5, NaN];

      if (isSorted) {
        assert.strictEqual(func(array, NaN, true), isIndexOf ? 2 : 3);
        skipAssert(assert, 2);
      }
      else {
        assert.strictEqual(func(array, NaN), isIndexOf ? 1 : 5);
        assert.strictEqual(func(array, NaN, 2), isIndexOf ? 3 : 1);
        assert.strictEqual(func(array, NaN, -2), isIndexOf ? 5 : 3);
      }
    });

    QUnit.test('`_.' + methodName + '` should match `-0` as `0`', function(assert) {
      assert.expect(2);

      assert.strictEqual(func([-0], 0), 0);
      assert.strictEqual(func([0], -0), 0);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.map');

  (function() {
    var array = [1, 2];

    QUnit.test('should map values in `collection` to a new array', function(assert) {
      assert.expect(2);

      var object = { 'a': 1, 'b': 2 },
          expected = ['1', '2'];

      assert.deepEqual(_.map(array, String), expected);
      assert.deepEqual(_.map(object, String), expected);
    });

    QUnit.test('should work with `_.property` shorthands', function(assert) {
      assert.expect(1);

      var objects = [{ 'a': 'x' }, { 'a': 'y' }];
      assert.deepEqual(_.map(objects, 'a'), ['x', 'y']);
    });

    QUnit.test('should iterate over own string keyed properties of objects', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var actual = _.map(new Foo, identity);
      assert.deepEqual(actual, [1]);
    });

    QUnit.test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(2);

      var object = { 'a': 1, 'b': 2 },
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([1, 2]));

      lodashStable.each([array, object], function(collection) {
        var actual = lodashStable.map(values, function(value, index) {
          return index ? _.map(collection, value) : _.map(collection);
        });

        assert.deepEqual(actual, expected);
      });
    });

    QUnit.test('should accept a falsey `collection`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubArray);

      var actual = lodashStable.map(falsey, function(collection, index) {
        try {
          return index ? _.map(collection) : _.map();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.map(1), []);
    });

    QUnit.test('should treat a nodelist as an array-like object', function(assert) {
      assert.expect(1);

      if (document) {
        var actual = _.map(document.getElementsByTagName('body'), function(element) {
          return element.nodeName.toLowerCase();
        });

        assert.deepEqual(actual, ['body']);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should work with objects with non-number length properties', function(assert) {
      assert.expect(1);

      var value = { 'value': 'x' },
          object = { 'length': { 'value': 'x' } };

      assert.deepEqual(_.map(object, identity), [value]);
    });

    QUnit.test('should return a wrapped value when chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(array).map(noop) instanceof _);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should provide correct `predicate` arguments in a lazy sequence', function(assert) {
      assert.expect(5);

      if (!isNpm) {
        var args,
            array = lodashStable.range(LARGE_ARRAY_SIZE + 1),
            expected = [1, 0, _.map(array.slice(1), square)];

        _(array).slice(1).map(function(value, index, array) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, [1, 0, array.slice(1)]);

        args = undefined;
        _(array).slice(1).map(square).map(function(value, index, array) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, expected);

        args = undefined;
        _(array).slice(1).map(square).map(function(value, index) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, expected);

        args = undefined;
        _(array).slice(1).map(square).map(function(value) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, [1]);

        args = undefined;
        _(array).slice(1).map(square).map(function() {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, expected);
      }
      else {
        skipAssert(assert, 5);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.mapKeys');

  (function() {
    var array = [1, 2],
        object = { 'a': 1, 'b': 2 };

    QUnit.test('should map keys in `object` to a new object', function(assert) {
      assert.expect(1);

      var actual = _.mapKeys(object, String);
      assert.deepEqual(actual, { '1': 1, '2': 2 });
    });

    QUnit.test('should treat arrays like objects', function(assert) {
      assert.expect(1);

      var actual = _.mapKeys(array, String);
      assert.deepEqual(actual, { '1': 1, '2': 2 });
    });

    QUnit.test('should work with `_.property` shorthands', function(assert) {
      assert.expect(1);

      var actual = _.mapKeys({ 'a': { 'b': 'c' } }, 'b');
      assert.deepEqual(actual, { 'c': { 'b': 'c' } });
    });

    QUnit.test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var object = { 'a': 1, 'b': 2 },
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant({ '1': 1, '2': 2 }));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.mapKeys(object, value) : _.mapKeys(object);
      });

      assert.deepEqual(actual, expected);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.mapValues');

  (function() {
    var array = [1, 2],
        object = { 'a': 1, 'b': 2 };

    QUnit.test('should map values in `object` to a new object', function(assert) {
      assert.expect(1);

      var actual = _.mapValues(object, String);
      assert.deepEqual(actual, { 'a': '1', 'b': '2' });
    });

    QUnit.test('should treat arrays like objects', function(assert) {
      assert.expect(1);

      var actual = _.mapValues(array, String);
      assert.deepEqual(actual, { '0': '1', '1': '2' });
    });

    QUnit.test('should work with `_.property` shorthands', function(assert) {
      assert.expect(1);

      var actual = _.mapValues({ 'a': { 'b': 2 } }, 'b');
      assert.deepEqual(actual, { 'a': 2 });
    });

    QUnit.test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var object = { 'a': 1, 'b': 2 },
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([true, false]));

      var actual = lodashStable.map(values, function(value, index) {
        var result = index ? _.mapValues(object, value) : _.mapValues(object);
        return [lodashStable.isEqual(result, object), result === object];
      });

      assert.deepEqual(actual, expected);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.mapKeys and lodash.mapValues');

  lodashStable.each(['mapKeys', 'mapValues'], function(methodName) {
    var func = _[methodName],
        object = { 'a': 1, 'b': 2 };

    QUnit.test('`_.' + methodName + '` should iterate over own string keyed properties of objects', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 'a';
      }
      Foo.prototype.b = 'b';

      var actual = func(new Foo, function(value, key) { return key; });
      assert.deepEqual(actual, { 'a': 'a' });
    });

    QUnit.test('`_.' + methodName + '` should accept a falsey `object`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubObject);

      var actual = lodashStable.map(falsey, function(object, index) {
        try {
          return index ? func(object) : func();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should return a wrapped value when chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(object)[methodName](noop) instanceof _);
      }
      else {
        skipAssert(assert);
      }
    });
  });

  QUnit.module('lodash.matches');

  (function() {
    QUnit.test('should not change behavior if `source` is modified', function(assert) {
      assert.expect(9);

      var sources = [
        { 'a': { 'b': 2, 'c': 3 } },
        { 'a': 1, 'b': 2 },
        { 'a': 1 }
      ];

      lodashStable.each(sources, function(source, index) {
        var object = lodashStable.cloneDeep(source),
            par = _.matches(source);

        assert.strictEqual(par(object), true);

        if (index) {
          source.a = 2;
          source.b = 1;
          source.c = 3;
        } else {
          source.a.b = 1;
          source.a.c = 2;
          source.a.d = 3;
        }
        assert.strictEqual(par(object), true);
        assert.strictEqual(par(source), false);
      });
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('matches methods');

  lodashStable.each(['matches', 'isMatch'], function(methodName) {
    var isMatches = methodName == 'matches';

    function matches(source) {
      return isMatches ? _.matches(source) : function(object) {
        return _.isMatch(object, source);
      };
    }

    QUnit.test('`_.' + methodName + '` should perform a deep comparison between `source` and `object`', function(assert) {
      assert.expect(5);

      var object = { 'a': 1, 'b': 2, 'c': 3 },
          par = matches({ 'a': 1 });

      assert.strictEqual(par(object), true);

      par = matches({ 'b': 1 });
      assert.strictEqual(par(object), false);

      par = matches({ 'a': 1, 'c': 3 });
      assert.strictEqual(par(object), true);

      par = matches({ 'c': 3, 'd': 4 });
      assert.strictEqual(par(object), false);

      object = { 'a': { 'b': { 'c': 1, 'd': 2 }, 'e': 3 }, 'f': 4 };
      par = matches({ 'a': { 'b': { 'c': 1 } } });

      assert.strictEqual(par(object), true);
    });

    QUnit.test('`_.' + methodName + '` should match inherited string keyed `object` properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var object = { 'a': new Foo },
          par = matches({ 'a': { 'b': 2 } });

      assert.strictEqual(par(object), true);
    });

    QUnit.test('`_.' + methodName + '` should not match by inherited `source` properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var objects = [{ 'a': 1 }, { 'a': 1, 'b': 2 }],
          source = new Foo,
          actual = lodashStable.map(objects, matches(source)),
          expected = lodashStable.map(objects, stubTrue);

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should compare a variety of `source` property values', function(assert) {
      assert.expect(2);

      var object1 = { 'a': false, 'b': true, 'c': '3', 'd': 4, 'e': [5], 'f': { 'g': 6 } },
          object2 = { 'a': 0, 'b': 1, 'c': 3, 'd': '4', 'e': ['5'], 'f': { 'g': '6' } },
          par = matches(object1);

      assert.strictEqual(par(object1), true);
      assert.strictEqual(par(object2), false);
    });

    QUnit.test('`_.' + methodName + '` should match `-0` as `0`', function(assert) {
      assert.expect(2);

      var object1 = { 'a': -0 },
          object2 = { 'a': 0 },
          par = matches(object1);

      assert.strictEqual(par(object2), true);

      par = matches(object2);
      assert.strictEqual(par(object1), true);
    });

    QUnit.test('`_.' + methodName + '` should compare functions by reference', function(assert) {
      assert.expect(3);

      var object1 = { 'a': lodashStable.noop },
          object2 = { 'a': noop },
          object3 = { 'a': {} },
          par = matches(object1);

      assert.strictEqual(par(object1), true);
      assert.strictEqual(par(object2), false);
      assert.strictEqual(par(object3), false);
    });

    QUnit.test('`_.' + methodName + '` should work with a function for `object`', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.a = { 'b': 2, 'c': 3 };

      var par = matches({ 'a': { 'b': 2 } });
      assert.strictEqual(par(Foo), true);
    });

    QUnit.test('`_.' + methodName + '` should work with a function for `source`', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.a = 1;
      Foo.b = function() {};
      Foo.c = 3;

      var objects = [{ 'a': 1 }, { 'a': 1, 'b': Foo.b, 'c': 3 }],
          actual = lodashStable.map(objects, matches(Foo));

      assert.deepEqual(actual, [false, true]);
    });

    QUnit.test('`_.' + methodName + '` should work with a non-plain `object`', function(assert) {
      assert.expect(1);

      function Foo(object) { lodashStable.assign(this, object); }

      var object = new Foo({ 'a': new Foo({ 'b': 2, 'c': 3 }) }),
          par = matches({ 'a': { 'b': 2 } });

      assert.strictEqual(par(object), true);
    });

    QUnit.test('`_.' + methodName + '` should partial match arrays', function(assert) {
      assert.expect(3);

      var objects = [{ 'a': ['b'] }, { 'a': ['c', 'd'] }],
          actual = lodashStable.filter(objects, matches({ 'a': ['d'] }));

      assert.deepEqual(actual, [objects[1]]);

      actual = lodashStable.filter(objects, matches({ 'a': ['b', 'd'] }));
      assert.deepEqual(actual, []);

      actual = lodashStable.filter(objects, matches({ 'a': ['d', 'b'] }));
      assert.deepEqual(actual, []);
    });

    QUnit.test('`_.' + methodName + '` should partial match arrays with duplicate values', function(assert) {
      assert.expect(1);

      var objects = [{ 'a': [1, 2] }, { 'a': [2, 2] }],
          actual = lodashStable.filter(objects, matches({ 'a': [2, 2] }));

      assert.deepEqual(actual, [objects[1]]);
    });

    QUnit.test('should partial match arrays of objects', function(assert) {
      assert.expect(1);

      var objects = [
        { 'a': [{ 'b': 1, 'c': 2 }, { 'b': 4, 'c': 5, 'd': 6 }] },
        { 'a': [{ 'b': 1, 'c': 2 }, { 'b': 4, 'c': 6, 'd': 7 }] }
      ];

      var actual = lodashStable.filter(objects, matches({ 'a': [{ 'b': 1 }, { 'b': 4, 'c': 5 }] }));
      assert.deepEqual(actual, [objects[0]]);
    });

    QUnit.test('`_.' + methodName + '` should partial match maps', function(assert) {
      assert.expect(3);

      if (Map) {
        var objects = [{ 'a': new Map }, { 'a': new Map }];
        objects[0].a.set('a', 1);
        objects[1].a.set('a', 1);
        objects[1].a.set('b', 2);

        var map = new Map;
        map.set('b', 2);
        var actual = lodashStable.filter(objects, matches({ 'a': map }));

        assert.deepEqual(actual, [objects[1]]);

        map.delete('b');
        actual = lodashStable.filter(objects, matches({ 'a': map }));

        assert.deepEqual(actual, objects);

        map.set('c', 3);
        actual = lodashStable.filter(objects, matches({ 'a': map }));

        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('`_.' + methodName + '` should partial match sets', function(assert) {
      assert.expect(3);

      if (Set) {
        var objects = [{ 'a': new Set }, { 'a': new Set }];
        objects[0].a.add(1);
        objects[1].a.add(1);
        objects[1].a.add(2);

        var set = new Set;
        set.add(2);
        var actual = lodashStable.filter(objects, matches({ 'a': set }));

        assert.deepEqual(actual, [objects[1]]);

        set.delete(2);
        actual = lodashStable.filter(objects, matches({ 'a': set }));

        assert.deepEqual(actual, objects);

        set.add(3);
        actual = lodashStable.filter(objects, matches({ 'a': set }));

        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('`_.' + methodName + '` should match `undefined` values', function(assert) {
      assert.expect(3);

      var objects = [{ 'a': 1 }, { 'a': 1, 'b': 1 }, { 'a': 1, 'b': undefined }],
          actual = lodashStable.map(objects, matches({ 'b': undefined })),
          expected = [false, false, true];

      assert.deepEqual(actual, expected);

      actual = lodashStable.map(objects, matches({ 'a': 1, 'b': undefined }));

      assert.deepEqual(actual, expected);

      objects = [{ 'a': { 'b': 2 } }, { 'a': { 'b': 2, 'c': 3 } }, { 'a': { 'b': 2, 'c': undefined } }];
      actual = lodashStable.map(objects, matches({ 'a': { 'c': undefined } }));

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should match `undefined` values on primitives', function(assert) {
      assert.expect(3);

      numberProto.a = 1;
      numberProto.b = undefined;

      try {
        var par = matches({ 'b': undefined });
        assert.strictEqual(par(1), true);
      } catch (e) {
        assert.ok(false, e.message);
      }
      try {
        par = matches({ 'a': 1, 'b': undefined });
        assert.strictEqual(par(1), true);
      } catch (e) {
        assert.ok(false, e.message);
      }
      numberProto.a = { 'b': 1, 'c': undefined };
      try {
        par = matches({ 'a': { 'c': undefined } });
        assert.strictEqual(par(1), true);
      } catch (e) {
        assert.ok(false, e.message);
      }
      delete numberProto.a;
      delete numberProto.b;
    });

    QUnit.test('`_.' + methodName + '` should return `false` when `object` is nullish', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubFalse),
          par = matches({ 'a': 1 });

      var actual = lodashStable.map(values, function(value, index) {
        try {
          return index ? par(value) : par();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should return `true` when comparing an empty `source`', function(assert) {
      assert.expect(1);

      var object = { 'a': 1 },
          expected = lodashStable.map(empties, stubTrue);

      var actual = lodashStable.map(empties, function(value) {
        var par = matches(value);
        return par(object);
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should return `true` when comparing an empty `source` to a nullish `object`', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubTrue),
          par = matches({});

      var actual = lodashStable.map(values, function(value, index) {
        try {
          return index ? par(value) : par();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should return `true` when comparing a `source` of empty arrays and objects', function(assert) {
      assert.expect(1);

      var objects = [{ 'a': [1], 'b': { 'c': 1 } }, { 'a': [2, 3], 'b': { 'd': 2 } }],
          actual = lodashStable.filter(objects, matches({ 'a': [], 'b': {} }));

      assert.deepEqual(actual, objects);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.matchesProperty');

  (function() {
    QUnit.test('should create a function that performs a deep comparison between a property value and `srcValue`', function(assert) {
      assert.expect(6);

      var object = { 'a': 1, 'b': 2, 'c': 3 },
          matches = _.matchesProperty('a', 1);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches(object), true);

      matches = _.matchesProperty('b', 3);
      assert.strictEqual(matches(object), false);

      matches = _.matchesProperty('a', { 'a': 1, 'c': 3 });
      assert.strictEqual(matches({ 'a': object }), true);

      matches = _.matchesProperty('a', { 'c': 3, 'd': 4 });
      assert.strictEqual(matches(object), false);

      object = { 'a': { 'b': { 'c': 1, 'd': 2 }, 'e': 3 }, 'f': 4 };
      matches = _.matchesProperty('a', { 'b': { 'c': 1 } });

      assert.strictEqual(matches(object), true);
    });

    QUnit.test('should support deep paths', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var matches = _.matchesProperty(path, 2);
        assert.strictEqual(matches(object), true);
      });
    });

    QUnit.test('should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3];

      lodashStable.each([1, [1]], function(path) {
        var matches = _.matchesProperty(path, 2);
        assert.strictEqual(matches(array), true);
      });
    });

    QUnit.test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var object1 = { '-0': 'a' },
          object2 = { '0': 'b' },
          pairs = [[object1, object2], [object1, object2], [object2, object1], [object2, object1]],
          props = [-0, Object(-0), 0, Object(0)],
          values = ['a', 'a', 'b', 'b'],
          expected = lodashStable.map(props, lodashStable.constant([true, false]));

      var actual = lodashStable.map(props, function(key, index) {
        var matches = _.matchesProperty(key, values[index]),
            pair = pairs[index];

        return [matches(pair[0]), matches(pair[1])];
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var object = { 'null': 1, 'undefined': 2, 'fn': 3, '[object Object]': 4 },
          paths = [null, undefined, fn, {}],
          expected = lodashStable.map(paths, stubTrue);

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          var matches = _.matchesProperty(index ? [path] : path, object[path]);
          return matches(object);
        });

        assert.deepEqual(actual, expected);
      });
    });

    QUnit.test('should match a key over a path', function(assert) {
      assert.expect(2);

      var object = { 'a.b': 1, 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a.b']], function(path) {
        var matches = _.matchesProperty(path, 1);
        assert.strictEqual(matches(object), true);
      });
    });

    QUnit.test('should return `false` when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubFalse);

      lodashStable.each(['constructor', ['constructor']], function(path) {
        var matches = _.matchesProperty(path, 1);

        var actual = lodashStable.map(values, function(value, index) {
          try {
            return index ? matches(value) : matches();
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      });
    });

    QUnit.test('should return `false` for deep paths when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubFalse);

      lodashStable.each(['constructor.prototype.valueOf', ['constructor', 'prototype', 'valueOf']], function(path) {
        var matches = _.matchesProperty(path, 1);

        var actual = lodashStable.map(values, function(value, index) {
          try {
            return index ? matches(value) : matches();
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      });
    });

    QUnit.test('should return `false` if parts of `path` are missing', function(assert) {
      assert.expect(4);

      var object = {};

      lodashStable.each(['a', 'a[1].b.c', ['a'], ['a', '1', 'b', 'c']], function(path) {
        var matches = _.matchesProperty(path, 1);
        assert.strictEqual(matches(object), false);
      });
    });

    QUnit.test('should match inherited string keyed `srcValue` properties', function(assert) {
      assert.expect(2);

      function Foo() {}
      Foo.prototype.b = 2;

      var object = { 'a': new Foo };

      lodashStable.each(['a', ['a']], function(path) {
        var matches = _.matchesProperty(path, { 'b': 2 });
        assert.strictEqual(matches(object), true);
      });
    });

    QUnit.test('should not match by inherited `srcValue` properties', function(assert) {
      assert.expect(2);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var objects = [{ 'a': { 'a': 1 } }, { 'a': { 'a': 1, 'b': 2 } }],
          expected = lodashStable.map(objects, stubTrue);

      lodashStable.each(['a', ['a']], function(path) {
        assert.deepEqual(lodashStable.map(objects, _.matchesProperty(path, new Foo)), expected);
      });
    });

    QUnit.test('should compare a variety of values', function(assert) {
      assert.expect(2);

      var object1 = { 'a': false, 'b': true, 'c': '3', 'd': 4, 'e': [5], 'f': { 'g': 6 } },
          object2 = { 'a': 0, 'b': 1, 'c': 3, 'd': '4', 'e': ['5'], 'f': { 'g': '6' } },
          matches = _.matchesProperty('a', object1);

      assert.strictEqual(matches({ 'a': object1 }), true);
      assert.strictEqual(matches({ 'a': object2 }), false);
    });

    QUnit.test('should match `-0` as `0`', function(assert) {
      assert.expect(2);

      var matches = _.matchesProperty('a', -0);
      assert.strictEqual(matches({ 'a': 0 }), true);

      matches = _.matchesProperty('a', 0);
      assert.strictEqual(matches({ 'a': -0 }), true);
    });

    QUnit.test('should compare functions by reference', function(assert) {
      assert.expect(3);

      var object1 = { 'a': lodashStable.noop },
          object2 = { 'a': noop },
          object3 = { 'a': {} },
          matches = _.matchesProperty('a', object1);

      assert.strictEqual(matches({ 'a': object1 }), true);
      assert.strictEqual(matches({ 'a': object2 }), false);
      assert.strictEqual(matches({ 'a': object3 }), false);
    });

    QUnit.test('should work with a function for `srcValue`', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.a = 1;
      Foo.b = function() {};
      Foo.c = 3;

      var objects = [{ 'a': { 'a': 1 } }, { 'a': { 'a': 1, 'b': Foo.b, 'c': 3 } }],
          actual = lodashStable.map(objects, _.matchesProperty('a', Foo));

      assert.deepEqual(actual, [false, true]);
    });

    QUnit.test('should work with a non-plain `srcValue`', function(assert) {
      assert.expect(1);

      function Foo(object) { lodashStable.assign(this, object); }

      var object = new Foo({ 'a': new Foo({ 'b': 1, 'c': 2 }) }),
          matches = _.matchesProperty('a', { 'b': 1 });

      assert.strictEqual(matches(object), true);
    });

    QUnit.test('should partial match arrays', function(assert) {
      assert.expect(3);

      var objects = [{ 'a': ['b'] }, { 'a': ['c', 'd'] }],
          actual = lodashStable.filter(objects, _.matchesProperty('a', ['d']));

      assert.deepEqual(actual, [objects[1]]);

      actual = lodashStable.filter(objects, _.matchesProperty('a', ['b', 'd']));
      assert.deepEqual(actual, []);

      actual = lodashStable.filter(objects, _.matchesProperty('a', ['d', 'b']));
      assert.deepEqual(actual, []);
    });

    QUnit.test('should partial match arrays with duplicate values', function(assert) {
      assert.expect(1);

      var objects = [{ 'a': [1, 2] }, { 'a': [2, 2] }],
          actual = lodashStable.filter(objects, _.matchesProperty('a', [2, 2]));

      assert.deepEqual(actual, [objects[1]]);
    });

    QUnit.test('should partial match arrays of objects', function(assert) {
      assert.expect(1);

      var objects = [
        { 'a': [{ 'a': 1, 'b': 2 }, { 'a': 4, 'b': 5, 'c': 6 }] },
        { 'a': [{ 'a': 1, 'b': 2 }, { 'a': 4, 'b': 6, 'c': 7 }] }
      ];

      var actual = lodashStable.filter(objects, _.matchesProperty('a', [{ 'a': 1 }, { 'a': 4, 'b': 5 }]));
      assert.deepEqual(actual, [objects[0]]);
    });
    QUnit.test('should partial match maps', function(assert) {
      assert.expect(3);

      if (Map) {
        var objects = [{ 'a': new Map }, { 'a': new Map }];
        objects[0].a.set('a', 1);
        objects[1].a.set('a', 1);
        objects[1].a.set('b', 2);

        var map = new Map;
        map.set('b', 2);
        var actual = lodashStable.filter(objects, _.matchesProperty('a', map));

        assert.deepEqual(actual, [objects[1]]);

        map.delete('b');
        actual = lodashStable.filter(objects, _.matchesProperty('a', map));

        assert.deepEqual(actual, objects);

        map.set('c', 3);
        actual = lodashStable.filter(objects, _.matchesProperty('a', map));

        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('should partial match sets', function(assert) {
      assert.expect(3);

      if (Set) {
        var objects = [{ 'a': new Set }, { 'a': new Set }];
        objects[0].a.add(1);
        objects[1].a.add(1);
        objects[1].a.add(2);

        var set = new Set;
        set.add(2);
        var actual = lodashStable.filter(objects, _.matchesProperty('a', set));

        assert.deepEqual(actual, [objects[1]]);

        set.delete(2);
        actual = lodashStable.filter(objects, _.matchesProperty('a', set));

        assert.deepEqual(actual, objects);

        set.add(3);
        actual = lodashStable.filter(objects, _.matchesProperty('a', set));

        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('should match `undefined` values', function(assert) {
      assert.expect(2);

      var objects = [{ 'a': 1 }, { 'a': 1, 'b': 1 }, { 'a': 1, 'b': undefined }],
          actual = lodashStable.map(objects, _.matchesProperty('b', undefined)),
          expected = [false, false, true];

      assert.deepEqual(actual, expected);

      objects = [{ 'a': { 'a': 1 } }, { 'a': { 'a': 1, 'b': 1 } }, { 'a': { 'a': 1, 'b': undefined } }];
      actual = lodashStable.map(objects, _.matchesProperty('a', { 'b': undefined }));

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should match `undefined` values of nested objects', function(assert) {
      assert.expect(4);

      var object = { 'a': { 'b': undefined } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var matches = _.matchesProperty(path, undefined);
        assert.strictEqual(matches(object), true);
      });

      lodashStable.each(['a.a', ['a', 'a']], function(path) {
        var matches = _.matchesProperty(path, undefined);
        assert.strictEqual(matches(object), false);
      });
    });

    QUnit.test('should match `undefined` values on primitives', function(assert) {
      assert.expect(2);

      numberProto.a = 1;
      numberProto.b = undefined;

      try {
        var matches = _.matchesProperty('b', undefined);
        assert.strictEqual(matches(1), true);
      } catch (e) {
        assert.ok(false, e.message);
      }
      numberProto.a = { 'b': 1, 'c': undefined };
      try {
        matches = _.matchesProperty('a', { 'c': undefined });
        assert.strictEqual(matches(1), true);
      } catch (e) {
        assert.ok(false, e.message);
      }
      delete numberProto.a;
      delete numberProto.b;
    });

    QUnit.test('should return `true` when comparing a `srcValue` of empty arrays and objects', function(assert) {
      assert.expect(1);

      var objects = [{ 'a': [1], 'b': { 'c': 1 } }, { 'a': [2, 3], 'b': { 'd': 2 } }],
          matches = _.matchesProperty('a', { 'a': [], 'b': {} });

      var actual = lodashStable.filter(objects, function(object) {
        return matches({ 'a': object });
      });

      assert.deepEqual(actual, objects);
    });

    QUnit.test('should not change behavior if `srcValue` is modified', function(assert) {
      assert.expect(9);

      lodashStable.each([{ 'a': { 'b': 2, 'c': 3 } }, { 'a': 1, 'b': 2 }, { 'a': 1 }], function(source, index) {
        var object = lodashStable.cloneDeep(source),
            matches = _.matchesProperty('a', source);

        assert.strictEqual(matches({ 'a': object }), true);

        if (index) {
          source.a = 2;
          source.b = 1;
          source.c = 3;
        } else {
          source.a.b = 1;
          source.a.c = 2;
          source.a.d = 3;
        }
        assert.strictEqual(matches({ 'a': object }), true);
        assert.strictEqual(matches({ 'a': source }), false);
      });
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.max');

  (function() {
    QUnit.test('should return the largest value from a collection', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.max([1, 2, 3]), 3);
    });

    QUnit.test('should return `undefined` for empty collections', function(assert) {
      assert.expect(1);

      var values = falsey.concat([[]]),
          expected = lodashStable.map(values, noop);

      var actual = lodashStable.map(values, function(value, index) {
        try {
          return index ? _.max(value) : _.max();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should work with non-numeric collection values', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.max(['a', 'b']), 'b');
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.mean');

  (function() {
    QUnit.test('should return the mean of an array of numbers', function(assert) {
      assert.expect(1);

      var array = [4, 2, 8, 6];
      assert.strictEqual(_.mean(array), 5);
    });

    QUnit.test('should return `NaN` when passing empty `array` values', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, stubNaN),
          actual = lodashStable.map(empties, _.mean);

      assert.deepEqual(actual, expected);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.meanBy');

  (function() {
    var objects = [{ 'a': 2 }, { 'a': 3 }, { 'a': 1 }];

    QUnit.test('should work with an `iteratee`', function(assert) {
      assert.expect(1);

      var actual = _.meanBy(objects, function(object) {
        return object.a;
      });

      assert.deepEqual(actual, 2);
    });

    QUnit.test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.meanBy(objects, function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [{ 'a': 2 }]);
    });

    QUnit.test('should work with `_.property` shorthands', function(assert) {
      assert.expect(2);

      var arrays = [[2], [3], [1]];
      assert.strictEqual(_.meanBy(arrays, 0), 2);
      assert.strictEqual(_.meanBy(objects, 'a'), 2);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.memoize');

  (function() {
    function CustomCache() {
      this.clear();
    }

    CustomCache.prototype = {
      'clear': function() {
        this.__data__ = [];
        return this;
      },
      'get': function(key) {
        var entry = lodashStable.find(this.__data__, ['key', key]);
        return entry && entry.value;
      },
      'has': function(key) {
        return lodashStable.some(this.__data__, ['key', key]);
      },
      'set': function(key, value) {
        this.__data__.push({ 'key': key, 'value': value });
        return this;
      }
    };

    function ImmutableCache() {
      this.__data__ = [];
    }

    ImmutableCache.prototype = lodashStable.create(CustomCache.prototype, {
      'constructor': ImmutableCache,
      'clear': function() {
        return new ImmutableCache;
      },
      'set': function(key, value) {
        var result = new ImmutableCache;
        result.__data__ = this.__data__.concat({ 'key': key, 'value': value });
        return result;
      }
    });

    QUnit.test('should memoize results based on the first argument given', function(assert) {
      assert.expect(2);

      var memoized = _.memoize(function(a, b, c) {
        return a + b + c;
      });

      assert.strictEqual(memoized(1, 2, 3), 6);
      assert.strictEqual(memoized(1, 3, 5), 6);
    });

    QUnit.test('should support a `resolver`', function(assert) {
      assert.expect(2);

      var fn = function(a, b, c) { return a + b + c; },
          memoized = _.memoize(fn, fn);

      assert.strictEqual(memoized(1, 2, 3), 6);
      assert.strictEqual(memoized(1, 3, 5), 9);
    });

    QUnit.test('should use `this` binding of function for `resolver`', function(assert) {
      assert.expect(2);

      var fn = function(a, b, c) { return a + this.b + this.c; },
          memoized = _.memoize(fn, fn);

      var object = { 'memoized': memoized, 'b': 2, 'c': 3 };
      assert.strictEqual(object.memoized(1), 6);

      object.b = 3;
      object.c = 5;
      assert.strictEqual(object.memoized(1), 9);
    });

    QUnit.test('should throw a TypeError if `resolve` is truthy and not a function', function(assert) {
      assert.expect(1);

      assert.raises(function() { _.memoize(noop, true); }, TypeError);
    });

    QUnit.test('should not error if `resolver` is nullish', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(resolver, index) {
        try {
          return _.isFunction(index ? _.memoize(noop, resolver) : _.memoize(noop));
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should check cache for own properties', function(assert) {
      assert.expect(1);

      var props = [
        'constructor',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toLocaleString',
        'toString',
        'valueOf'
      ];

      var memoized = _.memoize(identity);

      var actual = lodashStable.map(props, function(value) {
        return memoized(value);
      });

      assert.deepEqual(actual, props);
    });

    QUnit.test('should cache the `__proto__` key', function(assert) {
      assert.expect(8);

      var array = [],
          key = '__proto__';

      lodashStable.times(2, function(index) {
        var count = 0,
            resolver = index ? identity : undefined;

        var memoized = _.memoize(function() {
          count++;
          return array;
        }, resolver);

        var cache = memoized.cache;

        memoized(key);
        memoized(key);

        assert.strictEqual(count, 1);
        assert.strictEqual(cache.get(key), array);
        assert.notOk(cache.__data__ instanceof Array);
        assert.strictEqual(cache.delete(key), true);
      });
    });

    QUnit.test('should allow `_.memoize.Cache` to be customized', function(assert) {
      assert.expect(4);

      var oldCache = _.memoize.Cache;
      _.memoize.Cache = CustomCache;

      var memoized = _.memoize(function(object) {
        return object.id;
      });

      var cache = memoized.cache,
          key1 = { 'id': 'a' },
          key2 = { 'id': 'b' };

      assert.strictEqual(memoized(key1), 'a');
      assert.strictEqual(cache.has(key1), true);

      assert.strictEqual(memoized(key2), 'b');
      assert.strictEqual(cache.has(key2), true);

      _.memoize.Cache = oldCache;
    });

    QUnit.test('should works with an immutable `_.memoize.Cache` ', function(assert) {
      assert.expect(2);

      var oldCache = _.memoize.Cache;
      _.memoize.Cache = ImmutableCache;

      var memoized = _.memoize(function(object) {
        return object.id;
      });

      var key1 = { 'id': 'a' },
          key2 = { 'id': 'b' };

      memoized(key1);
      memoized(key2);

      var cache = memoized.cache;
      assert.strictEqual(cache.has(key1), true);
      assert.strictEqual(cache.has(key2), true);

      _.memoize.Cache = oldCache;
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('memoizeCapped');

  (function() {
    var func = _._memoizeCapped;

    QUnit.test('should enforce a max cache size of `MAX_MEMOIZE_SIZE`', function(assert) {
      assert.expect(2);

      if (func) {
        var memoized = func(identity),
            cache = memoized.cache;

        lodashStable.times(MAX_MEMOIZE_SIZE, memoized);
        assert.strictEqual(cache.size, MAX_MEMOIZE_SIZE);

        memoized(MAX_MEMOIZE_SIZE);
        assert.strictEqual(cache.size, 1);
      }
      else {
        skipAssert(assert, 2);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.merge');

  (function() {
    QUnit.test('should merge `source` into `object`', function(assert) {
      assert.expect(1);

      var names = {
        'characters': [
          { 'name': 'barney' },
          { 'name': 'fred' }
        ]
      };

      var ages = {
        'characters': [
          { 'age': 36 },
          { 'age': 40 }
        ]
      };

      var heights = {
        'characters': [
          { 'height': '5\'4"' }
```

#### should defer to `customizer` for non `undefined` results

```ts
test('should defer to `customizer` for non `undefined` results', function(assert) {
      assert.expect(1);

      var actual = _.mergeWith({ 'a': { 'b': [0, 1] } }, { 'a': { 'b': [2] } }, function(a, b) {
        return lodashStable.isArray(a) ? a.concat(b) : undefined;
      });

      assert.deepEqual(actual, { 'a': { 'b': [0, 1, 2] } });
    }
```

#### should create a function that negates the result of `func`

```ts
test('should create a function that negates the result of `func`', function(assert) {
      assert.expect(2);

      var negate = _.negate(isEven);

      assert.strictEqual(negate(1), true);
      assert.strictEqual(negate(2), false);
    }
```

#### should work with combinations of bound and partial functions

```ts
test('should work with combinations of bound and partial functions', function(assert) {
      assert.expect(3);

      var fn = function() {
        var result = [this.a];
        push.apply(result, arguments);
        return result;
      };

      var expected = [1, 2, 3, 4],
          object = { 'a': 1, 'fn': fn };

      var a = _.bindKey(object, 'fn'),
          b = _.partialRight(a, 4),
          c = _.partial(b, 2);

      assert.deepEqual(c(3), expected);

      a = _.bind(fn, object);
      b = _.partialRight(a, 4);
      c = _.partial(b, 2);

      assert.deepEqual(c(3), expected);

      a = _.partial(fn, 2);
      b = _.bind(a, object);
      c = _.partialRight(b, 4);

      assert.deepEqual(c(3), expected);
    }
```

#### should work when hot

```ts
test('should work when hot', function(assert) {
      assert.expect(12);

      lodashStable.times(2, function(index) {
        var fn = function() {
          var result = [this];
          push.apply(result, arguments);
          return result;
        };

        var object = {},
            bound1 = index ? _.bind(fn, object, 1) : _.bind(fn, object),
            expected = [object, 1, 2, 3];

        var actual = _.last(lodashStable.times(HOT_COUNT, function() {
          var bound2 = index ? _.bind(bound1, null, 2) : _.bind(bound1);
          return index ? bound2(3) : bound2(1, 2, 3);
        }));

        assert.deepEqual(actual, expected);

        actual = _.last(lodashStable.times(HOT_COUNT, function() {
          var bound1 = index ? _.bind(fn, object, 1) : _.bind(fn, object),
              bound2 = index ? _.bind(bound1, null, 2) : _.bind(bound1);

          return index ? bound2(3) : bound2(1, 2, 3);
        }));

        assert.deepEqual(actual, expected);
      });

      lodashStable.each(['curry', 'curryRight'], function(methodName, index) {
        var fn = function(a, b, c) { return [a, b, c]; },
            curried = _[methodName](fn),
            expected = index ? [3, 2, 1] :  [1, 2, 3];

        var actual = _.last(lodashStable.times(HOT_COUNT, function() {
          return curried(1)(2)(3);
        }));

        assert.deepEqual(actual, expected);

        actual = _.last(lodashStable.times(HOT_COUNT, function() {
          var curried = _[methodName](fn);
          return curried(1)(2)(3);
        }));

        assert.deepEqual(actual, expected);
      });

      lodashStable.each(['partial', 'partialRight'], function(methodName, index) {
        var func = _[methodName],
            fn = function() { return slice.call(arguments); },
            par1 = func(fn, 1),
            expected = index ? [3, 2, 1] : [1, 2, 3];

        var actual = _.last(lodashStable.times(HOT_COUNT, function() {
          var par2 = func(par1, 2);
          return par2(3);
        }));

        assert.deepEqual(actual, expected);

        actual = _.last(lodashStable.times(HOT_COUNT, function() {
          var par1 = func(fn, 1),
              par2 = func(par1, 2);

          return par2(3);
        }));

        assert.deepEqual(actual, expected);
      });
    }
```

#### should work with non-index paths

```ts
test('should work with non-index paths', function(assert) {
      assert.expect(2);

      var values = lodashStable.reject(empties, function(value) {
        return (value === 0) || lodashStable.isArray(value);
      }).concat(-1, 1.1);

      var array = lodashStable.transform(values, function(result, value) {
        result[value] = 1;
      }, []);

      var expected = lodashStable.map(values, stubOne),
          actual = _.pullAt(array, values);

      assert.deepEqual(actual, expected);

      expected = lodashStable.map(values, noop);
      actual = lodashStable.at(array, values);

      assert.deepEqual(actual, expected);
    }
```

#### should support a `min` and `max`

```ts
test('should support a `min` and `max`', function(assert) {
      assert.expect(1);

      var min = 5,
          max = 10;

      assert.ok(lodashStable.some(array, function() {
        var result = _.random(min, max);
        return result >= min && result <= max;
      }));
    }
```

#### should support not providing a `max`

```ts
test('should support not providing a `max`', function(assert) {
      assert.expect(1);

      var min = 0,
          max = 5;

      assert.ok(lodashStable.some(array, function() {
        var result = _.random(max);
        return result >= min && result <= max;
      }));
    }
```

#### should support large integer values

```ts
test('should support large integer values', function(assert) {
      assert.expect(2);

      var min = Math.pow(2, 31),
          max = Math.pow(2, 62);

      assert.ok(lodashStable.every(array, function() {
        var result = _.random(min, max);
        return result >= min && result <= max;
      }));

      assert.ok(lodashStable.some(array, function() {
        return _.random(MAX_INTEGER);
      }));
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [1, 2, 3],
          expected = lodashStable.map(array, stubTrue),
          randoms = lodashStable.map(array, _.random);

      var actual = lodashStable.map(randoms, function(result, index) {
        return result >= 0 && result <= array[index] && (result % 1) == 0;
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should not modify the resulting value from within `predicate`

```ts
test('`_.' + methodName + '` should not modify the resulting value from within `predicate`', function(assert) {
      assert.expect(1);

      var actual = func([0], function(value, index, array) {
        array[index] = 1;
        return isFilter;
      });

      assert.deepEqual(actual, [0]);
    }
```

#### should invoke function values

```ts
test('should invoke function values', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.result(object, 'b'), 'b');
    }
```

#### should invoke default function values

```ts
test('should invoke default function values', function(assert) {
      assert.expect(1);

      var actual = _.result(object, 'c', object.b);
      assert.strictEqual(actual, 'b');
    }
```

#### should invoke nested function values

```ts
test('should invoke nested function values', function(assert) {
      assert.expect(2);

      var value = { 'a': lodashStable.constant({ 'b': stubB }) };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.strictEqual(_.result(value, path), 'b');
      });
    }
```

#### should invoke deep property methods with the correct `this` binding

```ts
test('should invoke deep property methods with the correct `this` binding', function(assert) {
      assert.expect(2);

      var value = { 'a': { 'b': function() { return this.c; }, 'c': 1 } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.strictEqual(_.result(value, path), 1);
      });
    }
```

#### `_.' + methodName + '` should not return `NaN` for large `precision` values

```ts
test('`_.' + methodName + '` should not return `NaN` for large `precision` values', function(assert) {
      assert.expect(1);

      var results = [
        _.round(10.0000001, 1000),
        _.round(MAX_SAFE_INTEGER, 293)
      ];

      var expected = lodashStable.map(results, stubFalse),
          actual = lodashStable.map(results, lodashStable.isNaN);

      assert.deepEqual(actual, expected);
    }
```

#### should return `undefined` when sampling empty collections

```ts
test('should return `undefined` when sampling empty collections', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, noop);

      var actual = lodashStable.transform(empties, function(result, value) {
        try {
          result.push(_.sample(value));
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return an empty array for empty collections

```ts
test('should return an empty array for empty collections', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, stubArray);

      var actual = lodashStable.transform(empties, function(result, value) {
        try {
          result.push(_.sampleSize(value, 1));
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### should coerce arrays returned from `iteratee`

```ts
test('should coerce arrays returned from `iteratee`', function(assert) {
      assert.expect(1);

      var actual = _.sortBy(objects, function(object) {
        var result = [object.a, object.b];
        result.toString = function() { return String(this[0]); };
        return result;
      });

      assert.deepEqual(actual, [objects[0], objects[2], objects[1], objects[3]]);
    }
```

#### `_.' + methodName + '` should preserve the sign of `0`

```ts
test('`_.' + methodName + '` should preserve the sign of `0`', function(assert) {
      assert.expect(2);

      var values = [0, '0', -0, '-0'],
          expected = [[0, Infinity], ['0', Infinity], [-0, -Infinity], ['-0', -Infinity]];

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(values, function(value) {
          var result = index ? func(undefined, value) : func(value);
          return [result, 1 / result];
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### subsequent calls should return the result of the first call

```ts
test('subsequent calls should return the result of the first call', function(assert) {
      assert.expect(5);

      var done = assert.async();

      var throttled = _.throttle(identity, 32),
          results = [throttled('a'), throttled('b')];

      assert.deepEqual(results, ['a', 'a']);

      setTimeout(function() {
        var results = [throttled('c'), throttled('d')];
        assert.notEqual(results[0], 'a');
        assert.notStrictEqual(results[0], undefined);

        assert.notEqual(results[1], 'd');
        assert.notStrictEqual(results[1], undefined);
        done();
      }, 64);
    }
```

#### should work with a system time of `0`

```ts
test('should work with a system time of `0`', function(assert) {
      assert.expect(3);

      var done = assert.async();

      if (!isModularize) {
        var callCount = 0,
            dateCount = 0;

        var lodash = _.runInContext({
          'Date': {
            'now': function() {
              return ++dateCount < 4 ? 0 : +new Date;
            }
          }
        });

        var throttled = lodash.throttle(function(value) {
          callCount++;
          return value;
        }, 32);

        var results = [throttled('a'), throttled('b'), throttled('c')];
        assert.deepEqual(results, ['a', 'a', 'a']);
        assert.strictEqual(callCount, 1);

        setTimeout(function() {
          assert.strictEqual(callCount, 2);
          done();
        }, 64);
      }
      else {
        skipAssert(assert, 3);
        done();
      }
    }
```

#### should return an array of the results of each `iteratee` execution

```ts
test('should return an array of the results of each `iteratee` execution', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.times(3, doubled), [0, 2, 4]);
    }
```

#### `_.' + methodName + '` should preserve the sign of `0`

```ts
test('`_.' + methodName + '` should preserve the sign of `0`', function(assert) {
      assert.expect(2);

      var values = [0, '0', -0, '-0'],
          expected = [[0, Infinity], [0, Infinity], [-0, -Infinity], [-0, -Infinity]];

      lodashStable.times(2, function(index) {
        var others = lodashStable.map(values, index ? Object : identity);

        var actual = lodashStable.map(others, function(value) {
          var result = func(value);
          return [result, 1 / result];
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should return the `toString` result of the wrapped value

```ts
test('should return the `toString` result of the wrapped value', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _([1, 2, 3]);
        assert.strictEqual(wrapped.toString(), '1,2,3');
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should create an object with the same `[[Prototype]]` as `object` when `accumulator` is nullish

```ts
test('should create an object with the same `[[Prototype]]` as `object` when `accumulator` is nullish', function(assert) {
      assert.expect(4);

      var accumulators = [, null, undefined],
          object = new Foo,
          expected = lodashStable.map(accumulators, stubTrue);

      var iteratee = function(result, value, key) {
        result[key] = square(value);
      };

      var mapper = function(accumulator, index) {
        return index ? _.transform(object, iteratee, accumulator) : _.transform(object, iteratee);
      };

      var results = lodashStable.map(accumulators, mapper);

      var actual = lodashStable.map(results, function(result) {
        return result instanceof Foo;
      });

      assert.deepEqual(actual, expected);

      expected = lodashStable.map(accumulators, lodashStable.constant({ 'a': 1, 'b': 4, 'c': 9 }));
      actual = lodashStable.map(results, lodashStable.toPlainObject);

      assert.deepEqual(actual, expected);

      object = { 'a': 1, 'b': 2, 'c': 3 };
      actual = lodashStable.map(accumulators, mapper);

      assert.deepEqual(actual, expected);

      object = [1, 2, 3];
      expected = lodashStable.map(accumulators, lodashStable.constant([1, 4, 9]));
      actual = lodashStable.map(accumulators, mapper);

      assert.deepEqual(actual, expected);
    }
```

#### should support an `accumulator` value

```ts
test('should support an `accumulator` value', function(assert) {
      assert.expect(6);

      var values = [new Foo, [1, 2, 3], { 'a': 1, 'b': 2, 'c': 3 }],
          expected = lodashStable.map(values, lodashStable.constant([1, 4, 9]));

      var actual = lodashStable.map(values, function(value) {
        return _.transform(value, function(result, value) {
          result.push(square(value));
        }, []);
      });

      assert.deepEqual(actual, expected);

      var object = { 'a': 1, 'b': 4, 'c': 9 },
      expected = [object, { '0': 1, '1': 4, '2': 9 }, object];

      actual = lodashStable.map(values, function(value) {
        return _.transform(value, function(result, value, key) {
          result[key] = square(value);
        }, {});
      });

      assert.deepEqual(actual, expected);

      lodashStable.each([[], {}], function(accumulator) {
        var actual = lodashStable.map(values, function(value) {
          return _.transform(value, noop, accumulator);
        });

        assert.ok(lodashStable.every(actual, function(result) {
          return result === accumulator;
        }));

        assert.strictEqual(_.transform(null, null, accumulator), accumulator);
      });
    }
```

#### should treat sparse arrays as dense

```ts
test('should treat sparse arrays as dense', function(assert) {
      assert.expect(1);

      var actual = _.transform(Array(1), function(result, value, index) {
        result[index] = String(value);
      });

      assert.deepEqual(actual, ['undefined']);
    }
```

#### should ensure `object` is an object before using its `[[Prototype]]`

```ts
test('should ensure `object` is an object before using its `[[Prototype]]`', function(assert) {
      assert.expect(2);

      var Ctors = [Boolean, Boolean, Number, Number, Number, String, String],
          values = [false, true, 0, 1, NaN, '', 'a'],
          expected = lodashStable.map(values, stubObject);

      var results = lodashStable.map(values, function(value) {
        return _.transform(value);
      });

      assert.deepEqual(results, expected);

      expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(results, function(value, index) {
        return value instanceof Ctors[index];
      });

      assert.deepEqual(actual, expected);
    }
```

#### should provide correct `iteratee` arguments when transforming an ' + key, function(assert) {
        assert.expect(2);

        var args;

        _.transform(object, function() {
          args || (args = slice.call(arguments));
        });

        var first = args[0];
        if (key == 'array') {
          assert.ok(first !== object && lodashStable.isArray(first));
          assert.deepEqual(args, [first, 1, 0, object]);
        } else {
          assert.ok(first !== object && lodashStable.isPlainObject(first));
          assert.deepEqual(args, [first, 1, 'a

```ts
test('should provide correct `iteratee` arguments when transforming an ' + key, function(assert) {
        assert.expect(2);

        var args;

        _.transform(object, function() {
          args || (args = slice.call(arguments));
        });

        var first = args[0];
        if (key == 'array') {
          assert.ok(first !== object && lodashStable.isArray(first));
          assert.deepEqual(args, [first, 1, 0, object]);
        } else {
          assert.ok(first !== object && lodashStable.isPlainObject(first));
          assert.deepEqual(args, [first, 1, 'a', object]);
        }
      });
    });

    QUnit.test('should create an object from the same realm as `object`', function(assert) {
      assert.expect(1);

      var objects = lodashStable.filter(realm, function(value) {
        return lodashStable.isObject(value) && !lodashStable.isElement(value);
      });

      var expected = lodashStable.map(objects, stubTrue);

      var actual = lodashStable.map(objects, function(object) {
        var Ctor = object.constructor,
            result = _.transform(object);

        if (result === object) {
          return false;
        }
        if (lodashStable.isTypedArray(object)) {
          return result instanceof Array;
        }
        return result instanceof Ctor || !(new Ctor instanceof Ctor);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should execute the chained sequence and returns the wrapped result

```ts
test('should execute the chained sequence and returns the wrapped result', function(assert) {
      assert.expect(4);

      if (!isNpm) {
        var array = [1],
            wrapped = _(array).push(2).push(3);

        assert.deepEqual(array, [1]);

        var otherWrapper = wrapped.commit();
        assert.ok(otherWrapper instanceof _);
        assert.deepEqual(otherWrapper.value(), [1, 2, 3]);
        assert.deepEqual(wrapped.value(), [1, 2, 3, 2, 3]);
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should follow the iterator protocol ' + chainType, function(assert) {
      assert.expect(3);

      if (!isNpm) {
        var wrapped = chain([1, 2]);

        assert.deepEqual(wrapped.next(), { 'done': false, 'value': 1 });
        assert.deepEqual(wrapped.next(), { 'done': false, 'value': 2 });
        assert.deepEqual(wrapped.next(), { 'done': true,  'value': undefined });
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('should act as an iterable ' + chainType, function(assert) {
      assert.expect(2);

      if (!isNpm && Symbol && Symbol.iterator) {
        var array = [1, 2],
            wrapped = chain(array);

        assert.strictEqual(wrapped[Symbol.iterator](), wrapped);
        assert.deepEqual(lodashStable.toArray(wrapped), array);
      }
      else {
        skipAssert(assert, 2);
      }
    });

    QUnit.test('should use `_.toArray` to generate the iterable result ' + chainType, function(assert) {
      assert.expect(3);

      if (!isNpm && Array.from) {
        var hearts = '\ud83d\udc95

```ts
test('should follow the iterator protocol ' + chainType, function(assert) {
      assert.expect(3);

      if (!isNpm) {
        var wrapped = chain([1, 2]);

        assert.deepEqual(wrapped.next(), { 'done': false, 'value': 1 });
        assert.deepEqual(wrapped.next(), { 'done': false, 'value': 2 });
        assert.deepEqual(wrapped.next(), { 'done': true,  'value': undefined });
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('should act as an iterable ' + chainType, function(assert) {
      assert.expect(2);

      if (!isNpm && Symbol && Symbol.iterator) {
        var array = [1, 2],
            wrapped = chain(array);

        assert.strictEqual(wrapped[Symbol.iterator](), wrapped);
        assert.deepEqual(lodashStable.toArray(wrapped), array);
      }
      else {
        skipAssert(assert, 2);
      }
    });

    QUnit.test('should use `_.toArray` to generate the iterable result ' + chainType, function(assert) {
      assert.expect(3);

      if (!isNpm && Array.from) {
        var hearts = '\ud83d\udc95',
            values = [[1], { 'a': 1 }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).pop() : _().pop();
            return result === undefined;
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).push(1).value() : _().push(1).value();
            return lodashStable.eq(result, value);
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).shift() : _().shift();
            return result === undefined;
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).sort().value() : _().sort().value();
            return lodashStable.eq(result, value);
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).splice(0, 1).value() : _().splice(0, 1).value();
            return lodashStable.isEqual(result, []);
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).unshift(1).value() : _().unshift(1).value();
            return lodashStable.eq(result, value);
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return the `valueOf` result of the wrapped value

```ts
test('should return the `valueOf` result of the wrapped value', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _(123);
        assert.strictEqual(Number(wrapped), 123);
      }
      else {
        skipAssert(assert);
      }
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/functions.js

#### memoize

```ts
test('memoize', function(assert) {
    var fib = function(n) {
      return n < 2 ? n : fib(n - 1) + fib(n - 2);
    };
    assert.equal(fib(10), 55, 'a memoized version of fibonacci produces identical results');
    fib = _.memoize(fib); // Redefine `fib` for memoization
    assert.equal(fib(10), 55, 'a memoized version of fibonacci produces identical results');

    var o = function(str) {
      return str;
    };
    var fastO = _.memoize(o);
    assert.equal(o('toString'), 'toString', 'checks hasOwnProperty');
    assert.equal(fastO('toString'), 'toString', 'checks hasOwnProperty');

    // Expose the cache.
    var upper = _.memoize(function(s) {
      return s.toUpperCase();
    });
    assert.equal(upper('foo'), 'FOO');
    assert.equal(upper('bar'), 'BAR');
    assert.deepEqual(upper.cache, {foo: 'FOO', bar: 'BAR'});
    upper.cache = {foo: 'BAR', bar: 'FOO'};
    assert.equal(upper('foo'), 'BAR');
    assert.equal(upper('bar'), 'FOO');

    var hashed = _.memoize(function(key) {
      //https://github.com/jashkenas/underscore/pull/1679#discussion_r13736209
      assert.ok(/[a-z]+/.test(key), 'hasher doesn\'t change keys');
      return key;
    }, function(key) {
      return key.toUpperCase();
    });
    hashed('yep');
    assert.deepEqual(hashed.cache, {YEP: 'yep'}, 'takes a hasher');

    // Test that the hash function can be used to swizzle the key.
    var objCacher = _.memoize(function(value, key) {
      return {key: key, value: value};
    }, function(value, key) {
      return key;
    });
    var myObj = objCacher('a', 'alpha');
    var myObjAlias = objCacher('b', 'alpha');
    assert.notStrictEqual(myObj, void 0, 'object is created if second argument used as key');
    assert.strictEqual(myObj, myObjAlias, 'object is cached if second argument used as key');
    assert.strictEqual(myObj.value, 'a', 'object is not modified if second argument used as key');
  }
```

#### throttle once

```ts
test('throttle once', function(assert) {
    assert.expect(2);
    var done = assert.async();
    var counter = 0;
    var incr = function(){ return ++counter; };
    var throttledIncr = _.throttle(incr, 32);
    var result = throttledIncr();
    _.delay(function(){
      assert.equal(result, 1, 'throttled functions return their value');
      assert.equal(counter, 1, 'incr was called once'); done();
    }, 64);
  }
```

#### throttle repeatedly with results

```ts
test('throttle repeatedly with results', function(assert) {
    assert.expect(6);
    var done = assert.async();
    var counter = 0;
    var incr = function(){ return ++counter; };
    var throttledIncr = _.throttle(incr, 100);
    var results = [];
    var saveResult = function() { results.push(throttledIncr()); };
    saveResult(); saveResult();
    _.delay(saveResult, 50);
    _.delay(saveResult, 150);
    _.delay(saveResult, 160);
    _.delay(saveResult, 230);
    _.delay(function() {
      assert.equal(results[0], 1, 'incr was called once');
      assert.equal(results[1], 1, 'incr was throttled');
      assert.equal(results[2], 1, 'incr was throttled');
      assert.equal(results[3], 2, 'incr was called twice');
      assert.equal(results[4], 2, 'incr was throttled');
      assert.equal(results[5], 3, 'incr was called trailing');
      done();
    }, 300);
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.signedCookies.js

#### should return a signed JSON cookie

```ts
it('should return a signed JSON cookie', function(done){
      var app = express();

      app.use(cookieParser('secret'));

      app.use(function(req, res){
        if (req.path === '/set') {
          res.cookie('obj', { foo: 'bar' }, { signed: true });
          res.end();
        } else {
          res.send(req.signedCookies);
        }
      });

      request(app)
      .get('/set')
      .end(function(err, res){
        if (err) return done(err);
        var cookie = res.header['set-cookie'];

        request(app)
        .get('/')
        .set('Cookie', cookie)
        .expect(200, { obj: { foo: 'bar' } }, done)
      });
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.cookie.js

#### should throw an error

```ts
it('should throw an error', function(done){
        var app = express();

        app.use(cookieParser());

        app.use(function(req, res){
          res.cookie('name', 'tobi', { signed: true }).end();
        });

        request(app)
        .get('/')
        .expect(500, /secret\S+ required for signed cookies/, done);
      }
```

## ./stage

**Consultas usadas no Horsebox:** `domain`, `./stage domain`, `stage domain`

**Arquivos de teste encontrados:** 6

### ../../.sbomtest/repos/f3c62de455-express/test/res.location.js

#### should not touch already-encoded sequences in "url"

```ts
it('should not touch already-encoded sequences in "url"', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'https://google.com?q=%A710',
        'https://google.com?q=%A710',
        'google.com',
        done
      );
    }
```

#### should consistently handle relative urls

```ts
it('should consistently handle relative urls', function (done) {
      var app = createRedirectServerForDomain(null);
      testRequestedRedirect(
        app,
        '/foo/bar',
        '/foo/bar',
        null,
        done
      );
    }
```

#### should not encode urls in such a way that they can bypass redirect allow lists

```ts
it('should not encode urls in such a way that they can bypass redirect allow lists', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'http://google.com\\@apple.com',
        'http://google.com\\@apple.com',
        'google.com',
        done
      );
    }
```

#### should not be case sensitive

```ts
it('should not be case sensitive', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'HTTP://google.com\\@apple.com',
        'HTTP://google.com\\@apple.com',
        'google.com',
        done
      );
    }
```

#### should work with https

```ts
it('should work with https', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'https://google.com\\@apple.com',
        'https://google.com\\@apple.com',
        'google.com',
        done
      );
    }
```

#### should correctly encode schemaless paths

```ts
it('should correctly encode schemaless paths', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        '//google.com\\@apple.com/',
        '//google.com\\@apple.com/',
        'google.com',
        done
      );
    }
```

#### should keep backslashes in the path

```ts
it('should keep backslashes in the path', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'https://google.com/foo\\bar\\baz',
        'https://google.com/foo\\bar\\baz',
        'google.com',
        done
      );
    }
```

#### should escape header splitting for old node versions

```ts
it('should escape header splitting for old node versions', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'http://google.com\\@apple.com/%0d%0afoo:%20bar',
        'http://google.com\\@apple.com/%0d%0afoo:%20bar',
        'google.com',
        done
      );
    }
```

#### should encode unicode correctly

```ts
it('should encode unicode correctly', function (done) {
      var app = createRedirectServerForDomain(null);
      testRequestedRedirect(
        app,
        '/%e2%98%83',
        '/%e2%98%83',
        null,
        done
      );
    }
```

#### should encode unicode correctly even with a bad host

```ts
it('should encode unicode correctly even with a bad host', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'http://google.com\\@apple.com/%e2%98%83',
        'http://google.com\\@apple.com/%e2%98%83',
        'google.com',
        done
      );
    }
```

#### should work correctly despite using deprecated url.parse

```ts
it('should work correctly despite using deprecated url.parse', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'https://google.com\'.bb.com/1.html',
        'https://google.com\'.bb.com/1.html',
        'google.com',
        done
      );
    }
```

#### should encode file uri path

```ts
it('should encode file uri path', function (done) {
      var app = createRedirectServerForDomain('');
      testRequestedRedirect(
        app,
        'file:///etc\\passwd',
        'file:///etc\\passwd',
        '',
        done
      );
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.subdomains.js

#### should return an array

```ts
it('should return an array', function(done){
        var app = express();

        app.use(function(req, res){
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .set('Host', 'tobi.ferrets.example.com')
        .expect(200, ['ferrets', 'tobi'], done);
      }
```

#### should work with IPv4 address

```ts
it('should work with IPv4 address', function(done){
        var app = express();

        app.use(function(req, res){
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .set('Host', '127.0.0.1')
        .expect(200, [], done);
      }
```

#### should work with IPv6 address

```ts
it('should work with IPv6 address', function(done){
        var app = express();

        app.use(function(req, res){
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .set('Host', '[::1]')
        .expect(200, [], done);
      }
```

#### should return an empty array

```ts
it('should return an empty array', function(done){
        var app = express();

        app.use(function(req, res){
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .set('Host', 'example.com')
        .expect(200, [], done);
      }
```

#### should return an empty array

```ts
it('should return an empty array', function(done){
        var app = express();

        app.use(function(req, res){
          req.headers.host = null;
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .expect(200, [], done);
      }
```

#### should return an array

```ts
it('should return an array', function (done) {
        var app = express();

        app.set('trust proxy', true);
        app.use(function (req, res) {
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .set('X-Forwarded-Host', 'tobi.ferrets.example.com')
        .expect(200, ['ferrets', 'tobi'], done);
      }
```

#### should return an array with the whole domain

```ts
it('should return an array with the whole domain', function(done){
          var app = express();
          app.set('subdomain offset', 0);

          app.use(function(req, res){
            res.send(req.subdomains);
          });

          request(app)
          .get('/')
          .set('Host', 'tobi.ferrets.sub.example.com')
          .expect(200, ['com', 'example', 'sub', 'ferrets', 'tobi'], done);
        }
```

#### should return an array with the whole IPv4

```ts
it('should return an array with the whole IPv4', function (done) {
          var app = express();
          app.set('subdomain offset', 0);

          app.use(function(req, res){
            res.send(req.subdomains);
          });

          request(app)
          .get('/')
          .set('Host', '127.0.0.1')
          .expect(200, ['127.0.0.1'], done);
        }
```

#### should return an array with the whole IPv6

```ts
it('should return an array with the whole IPv6', function (done) {
          var app = express();
          app.set('subdomain offset', 0);

          app.use(function(req, res){
            res.send(req.subdomains);
          });

          request(app)
          .get('/')
          .set('Host', '[::1]')
          .expect(200, ['[::1]'], done);
        }
```

#### should return an array

```ts
it('should return an array', function(done){
          var app = express();
          app.set('subdomain offset', 3);

          app.use(function(req, res){
            res.send(req.subdomains);
          });

          request(app)
          .get('/')
          .set('Host', 'tobi.ferrets.sub.example.com')
          .expect(200, ['ferrets', 'tobi'], done);
        }
```

#### should return an empty array

```ts
it('should return an empty array', function(done){
          var app = express();
          app.set('subdomain offset', 3);

          app.use(function(req, res){
            res.send(req.subdomains);
          });

          request(app)
          .get('/')
          .set('Host', 'sub.example.com')
          .expect(200, [], done);
        }
```

