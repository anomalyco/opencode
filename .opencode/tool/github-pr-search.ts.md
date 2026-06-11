# External tests for github-pr-search.ts

**Arquivo:** `.opencode/tool/github-pr-search.ts`

## Checklist

- [ ] @opencode-ai/plugin

## @opencode-ai/plugin

**Consultas usadas no Horsebox:** `schema.string`, `string`, `@opencode-ai/plugin string`, `opencode-ai/plugin string`, `plugin string`, `schema`, `@opencode-ai/plugin schema`, `opencode-ai/plugin schema`, `plugin schema`, `schema.number`, `number`, `@opencode-ai/plugin number`, `opencode-ai/plugin number`, `plugin number`, `tool`, `@opencode-ai/plugin tool`, `opencode-ai/plugin tool`, `plugin tool`

**Arquivos de teste encontrados:** 36

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/objects.js

#### keys

```ts
test('keys', function(assert) {
    assert.deepEqual(_.keys({one: 1, two: 2}), ['one', 'two'], 'can extract the keys from an object');
    // the test above is not safe because it relies on for-in enumeration order
    var a = []; a[1] = 0;
    assert.deepEqual(_.keys(a), ['1'], 'is not fooled by sparse arrays; see issue #95');
    assert.deepEqual(_.keys(null), []);
    assert.deepEqual(_.keys(void 0), []);
    assert.deepEqual(_.keys(1), []);
    assert.deepEqual(_.keys('a'), []);
    assert.deepEqual(_.keys(true), []);

    // keys that may be missed if the implementation isn't careful
    var trouble = {
      constructor: Object,
      valueOf: _.noop,
      hasOwnProperty: null,
      toString: 5,
      toLocaleString: void 0,
      propertyIsEnumerable: /a/,
      isPrototypeOf: this,
      __defineGetter__: Boolean,
      __defineSetter__: {},
      __lookupSetter__: false,
      __lookupGetter__: []
    };
    var troubleKeys = ['constructor', 'valueOf', 'hasOwnProperty', 'toString', 'toLocaleString', 'propertyIsEnumerable',
                  'isPrototypeOf', '__defineGetter__', '__defineSetter__', '__lookupSetter__', '__lookupGetter__'].sort();
    assert.deepEqual(_.keys(trouble).sort(), troubleKeys, 'matches non-enumerable properties');
  });

  QUnit.test('allKeys', function(assert) {
    assert.deepEqual(_.allKeys({one: 1, two: 2}), ['one', 'two'], 'can extract the allKeys from an object');
    // the test above is not safe because it relies on for-in enumeration order
    var a = []; a[1] = 0;
    assert.deepEqual(_.allKeys(a), ['1'], 'is not fooled by sparse arrays; see issue #95');

    a.a = a;
    assert.deepEqual(_.allKeys(a), ['1', 'a'], 'is not fooled by sparse arrays with additional properties');

    _.each([null, void 0, 1, 'a', true, NaN, {}, [], new Number(5), new Date(0)], function(val) {
      assert.deepEqual(_.allKeys(val), []);
    });

    // allKeys that may be missed if the implementation isn't careful
    var trouble = {
      constructor: Object,
      valueOf: _.noop,
      hasOwnProperty: null,
      toString: 5,
      toLocaleString: void 0,
      propertyIsEnumerable: /a/,
      isPrototypeOf: this
    };
    var troubleKeys = ['constructor', 'valueOf', 'hasOwnProperty', 'toString', 'toLocaleString', 'propertyIsEnumerable',
                  'isPrototypeOf'].sort();
    assert.deepEqual(_.allKeys(trouble).sort(), troubleKeys, 'matches non-enumerable properties');

    function A() {}
    A.prototype.foo = 'foo';
    var b = new A();
    b.bar = 'bar';
    assert.deepEqual(_.allKeys(b).sort(), ['bar', 'foo'], 'should include inherited keys');

    function y() {}
    y.x = 'z';
    assert.deepEqual(_.allKeys(y), ['x'], 'should get keys from constructor');
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

#### isEqual

```ts
test('isEqual', function(assert) {
    function First() {
      this.value = 1;
    }
    First.prototype.value = 1;
    function Second() {
      this.value = 1;
    }
    Second.prototype.value = 2;

    // Basic equality and identity comparisons.
    assert.ok(_.isEqual(null, null), '`null` is equal to `null`');
    assert.ok(_.isEqual(), '`undefined` is equal to `undefined`');

    assert.notOk(_.isEqual(0, -0), '`0` is not equal to `-0`');
    assert.notOk(_.isEqual(-0, 0), 'Commutative equality is implemented for `0` and `-0`');
    assert.notOk(_.isEqual(null, void 0), '`null` is not equal to `undefined`');
    assert.notOk(_.isEqual(void 0, null), 'Commutative equality is implemented for `null` and `undefined`');

    // String object and primitive comparisons.
    assert.ok(_.isEqual('Curly', 'Curly'), 'Identical string primitives are equal');
    assert.ok(_.isEqual(new String('Curly'), new String('Curly')), 'String objects with identical primitive values are equal');
    assert.ok(_.isEqual(new String('Curly'), 'Curly'), 'String primitives and their corresponding object wrappers are equal');
    assert.ok(_.isEqual('Curly', new String('Curly')), 'Commutative equality is implemented for string objects and primitives');

    assert.notOk(_.isEqual('Curly', 'Larry'), 'String primitives with different values are not equal');
    assert.notOk(_.isEqual(new String('Curly'), new String('Larry')), 'String objects with different primitive values are not equal');
    assert.notOk(_.isEqual(new String('Curly'), {toString: function(){ return 'Curly'; }}), 'String objects and objects with a custom `toString` method are not equal');

    // Number object and primitive comparisons.
    assert.ok(_.isEqual(75, 75), 'Identical number primitives are equal');
    assert.ok(_.isEqual(new Number(75), new Number(75)), 'Number objects with identical primitive values are equal');
    assert.ok(_.isEqual(75, new Number(75)), 'Number primitives and their corresponding object wrappers are equal');
    assert.ok(_.isEqual(new Number(75), 75), 'Commutative equality is implemented for number objects and primitives');
    assert.notOk(_.isEqual(new Number(0), -0), '`new Number(0)` and `-0` are not equal');
    assert.notOk(_.isEqual(0, new Number(-0)), 'Commutative equality is implemented for `new Number(0)` and `-0`');

    assert.notOk(_.isEqual(new Number(75), new Number(63)), 'Number objects with different primitive values are not equal');
    assert.notOk(_.isEqual(new Number(63), {valueOf: function(){ return 63; }}), 'Number objects and objects with a `valueOf` method are not equal');

    // Comparisons involving `NaN`.
    assert.ok(_.isEqual(NaN, NaN), '`NaN` is equal to `NaN`');
    assert.ok(_.isEqual(new Number(NaN), NaN), 'Object(`NaN`) is equal to `NaN`');
    assert.notOk(_.isEqual(61, NaN), 'A number primitive is not equal to `NaN`');
    assert.notOk(_.isEqual(new Number(79), NaN), 'A number object is not equal to `NaN`');
    assert.notOk(_.isEqual(Infinity, NaN), '`Infinity` is not equal to `NaN`');

    // Boolean object and primitive comparisons.
    assert.ok(_.isEqual(true, true), 'Identical boolean primitives are equal');
    assert.ok(_.isEqual(new Boolean, new Boolean), 'Boolean objects with identical primitive values are equal');
    assert.ok(_.isEqual(true, new Boolean(true)), 'Boolean primitives and their corresponding object wrappers are equal');
    assert.ok(_.isEqual(new Boolean(true), true), 'Commutative equality is implemented for booleans');
    assert.notOk(_.isEqual(new Boolean(true), new Boolean), 'Boolean objects with different primitive values are not equal');

    // Common type coercions.
    assert.notOk(_.isEqual(new Boolean(false), true), '`new Boolean(false)` is not equal to `true`');
    assert.notOk(_.isEqual('75', 75), 'String and number primitives with like values are not equal');
    assert.notOk(_.isEqual(new Number(63), new String(63)), 'String and number objects with like values are not equal');
    assert.notOk(_.isEqual(75, '75'), 'Commutative equality is implemented for like string and number values');
    assert.notOk(_.isEqual(0, ''), 'Number and string primitives with like values are not equal');
    assert.notOk(_.isEqual(1, true), 'Number and boolean primitives with like values are not equal');
    assert.notOk(_.isEqual(new Boolean(false), new Number(0)), 'Boolean and number objects with like values are not equal');
    assert.notOk(_.isEqual(false, new String('')), 'Boolean primitives and string objects with like values are not equal');
    assert.notOk(_.isEqual(12564504e5, new Date(2009, 9, 25)), 'Dates and their corresponding numeric primitive values are not equal');

    // Dates.
    assert.ok(_.isEqual(new Date(2009, 9, 25), new Date(2009, 9, 25)), 'Date objects referencing identical times are equal');
    assert.notOk(_.isEqual(new Date(2009, 9, 25), new Date(2009, 11, 13)), 'Date objects referencing different times are not equal');
    assert.notOk(_.isEqual(new Date(2009, 11, 13), {
      getTime: function(){
        return 12606876e5;
      }
    }), 'Date objects and objects with a `getTime` method are not equal');
    assert.notOk(_.isEqual(new Date('Curly'), new Date('Curly')), 'Invalid dates are not equal');

    // Functions.
    assert.notOk(_.isEqual(First, Second), 'Different functions with identical bodies and source code representations are not equal');

    // RegExps.
    assert.ok(_.isEqual(/(?:)/gim, /(?:)/gim), 'RegExps with equivalent patterns and flags are equal');
    assert.ok(_.isEqual(/(?:)/gi, /(?:)/ig), 'Flag order is not significant');
    assert.notOk(_.isEqual(/(?:)/g, /(?:)/gi), 'RegExps with equivalent patterns and different flags are not equal');
    assert.notOk(_.isEqual(/Moe/gim, /Curly/gim), 'RegExps with different patterns and equivalent flags are not equal');
    assert.notOk(_.isEqual(/(?:)/gi, /(?:)/g), 'Commutative equality is implemented for RegExps');
    assert.notOk(_.isEqual(/Curly/g, {source: 'Larry', global: true, ignoreCase: false, multiline: false}), 'RegExps and RegExp-like objects are not equal');

    // Empty arrays, array-like objects, and object literals.
    assert.ok(_.isEqual({}, {}), 'Empty object literals are equal');
    assert.ok(_.isEqual([], []), 'Empty array literals are equal');
    assert.ok(_.isEqual([{}], [{}]), 'Empty nested arrays and objects are equal');
    assert.notOk(_.isEqual({length: 0}, []), 'Array-like objects and arrays are not equal.');
    assert.notOk(_.isEqual([], {length: 0}), 'Commutative equality is implemented for array-like objects');

    assert.notOk(_.isEqual({}, []), 'Object literals and array literals are not equal');
    assert.notOk(_.isEqual([], {}), 'Commutative equality is implemented for objects and arrays');

    // Arrays with primitive and object values.
    assert.ok(_.isEqual([1, 'Larry', true], [1, 'Larry', true]), 'Arrays containing identical primitives are equal');
    assert.ok(_.isEqual([/Moe/g, new Date(2009, 9, 25)], [/Moe/g, new Date(2009, 9, 25)]), 'Arrays containing equivalent elements are equal');

    // Multi-dimensional arrays.
    var a = [new Number(47), false, 'Larry', /Moe/, new Date(2009, 11, 13), ['running', 'biking', new String('programming')], {a: 47}];
    var b = [new Number(47), false, 'Larry', /Moe/, new Date(2009, 11, 13), ['running', 'biking', new String('programming')], {a: 47}];
    assert.ok(_.isEqual(a, b), 'Arrays containing nested arrays and objects are recursively compared');

    // Overwrite the methods defined in ES 5.1 section 15.4.4.
    a.forEach = a.map = a.filter = a.every = a.indexOf = a.lastIndexOf = a.some = a.reduce = a.reduceRight = null;
    b.join = b.pop = b.reverse = b.shift = b.slice = b.splice = b.concat = b.sort = b.unshift = null;

    // Array elements and properties.
    assert.ok(_.isEqual(a, b), 'Arrays containing equivalent elements and different non-numeric properties are equal');
    a.push('White Rocks');
    assert.notOk(_.isEqual(a, b), 'Arrays of different lengths are not equal');
    a.push('East Boulder');
    b.push('Gunbarrel Ranch', 'Teller Farm');
    assert.notOk(_.isEqual(a, b), 'Arrays of identical lengths containing different elements are not equal');

    // Sparse arrays.
    assert.ok(_.isEqual(Array(3), Array(3)), 'Sparse arrays of identical lengths are equal');
    assert.notOk(_.isEqual(Array(3), Array(6)), 'Sparse arrays of different lengths are not equal when both are empty');

    var sparse = [];
    sparse[1] = 5;
    assert.ok(_.isEqual(sparse, [void 0, 5]), 'Handles sparse arrays as dense');

    // Simple objects.
    assert.ok(_.isEqual({a: 'Curly', b: 1, c: true}, {a: 'Curly', b: 1, c: true}), 'Objects containing identical primitives are equal');
    assert.ok(_.isEqual({a: /Curly/g, b: new Date(2009, 11, 13)}, {a: /Curly/g, b: new Date(2009, 11, 13)}), 'Objects containing equivalent members are equal');
    assert.notOk(_.isEqual({a: 63, b: 75}, {a: 61, b: 55}), 'Objects of identical sizes with different values are not equal');
    assert.notOk(_.isEqual({a: 63, b: 75}, {a: 61, c: 55}), 'Objects of identical sizes with different property names are not equal');
    assert.notOk(_.isEqual({a: 1, b: 2}, {a: 1}), 'Objects of different sizes are not equal');
    assert.notOk(_.isEqual({a: 1}, {a: 1, b: 2}), 'Commutative equality is implemented for objects');
    assert.notOk(_.isEqual({x: 1, y: void 0}, {x: 1, z: 2}), 'Objects with identical keys and different values are not equivalent');

    // `A` contains nested objects and arrays.
    a = {
      name: new String('Moe Howard'),
      age: new Number(77),
      stooge: true,
      hobbies: ['acting'],
      film: {
        name: 'Sing a Song of Six Pants',
        release: new Date(1947, 9, 30),
        stars: [new String('Larry Fine'), 'Shemp Howard'],
        minutes: new Number(16),
        seconds: 54
      }
    };

    // `B` contains equivalent nested objects and arrays.
    b = {
      name: new String('Moe Howard'),
      age: new Number(77),
      stooge: true,
      hobbies: ['acting'],
      film: {
        name: 'Sing a Song of Six Pants',
        release: new Date(1947, 9, 30),
        stars: [new String('Larry Fine'), 'Shemp Howard'],
        minutes: new Number(16),
        seconds: 54
      }
    };
    assert.ok(_.isEqual(a, b), 'Objects with nested equivalent members are recursively compared');

    // Instances.
    assert.ok(_.isEqual(new First, new First), 'Object instances are equal');
    assert.notOk(_.isEqual(new First, new Second), 'Objects with different constructors and identical own properties are not equal');
    assert.notOk(_.isEqual({value: 1}, new First), 'Object instances and objects sharing equivalent properties are not equal');
    assert.notOk(_.isEqual({value: 2}, new Second), 'The prototype chain of objects should not be examined');

    // Circular Arrays.
    (a = []).push(a);
    (b = []).push(b);
    assert.ok(_.isEqual(a, b), 'Arrays containing circular references are equal');
    a.push(new String('Larry'));
    b.push(new String('Larry'));
    assert.ok(_.isEqual(a, b), 'Arrays containing circular references and equivalent properties are equal');
    a.push('Shemp');
    b.push('Curly');
    assert.notOk(_.isEqual(a, b), 'Arrays containing circular references and different properties are not equal');

    // More circular arrays #767.
    a = ['everything is checked but', 'this', 'is not'];
    a[1] = a;
    b = ['everything is checked but', ['this', 'array'], 'is not'];
    assert.notOk(_.isEqual(a, b), 'Comparison of circular references with non-circular references are not equal');

    // Circular Objects.
    a = {abc: null};
    b = {abc: null};
    a.abc = a;
    b.abc = b;
    assert.ok(_.isEqual(a, b), 'Objects containing circular references are equal');
    a.def = 75;
    b.def = 75;
    assert.ok(_.isEqual(a, b), 'Objects containing circular references and equivalent properties are equal');
    a.def = new Number(75);
    b.def = new Number(63);
    assert.notOk(_.isEqual(a, b), 'Objects containing circular references and different properties are not equal');

    // More circular objects #767.
    a = {everything: 'is checked', but: 'this', is: 'not'};
    a.but = a;
    b = {everything: 'is checked', but: {that: 'object'}, is: 'not'};
    assert.notOk(_.isEqual(a, b), 'Comparison of circular references with non-circular object references are not equal');

    // Cyclic Structures.
    a = [{abc: null}];
    b = [{abc: null}];
    (a[0].abc = a).push(a);
    (b[0].abc = b).push(b);
    assert.ok(_.isEqual(a, b), 'Cyclic structures are equal');
    a[0].def = 'Larry';
    b[0].def = 'Larry';
    assert.ok(_.isEqual(a, b), 'Cyclic structures containing equivalent properties are equal');
    a[0].def = new String('Larry');
    b[0].def = new String('Curly');
    assert.notOk(_.isEqual(a, b), 'Cyclic structures containing different properties are not equal');

    // Complex Circular References.
    a = {foo: {b: {foo: {c: {foo: null}}}}};
    b = {foo: {b: {foo: {c: {foo: null}}}}};
    a.foo.b.foo.c.foo = a;
    b.foo.b.foo.c.foo = b;
    assert.ok(_.isEqual(a, b), 'Cyclic structures with nested and identically-named properties are equal');

    // Chaining.
    assert.notOk(_.isEqual(_({x: 1, y: void 0}).chain(), _({x: 1, z: 2}).chain()), 'Chained objects containing different values are not equal');

    a = _({x: 1, y: 2}).chain();
    b = _({x: 1, y: 2}).chain();
    assert.equal(_.isEqual(a.isEqual(b), _(true)), true, '`isEqual` can be chained');

    // Objects without a `constructor` property
    if (Object.create) {
      a = Object.create(null, {x: {value: 1, enumerable: true}});
      b = {x: 1};
      assert.ok(_.isEqual(a, b), 'Handles objects without a constructor (e.g. from Object.create');
    }

    function Foo() { this.a = 1; }
    Foo.prototype.constructor = null;

    var other = {a: 1};
    assert.strictEqual(_.isEqual(new Foo, other), false, 'Objects from different constructors are not equal');


    // Tricky object cases val comparisions
    assert.equal(_.isEqual([0], [-0]), false);
    assert.equal(_.isEqual({a: 0}, {a: -0}), false);
    assert.equal(_.isEqual([NaN], [NaN]), true);
    assert.equal(_.isEqual({a: NaN}, {a: NaN}), true);

    if (typeof Symbol !== 'undefined') {
      var symbol = Symbol('x');
      assert.strictEqual(_.isEqual(symbol, symbol), true, 'A symbol is equal to itself');
      assert.strictEqual(_.isEqual(symbol, Object(symbol)), true, 'Even when wrapped in Object()');
      assert.strictEqual(_.isEqual(symbol, null), false, 'Different types are not equal');
    }

  }
```

#### isEmpty

```ts
test('isEmpty', function(assert) {
    assert.notOk(_([1]).isEmpty(), '[1] is not empty');
    assert.ok(_.isEmpty([]), '[] is empty');
    assert.notOk(_.isEmpty({one: 1}), '{one: 1} is not empty');
    assert.ok(_.isEmpty({}), '{} is empty');
    assert.ok(_.isEmpty(new RegExp('')), 'objects with prototype properties are empty');
    assert.ok(_.isEmpty(null), 'null is empty');
    assert.ok(_.isEmpty(), 'undefined is empty');
    assert.ok(_.isEmpty(''), 'the empty string is empty');
    assert.notOk(_.isEmpty('moe'), 'but other strings are not');

    var obj = {one: 1};
    delete obj.one;
    assert.ok(_.isEmpty(obj), 'deleting all the keys from an object empties it');

    var args = function(){ return arguments; };
    assert.ok(_.isEmpty(args()), 'empty arguments object is empty');
    assert.notOk(_.isEmpty(args('')), 'non-empty arguments object is not empty');

    // covers collecting non-enumerable properties in IE < 9
    var nonEnumProp = {toString: 5};
    assert.notOk(_.isEmpty(nonEnumProp), 'non-enumerable property is not empty');
  }
```

#### isElement

```ts
test('isElement', function(assert) {
      assert.notOk(_.isElement('div'), 'strings are not dom elements');
      assert.ok(_.isElement(testElement), 'an element is a DOM element');
    }
```

#### isArguments

```ts
test('isArguments', function(assert) {
    var args = (function(){ return arguments; }(1, 2, 3));
    assert.notOk(_.isArguments('string'), 'a string is not an arguments object');
    assert.notOk(_.isArguments(_.isArguments), 'a function is not an arguments object');
    assert.ok(_.isArguments(args), 'but the arguments object is an arguments object');
    assert.notOk(_.isArguments(_.toArray(args)), 'but not when it\'s converted into an array');
    assert.notOk(_.isArguments([1, 2, 3]), 'and not vanilla arrays.');
  }
```

#### isObject

```ts
test('isObject', function(assert) {
    assert.ok(_.isObject(arguments), 'the arguments object is object');
    assert.ok(_.isObject([1, 2, 3]), 'and arrays');
    if (testElement) {
      assert.ok(_.isObject(testElement), 'and DOM element');
    }
    assert.ok(_.isObject(function() {}), 'and functions');
    assert.notOk(_.isObject(null), 'but not null');
    assert.notOk(_.isObject(void 0), 'and not undefined');
    assert.notOk(_.isObject('string'), 'and not string');
    assert.notOk(_.isObject(12), 'and not number');
    assert.notOk(_.isObject(true), 'and not boolean');
    assert.ok(_.isObject(new String('string')), 'but new String()');
  }
```

#### isString

```ts
test('isString', function(assert) {
    var obj = new String('I am a string object');
    if (testElement) {
      assert.notOk(_.isString(testElement), 'an element is not a string');
    }
    assert.ok(_.isString([1, 2, 3].join(', ')), 'but strings are');
    assert.strictEqual(_.isString('I am a string literal'), true, 'string literals are');
    assert.ok(_.isString(obj), 'so are String objects');
    assert.strictEqual(_.isString(1), false);
  }
```

#### isSymbol

```ts
test('isSymbol', function(assert) {
    assert.notOk(_.isSymbol(0), 'numbers are not symbols');
    assert.notOk(_.isSymbol(''), 'strings are not symbols');
    assert.notOk(_.isSymbol(_.isSymbol), 'functions are not symbols');
    if (typeof Symbol === 'function') {
      assert.ok(_.isSymbol(Symbol()), 'symbols are symbols');
      assert.ok(_.isSymbol(Symbol('description')), 'described symbols are symbols');
      assert.ok(_.isSymbol(Object(Symbol())), 'boxed symbols are symbols');
    }
  }
```

#### isNumber

```ts
test('isNumber', function(assert) {
    assert.notOk(_.isNumber('string'), 'a string is not a number');
    assert.notOk(_.isNumber(arguments), 'the arguments object is not a number');
    assert.notOk(_.isNumber(void 0), 'undefined is not a number');
    assert.ok(_.isNumber(3 * 4 - 7 / 10), 'but numbers are');
    assert.ok(_.isNumber(NaN), 'NaN *is* a number');
    assert.ok(_.isNumber(Infinity), 'Infinity is a number');
    assert.notOk(_.isNumber('1'), 'numeric strings are not numbers');
  }
```

#### isBoolean

```ts
test('isBoolean', function(assert) {
    assert.notOk(_.isBoolean(2), 'a number is not a boolean');
    assert.notOk(_.isBoolean('string'), 'a string is not a boolean');
    assert.notOk(_.isBoolean('false'), 'the string "false" is not a boolean');
    assert.notOk(_.isBoolean('true'), 'the string "true" is not a boolean');
    assert.notOk(_.isBoolean(arguments), 'the arguments object is not a boolean');
    assert.notOk(_.isBoolean(void 0), 'undefined is not a boolean');
    assert.notOk(_.isBoolean(NaN), 'NaN is not a boolean');
    assert.notOk(_.isBoolean(null), 'null is not a boolean');
    assert.ok(_.isBoolean(true), 'but true is');
    assert.ok(_.isBoolean(false), 'and so is false');
  }
```

#### isMap

```ts
test('isMap', function(assert) {
    assert.notOk(_.isMap('string'), 'a string is not a map');
    assert.notOk(_.isMap(2), 'a number is not a map');
    assert.notOk(_.isMap({}), 'an object is not a map');
    assert.notOk(_.isMap(false), 'a boolean is not a map');
    assert.notOk(_.isMap(void 0), 'undefined is not a map');
    assert.notOk(_.isMap([1, 2, 3]), 'an array is not a map');
    if (typeof Set === 'function') {
      assert.notOk(_.isMap(new Set()), 'a set is not a map');
    }
    if (typeof WeakSet === 'function') {
      assert.notOk(_.isMap(new WeakSet()), 'a weakset is not a map');
    }
    if (typeof WeakMap === 'function') {
      assert.notOk(_.isMap(new WeakMap()), 'a weakmap is not a map');
    }
    if (typeof Map === 'function') {
      var keyString = 'a string';
      var obj = new Map();
      obj.set(keyString, 'value');
      assert.ok(_.isMap(obj), 'but a map is');
    }
  }
```

#### isWeakMap

```ts
test('isWeakMap', function(assert) {
    assert.notOk(_.isWeakMap('string'), 'a string is not a weakmap');
    assert.notOk(_.isWeakMap(2), 'a number is not a weakmap');
    assert.notOk(_.isWeakMap({}), 'an object is not a weakmap');
    assert.notOk(_.isWeakMap(false), 'a boolean is not a weakmap');
    assert.notOk(_.isWeakMap(void 0), 'undefined is not a weakmap');
    assert.notOk(_.isWeakMap([1, 2, 3]), 'an array is not a weakmap');
    if (typeof Set === 'function') {
      assert.notOk(_.isWeakMap(new Set()), 'a set is not a weakmap');
    }
    if (typeof WeakSet === 'function') {
      assert.notOk(_.isWeakMap(new WeakSet()), 'a weakset is not a weakmap');
    }
    if (typeof Map === 'function') {
      assert.notOk(_.isWeakMap(new Map()), 'a map is not a weakmap');
    }
    if (typeof WeakMap === 'function') {
      var keyObj = {}, obj = new WeakMap();
      obj.set(keyObj, 'value');
      assert.ok(_.isWeakMap(obj), 'but a weakmap is');
    }
  }
```

#### isSet

```ts
test('isSet', function(assert) {
    assert.notOk(_.isSet('string'), 'a string is not a set');
    assert.notOk(_.isSet(2), 'a number is not a set');
    assert.notOk(_.isSet({}), 'an object is not a set');
    assert.notOk(_.isSet(false), 'a boolean is not a set');
    assert.notOk(_.isSet(void 0), 'undefined is not a set');
    assert.notOk(_.isSet([1, 2, 3]), 'an array is not a set');
    if (typeof Map === 'function') {
      assert.notOk(_.isSet(new Map()), 'a map is not a set');
    }
    if (typeof WeakMap === 'function') {
      assert.notOk(_.isSet(new WeakMap()), 'a weakmap is not a set');
    }
    if (typeof WeakSet === 'function') {
      assert.notOk(_.isSet(new WeakSet()), 'a weakset is not a set');
    }
    if (typeof Set === 'function') {
      var obj = new Set();
      obj.add(1).add('string').add(false).add({});
      assert.ok(_.isSet(obj), 'but a set is');
    }
  }
```

#### isWeakSet

```ts
test('isWeakSet', function(assert) {

    assert.notOk(_.isWeakSet('string'), 'a string is not a weakset');
    assert.notOk(_.isWeakSet(2), 'a number is not a weakset');
    assert.notOk(_.isWeakSet({}), 'an object is not a weakset');
    assert.notOk(_.isWeakSet(false), 'a boolean is not a weakset');
    assert.notOk(_.isWeakSet(void 0), 'undefined is not a weakset');
    assert.notOk(_.isWeakSet([1, 2, 3]), 'an array is not a weakset');
    if (typeof Map === 'function') {
      assert.notOk(_.isWeakSet(new Map()), 'a map is not a weakset');
    }
    if (typeof WeakMap === 'function') {
      assert.notOk(_.isWeakSet(new WeakMap()), 'a weakmap is not a weakset');
    }
    if (typeof Set === 'function') {
      assert.notOk(_.isWeakSet(new Set()), 'a set is not a weakset');
    }
    if (typeof WeakSet === 'function') {
      var obj = new WeakSet();
      obj.add({x: 1}, {y: 'string'}).add({y: 'string'}).add({z: [1, 2, 3]});
      assert.ok(_.isWeakSet(obj), 'but a weakset is');
    }
  }
```

#### isFunction

```ts
test('isFunction', function(assert) {
    assert.notOk(_.isFunction(void 0), 'undefined vars are not functions');
    assert.notOk(_.isFunction([1, 2, 3]), 'arrays are not functions');
    assert.notOk(_.isFunction('moe'), 'strings are not functions');
    assert.ok(_.isFunction(_.isFunction), 'but functions are');
    assert.ok(_.isFunction(function(){}), 'even anonymous ones');

    if (testElement) {
      assert.notOk(_.isFunction(testElement), 'elements are not functions');
    }

    var nodelist = typeof document != 'undefined' && document.childNodes;
    if (nodelist) {
      assert.notOk(_.isFunction(nodelist));
    }
  }
```

#### isDate

```ts
test('isDate', function(assert) {
    assert.notOk(_.isDate(100), 'numbers are not dates');
    assert.notOk(_.isDate({}), 'objects are not dates');
    assert.ok(_.isDate(new Date()), 'but dates are');
  }
```

#### isFinite

```ts
test('isFinite', function(assert) {
    assert.notOk(_.isFinite(void 0), 'undefined is not finite');
    assert.notOk(_.isFinite(null), 'null is not finite');
    assert.notOk(_.isFinite(NaN), 'NaN is not finite');
    assert.notOk(_.isFinite(Infinity), 'Infinity is not finite');
    assert.notOk(_.isFinite(-Infinity), '-Infinity is not finite');
    assert.ok(_.isFinite('12'), 'Numeric strings are numbers');
    assert.notOk(_.isFinite('1a'), 'Non numeric strings are not numbers');
    assert.notOk(_.isFinite(''), 'Empty strings are not numbers');
    var obj = new Number(5);
    assert.ok(_.isFinite(obj), 'Number instances can be finite');
    assert.ok(_.isFinite(0), '0 is finite');
    assert.ok(_.isFinite(123), 'Ints are finite');
    assert.ok(_.isFinite(-12.44), 'Floats are finite');
    if (typeof Symbol === 'function') {
      assert.notOk(_.isFinite(Symbol()), 'symbols are not numbers');
      assert.notOk(_.isFinite(Symbol('description')), 'described symbols are not numbers');
      assert.notOk(_.isFinite(Object(Symbol())), 'boxed symbols are not numbers');
    }
  }
```

#### isNaN

```ts
test('isNaN', function(assert) {
    assert.notOk(_.isNaN(void 0), 'undefined is not NaN');
    assert.notOk(_.isNaN(null), 'null is not NaN');
    assert.notOk(_.isNaN(0), '0 is not NaN');
    assert.notOk(_.isNaN(new Number(0)), 'wrapped 0 is not NaN');
    assert.ok(_.isNaN(NaN), 'but NaN is');
    assert.ok(_.isNaN(new Number(NaN)), 'wrapped NaN is still NaN');
    if (typeof Symbol !== 'undefined'){
      assert.notOk(_.isNaN(Symbol()), 'symbol is not NaN');
    }
  }
```

#### isUndefined

```ts
test('isUndefined', function(assert) {
    assert.notOk(_.isUndefined(1), 'numbers are defined');
    assert.notOk(_.isUndefined(null), 'null is defined');
    assert.notOk(_.isUndefined(false), 'false is defined');
    assert.notOk(_.isUndefined(NaN), 'NaN is defined');
    assert.ok(_.isUndefined(), 'nothing is undefined');
    assert.ok(_.isUndefined(void 0), 'undefined is undefined');
  }
```

#### isError

```ts
test('isError', function(assert) {
    assert.notOk(_.isError(1), 'numbers are not Errors');
    assert.notOk(_.isError(null), 'null is not an Error');
    assert.notOk(_.isError(Error), 'functions are not Errors');
    assert.ok(_.isError(new Error()), 'Errors are Errors');
    assert.ok(_.isError(new EvalError()), 'EvalErrors are Errors');
    assert.ok(_.isError(new RangeError()), 'RangeErrors are Errors');
    assert.ok(_.isError(new ReferenceError()), 'ReferenceErrors are Errors');
    assert.ok(_.isError(new SyntaxError()), 'SyntaxErrors are Errors');
    assert.ok(_.isError(new TypeError()), 'TypeErrors are Errors');
    assert.ok(_.isError(new URIError()), 'URIErrors are Errors');
  }
```

#### findKey

```ts
test('findKey', function(assert) {
    var objects = {
      a: {a: 0, b: 0},
      b: {a: 1, b: 1},
      c: {a: 2, b: 2}
    };

    assert.equal(_.findKey(objects, function(obj) {
      return obj.a === 0;
    }), 'a');

    assert.equal(_.findKey(objects, function(obj) {
      return obj.b * obj.a === 4;
    }), 'c');

    assert.equal(_.findKey(objects, 'a'), 'b', 'Uses lookupIterator');

    assert.equal(_.findKey(objects, function(obj) {
      return obj.b * obj.a === 5;
    }), void 0);

    assert.strictEqual(_.findKey([1, 2, 3, 4, 5, 6], function(obj) {
      return obj === 3;
    }), '2', 'Keys are strings');

    assert.strictEqual(_.findKey(objects, function(a) {
      return a.foo === null;
    }), void 0);

    _.findKey({a: {a: 1}}, function(a, key, obj) {
      assert.equal(key, 'a');
      assert.deepEqual(obj, {a: {a: 1}});
      assert.strictEqual(this, objects, 'called with context');
    }, objects);

    var array = [1, 2, 3, 4];
    array.match = 55;
    assert.strictEqual(_.findKey(array, function(x) { return x === 55; }), 'match', 'matches array-likes keys');
  }
```

#### mapObject

```ts
test('mapObject', function(assert) {
    var obj = {a: 1, b: 2};
    var objects = {
      a: {a: 0, b: 0},
      b: {a: 1, b: 1},
      c: {a: 2, b: 2}
    };

    assert.deepEqual(_.mapObject(obj, function(val) {
      return val * 2;
    }), {a: 2, b: 4}, 'simple objects');

    assert.deepEqual(_.mapObject(objects, function(val) {
      return _.reduce(val, function(memo, v){
        return memo + v;
      }, 0);
    }), {a: 0, b: 2, c: 4}, 'nested objects');

    assert.deepEqual(_.mapObject(obj, function(val, key, o) {
      return o[key] * 2;
    }), {a: 2, b: 4}, 'correct keys');

    assert.deepEqual(_.mapObject([1, 2], function(val) {
      return val * 2;
    }), {0: 2, 1: 4}, 'check behavior for arrays');

    assert.deepEqual(_.mapObject(obj, function(val) {
      return val * this.multiplier;
    }, {multiplier: 3}), {a: 3, b: 6}, 'keep context');

    assert.deepEqual(_.mapObject({a: 1}, function() {
      return this.length;
    }, [1, 2]), {a: 2}, 'called with context');

    var ids = _.mapObject({length: 2, 0: {id: '1'}, 1: {id: '2'}}, function(n){
      return n.id;
    });
    assert.deepEqual(ids, {length: void 0, 0: '1', 1: '2'}, 'Check with array-like objects');

    // Passing a property name like _.pluck.
    var people = {a: {name: 'moe', age: 30}, b: {name: 'curly', age: 50}};
    assert.deepEqual(_.mapObject(people, 'name'), {a: 'moe', b: 'curly'}, 'predicate string map to object properties');

    _.each([null, void 0, 1, 'abc', [], {}, void 0], function(val){
      assert.deepEqual(_.mapObject(val, _.identity), {}, 'mapValue identity');
    });

    var Proto = function(){ this.a = 1; };
    Proto.prototype.b = 1;
    var protoObj = new Proto();
    assert.deepEqual(_.mapObject(protoObj, _.identity), {a: 1}, 'ignore inherited values from prototypes');

  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/utility.js

#### random

```ts
test('random', function(assert) {
    var array = _.range(1000);
    var min = Math.pow(2, 31);
    var max = Math.pow(2, 62);

    assert.ok(_.every(array, function() {
      return _.random(min, max) >= min;
    }), 'should produce a random number greater than or equal to the minimum number');

    assert.ok(_.some(array, function() {
      return _.random(Number.MAX_VALUE) > 0;
    }), 'should produce a random number when passed `Number.MAX_VALUE`');
  }
```

#### mixin

```ts
test('mixin', function(assert) {
    var ret = _.mixin({
      myReverse: function(string) {
        return string.split('').reverse().join('');
      }
    });
    assert.equal(ret, _, 'returns the _ object to facilitate chaining');
    assert.equal(_.myReverse('panacea'), 'aecanap', 'mixed in a function to _');
    assert.equal(_('champ').myReverse(), 'pmahc', 'mixed in a function to the OOP wrapper');
  }
```

#### _.unescape

```ts
test('_.unescape', function(assert) {
    var string = 'Curly & Moe';
    assert.equal(_.unescape(null), '');
    assert.equal(_.unescape(_.escape(string)), string);
    assert.equal(_.unescape(string), string, 'don\'t unescape unnecessarily');
  }
```

#### _.escape & unescape

```ts
test('_.escape & unescape', function(assert) {
    // test & (&amp;) seperately obviously
    var escapeCharacters = ['<', '>', '"', '\'', '`'];

    _.each(escapeCharacters, function(escapeChar) {
      var s = 'a ' + escapeChar + ' string escaped';
      var e = _.escape(s);
      assert.notEqual(s, e, escapeChar + ' is escaped');
      assert.equal(s, _.unescape(e), escapeChar + ' can be unescaped');

      s = 'a ' + escapeChar + escapeChar + escapeChar + 'some more string' + escapeChar;
      e = _.escape(s);

      assert.equal(e.indexOf(escapeChar), -1, 'can escape multiple occurances of ' + escapeChar);
      assert.equal(_.unescape(e), s, 'multiple occurrences of ' + escapeChar + ' can be unescaped');
    });

    // handles multiple escape characters at once
    var joiner = ' other stuff ';
    var allEscaped = escapeCharacters.join(joiner);
    allEscaped += allEscaped;
    assert.ok(_.every(escapeCharacters, function(escapeChar) {
      return allEscaped.indexOf(escapeChar) !== -1;
    }), 'handles multiple characters');
    assert.ok(allEscaped.indexOf(joiner) >= 0, 'can escape multiple escape characters at the same time');

    // test & -> &amp;
    var str = 'some string & another string & yet another';
    var escaped = _.escape(str);

    assert.notStrictEqual(escaped.indexOf('&'), -1, 'handles & aka &amp;');
    assert.equal(_.unescape(str), str, 'can unescape &amp;');
  }
```

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

### ../../.sbomtest/repos/f3c62de455-express/test/res.set.js

#### should coerce to a string

```ts
it('should coerce to a string', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.set('X-Number', 123);
        res.end(typeof res.get('X-Number'));
      });

      request(app)
      .get('/')
      .expect('X-Number', '123')
      .expect(200, 'string', done);
    }
```

#### should coerce to an array of strings

```ts
it('should coerce to an array of strings', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.set('X-Numbers', [123, 456]);
        res.end(JSON.stringify(res.get('X-Numbers')));
      });

      request(app)
      .get('/')
      .expect('X-Numbers', '123, 456')
      .expect(200, '["123","456"]', done);
    }
```

#### should coerce to a string

```ts
it('should coerce to a string', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.set({ 'X-Number': 123 });
        res.end(typeof res.get('X-Number'));
      });

      request(app)
      .get('/')
      .expect('X-Number', '123')
      .expect(200, 'string', done);
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

#### should support loading ' + basename + ' in a web worker

```ts
test('should support loading ' + basename + ' in a web worker', function(assert) {
      assert.expect(1);

      var done = assert.async();

      if (Worker) {
        var limit = 30000 / QUnit.config.asyncRetries,
            start = +new Date;

        var attempt = function() {
          var actual = _._VERSION;
          if ((new Date - start) < limit && typeof actual != 'string') {
            setTimeout(attempt, 16);
            return;
          }
          assert.strictEqual(actual, _.VERSION);
          done();
        };

        attempt();
      }
      else {
        skipAssert(assert);
        done();
      }
    }
```

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

#### should work with numbers

```ts
test('should work with numbers', function(assert) {
      assert.expect(6);

      assert.strictEqual(_.camelCase('12 feet'), '12Feet');
      assert.strictEqual(_.camelCase('enable 6h format'), 'enable6HFormat');
      assert.strictEqual(_.camelCase('enable 24H format'), 'enable24HFormat');
      assert.strictEqual(_.camelCase('too legit 2 quit'), 'tooLegit2Quit');
      assert.strictEqual(_.camelCase('walk 500 miles'), 'walk500Miles');
      assert.strictEqual(_.camelCase('xhr2 request'), 'xhr2Request');
    }
```

#### should handle acronyms

```ts
test('should handle acronyms', function(assert) {
      assert.expect(6);

      lodashStable.each(['safe HTML', 'safeHTML'], function(string) {
        assert.strictEqual(_.camelCase(string), 'safeHtml');
      });

      lodashStable.each(['escape HTML entities', 'escapeHTMLEntities'], function(string) {
        assert.strictEqual(_.camelCase(string), 'escapeHtmlEntities');
      });

      lodashStable.each(['XMLHttpRequest', 'XmlHTTPRequest'], function(string) {
        assert.strictEqual(_.camelCase(string), 'xmlHttpRequest');
      });
    }
```

#### should capitalize the first character of a string

```ts
test('should capitalize the first character of a string', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.capitalize('fred'), 'Fred');
      assert.strictEqual(_.capitalize('Fred'), 'Fred');
      assert.strictEqual(_.capitalize(' fred'), ' fred');
    }
```

#### should clamp negative numbers

```ts
test('should clamp negative numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.clamp(-10, -5, 5), -5);
      assert.strictEqual(_.clamp(-10.2, -5.5, 5.5), -5.5);
      assert.strictEqual(_.clamp(-Infinity, -5, 5), -5);
    }
```

#### should clamp positive numbers

```ts
test('should clamp positive numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.clamp(10, -5, 5), 5);
      assert.strictEqual(_.clamp(10.6, -5.6, 5.4), 5.4);
      assert.strictEqual(_.clamp(Infinity, -5, 5), 5);
    }
```

#### should not alter negative numbers in range

```ts
test('should not alter negative numbers in range', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.clamp(-4, -5, 5), -4);
      assert.strictEqual(_.clamp(-5, -5, 5), -5);
      assert.strictEqual(_.clamp(-5.5, -5.6, 5.6), -5.5);
    }
```

#### should not alter positive numbers in range

```ts
test('should not alter positive numbers in range', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.clamp(4, -5, 5), 4);
      assert.strictEqual(_.clamp(5, -5, 5), 5);
      assert.strictEqual(_.clamp(4.5, -5.1, 5.2), 4.5);
    }
```

#### should return `NaN` when `number` is `NaN`

```ts
test('should return `NaN` when `number` is `NaN`', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.clamp(NaN, -5, 5), NaN);
    }
```

#### `_.' + methodName + '` should clone properties that shadow those on `Object.prototype`

```ts
test('`_.' + methodName + '` should clone properties that shadow those on `Object.prototype`', function(assert) {
        assert.expect(2);

        var object = {
          'constructor': objectProto.constructor,
          'hasOwnProperty': objectProto.hasOwnProperty,
          'isPrototypeOf': objectProto.isPrototypeOf,
          'propertyIsEnumerable': objectProto.propertyIsEnumerable,
          'toLocaleString': objectProto.toLocaleString,
          'toString': objectProto.toString,
          'valueOf': objectProto.valueOf
        };

        var actual = func(object);

        assert.deepEqual(actual, object);
        assert.notStrictEqual(actual, object);
      }
```

#### should work with a number for `iteratee`

```ts
test('should work with a number for `iteratee`', function(assert) {
      assert.expect(2);

      var array = [
        [1, 'a'],
        [2, 'a'],
        [2, 'b']
      ];

      assert.deepEqual(_.countBy(array, 0), { '1': 1, '2': 2 });
      assert.deepEqual(_.countBy(array, 1), { 'a': 2, 'b': 1 });
    }
```

#### should curry based on the number of arguments given

```ts
test('should curry based on the number of arguments given', function(assert) {
      assert.expect(3);

      var curried = _.curry(fn),
          expected = [1, 2, 3, 4];

      assert.deepEqual(curried(1)(2)(3)(4), expected);
      assert.deepEqual(curried(1, 2)(3, 4), expected);
      assert.deepEqual(curried(1, 2, 3, 4), expected);
    }
```

#### should curry based on the number of arguments given

```ts
test('should curry based on the number of arguments given', function(assert) {
      assert.expect(3);

      var curried = _.curryRight(fn),
          expected = [1, 2, 3, 4];

      assert.deepEqual(curried(4)(3)(2)(1), expected);
      assert.deepEqual(curried(3, 4)(1, 2), expected);
      assert.deepEqual(curried(1, 2, 3, 4), expected);
    }
```

#### should assign properties that shadow those on `Object.prototype`

```ts
test('should assign properties that shadow those on `Object.prototype`', function(assert) {
      assert.expect(2);

      var object = {
        'constructor': objectProto.constructor,
        'hasOwnProperty': objectProto.hasOwnProperty,
        'isPrototypeOf': objectProto.isPrototypeOf,
        'propertyIsEnumerable': objectProto.propertyIsEnumerable,
        'toLocaleString': objectProto.toLocaleString,
        'toString': objectProto.toString,
        'valueOf': objectProto.valueOf
      };

      var source = {
        'constructor': 1,
        'hasOwnProperty': 2,
        'isPrototypeOf': 3,
        'propertyIsEnumerable': 4,
        'toLocaleString': 5,
        'toString': 6,
        'valueOf': 7
      };

      var expected = lodashStable.clone(source);
      assert.deepEqual(_.defaults({}, source), expected);

      expected = lodashStable.clone(object);
      assert.deepEqual(_.defaults({}, object, source), expected);
    }
```

#### should not attempt a merge of a string into an array

```ts
test('should not attempt a merge of a string into an array', function(assert) {
      assert.expect(1);

      var actual = _.defaultsDeep({ 'a': ['abc'] }, { 'a': 'abc' });
      assert.deepEqual(actual.a, ['abc']);
    }
```

#### `_.' + methodName + '` should treat `-0` as `0`

```ts
test('`_.' + methodName + '` should treat `-0` as `0`', function(assert) {
      assert.expect(2);

      var array = [-0, 0];

      var actual = lodashStable.map(array, function(value) {
        return func(array, [value]);
      });

      assert.deepEqual(actual, [[], []]);

      actual = lodashStable.map(func([-0, 1], [1]), lodashStable.toString);
      assert.deepEqual(actual, ['0']);
    }
```

#### `_.' + methodName + '` should work with large arrays of `-0` as `0`

```ts
test('`_.' + methodName + '` should work with large arrays of `-0` as `0`', function(assert) {
      assert.expect(2);

      var array = [-0, 0];

      var actual = lodashStable.map(array, function(value) {
        var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, lodashStable.constant(value));
        return func(array, largeArray);
      });

      assert.deepEqual(actual, [[], []]);

      var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, stubOne);
      actual = lodashStable.map(func([-0, 1], largeArray), lodashStable.toString);
      assert.deepEqual(actual, ['0']);
    }
```

#### should preserve the sign of `0`

```ts
test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var array = [-0, 1],
          largeArray = lodashStable.times(LARGE_ARRAY_SIZE, stubOne),
          others = [[1], largeArray],
          expected = lodashStable.map(others, lodashStable.constant(['-0']));

      var actual = lodashStable.map(others, function(other) {
        return lodashStable.map(_.differenceWith(array, other, lodashStable.eq), lodashStable.toString);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should divide two numbers

```ts
test('should divide two numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.divide(6, 4), 1.5);
      assert.strictEqual(_.divide(-6, 4), -1.5);
      assert.strictEqual(_.divide(-6, -4), 1.5);
    }
```

#### should coerce arguments to numbers

```ts
test('should coerce arguments to numbers', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.divide('6', '4'), 1.5);
      assert.deepEqual(_.divide('x', 'y'), NaN);
    }
```

#### should return `true` if a string ends with `target`

```ts
test('should return `true` if a string ends with `target`', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.endsWith(string, 'c'), true);
    }
```

#### should return `false` if a string does not end with `target`

```ts
test('should return `false` if a string does not end with `target`', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.endsWith(string, 'b'), false);
    }
```

#### should work with a `position`

```ts
test('should work with a `position`', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.endsWith(string, 'b', 2), true);
    }
```

#### should work with `position` >= `length`

```ts
test('should work with `position` >= `length`', function(assert) {
      assert.expect(4);

      lodashStable.each([3, 5, MAX_SAFE_INTEGER, Infinity], function(position) {
        assert.strictEqual(_.endsWith(string, 'c', position), true);
      });
    }
```

#### should treat falsey `position` values, except `undefined`, as `0`

```ts
test('should treat falsey `position` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubTrue);

      var actual = lodashStable.map(falsey, function(position) {
        return _.endsWith(string, position === undefined ? 'c' : '', position);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should treat a negative `position` as `0`

```ts
test('should treat a negative `position` as `0`', function(assert) {
      assert.expect(6);

      lodashStable.each([-1, -3, -Infinity], function(position) {
        assert.ok(lodashStable.every(string, function(chr) {
          return !_.endsWith(string, chr, position);
        }));
        assert.strictEqual(_.endsWith(string, '', position), true);
      });
    }
```

#### should coerce `position` to an integer

```ts
test('should coerce `position` to an integer', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.endsWith(string, 'ab', 2.2), true);
    }
```

#### should handle strings with nothing to escape

```ts
test('should handle strings with nothing to escape', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.escape('abc'), 'abc');
    }
```

#### should handle strings with nothing to escape

```ts
test('should handle strings with nothing to escape', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.escapeRegExp('abc'), 'abc');
    }
```

#### should return an empty string for empty values

```ts
test('should return an empty string for empty values', function(assert) {
      assert.expect(1);

      var values = [, null, undefined, ''],
          expected = lodashStable.map(values, stubString);

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.escapeRegExp(value) : _.escapeRegExp();
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should iterate over own string keyed properties of objects

```ts
test('`_.' + methodName + '` should iterate over own string keyed properties of objects', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = [1, 2];
      }
      Foo.prototype.b = [3, 4];

      var actual = func(new Foo, identity);
      assert.deepEqual(actual, [1, 2]);
    }
```

#### `_.' + methodName + '` should treat number values for `collection` as empty

```ts
test('`_.' + methodName + '` should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(func(1), []);
    }
```

#### `_.' + methodName + '` should work with objects with non-number length properties

```ts
test('`_.' + methodName + '` should work with objects with non-number length properties', function(assert) {
      assert.expect(1);

      var object = { 'length': [1, 2] };
      assert.deepEqual(func(object, identity), [1, 2]);
    }
```

#### `_.' + methodName + '` iterates over inherited string keyed properties

```ts
test('`_.' + methodName + '` iterates over inherited string keyed properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var keys = [];
      func(new Foo, function(value, key) { keys.push(key); });
      assert.deepEqual(keys.sort(), ['a', 'b']);
    }
```

#### `_.' + methodName + '` iterates over own string keyed properties of objects

```ts
test('`_.' + methodName + '` iterates over own string keyed properties of objects', function(assert) {
        assert.expect(1);

        function Foo() {
          this.a = 1;
        }
        Foo.prototype.b = 2;

        if (func) {
          var values = [];
          func(new Foo, function(value) { values.push(value); });
          assert.deepEqual(values, [1]);
        }
        else {
          skipAssert(assert);
        }
      }
```

#### `_.' + methodName + '` should assign own ' + (isAssign ? '' : 'and inherited ') + 'string keyed source properties

```ts
test('`_.' + methodName + '` should assign own ' + (isAssign ? '' : 'and inherited ') + 'string keyed source properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var expected = isAssign ? { 'a': 1 } : { 'a': 1, 'b': 2 };
      assert.deepEqual(func({}, new Foo), expected);
    }
```

#### should work with the "__proto__" key in internal data objects

```ts
test('should work with the "__proto__" key in internal data objects', function(assert) {
      assert.expect(4);

      var stringLiteral = '__proto__',
          stringObject = Object(stringLiteral),
          expected = [stringLiteral, stringObject];

      var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, function(count) {
        return isEven(count) ? stringLiteral : stringObject;
      });

      assert.deepEqual(_.difference(largeArray, largeArray), []);
      assert.deepEqual(_.intersection(largeArray, largeArray), expected);
      assert.deepEqual(_.uniq(largeArray), expected);
      assert.deepEqual(_.without.apply(_, [largeArray].concat(largeArray)), []);
    }
```

#### should not indirectly merge builtin prototype properties

```ts
test('should not indirectly merge builtin prototype properties', function(assert) {
      assert.expect(2);

      _.merge({}, { 'toString': { 'constructor': { 'prototype': { 'a': 1 } } } });

      var actual = 'a' in funcProto;
      delete funcProto.a;

      assert.notOk(actual);

      _.merge({}, { 'constructor': { 'prototype': { 'a': 1 } } });

      actual = 'a' in objectProto;
      delete objectProto.a;

      assert.notOk(actual);
    }
```

#### should work with a number for `iteratee`

```ts
test('should work with a number for `iteratee`', function(assert) {
      assert.expect(2);

      var array = [
        [1, 'a'],
        [2, 'a'],
        [2, 'b']
      ];

      assert.deepEqual(_.groupBy(array, 0), { '1': [[1, 'a']], '2': [[2, 'a'], [2, 'b']] });
      assert.deepEqual(_.groupBy(array, 1), { 'a': [[1, 'a'], [2, 'a']], 'b': [[2, 'b']] });
    }
```

#### `_.' + methodName + '` should coerce `path` to a string

```ts
test('`_.' + methodName + '` should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var object = { 'null': 1 , 'undefined': 2, 'fn': 3, '[object Object]': 4 },
          paths = [null, undefined, fn, {}],
          expected = lodashStable.map(paths, stubTrue);

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          return func(object, index ? [path] : path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should work with a non-string `path`

```ts
test('`_.' + methodName + '` should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3];

      lodashStable.each([1, [1]], function(path) {
        assert.strictEqual(func(array, path), true);
      });
    }
```

#### `_.' + methodName + '` should return `true` for indexes of sparse values

```ts
test('`_.' + methodName + '` should return `true` for indexes of sparse values', function(assert) {
      assert.expect(1);

      var values = [sparseArgs, sparseArray, sparseString],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return func(value, 0);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should return `true` for indexes of sparse values with deep paths

```ts
test('`_.' + methodName + '` should return `true` for indexes of sparse values with deep paths', function(assert) {
      assert.expect(1);

      var values = [sparseArgs, sparseArray, sparseString],
          expected = lodashStable.map(values, lodashStable.constant([true, true]));

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.map(['a[0]', ['a', '0']], function(path) {
          return func({ 'a': value }, path);
        });
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should return `false` over sparse values of deep paths

```ts
test('`_.' + methodName + '` should return `false` over sparse values of deep paths', function(assert) {
      assert.expect(1);

      var values = [sparseArgs, sparseArray, sparseString],
          expected = lodashStable.map(values, lodashStable.constant([false, false]));

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.map(['a[0].b', ['a', '0', 'b']], function(path) {
          return func({ 'a': value }, path);
        });
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work with a string ' + key + ' for `collection`

```ts
test('should work with a string ' + key + ' for `collection`', function(assert) {
        assert.expect(2);

        assert.strictEqual(_.includes(collection, 'bc'), true);
        assert.strictEqual(_.includes(collection, 'd'), false);
      }
```

#### should work with a string and a `fromIndex` >= `length`

```ts
test('should work with a string and a `fromIndex` >= `length`', function(assert) {
      assert.expect(1);

      var string = '1234',
          length = string.length,
          indexes = [4, 6, Math.pow(2, 32), Infinity];

      var expected = lodashStable.map(indexes, function(index) {
        return [false, false, index == length];
      });

      var actual = lodashStable.map(indexes, function(fromIndex) {
        return [
          _.includes(string, 1, fromIndex),
          _.includes(string, undefined, fromIndex),
          _.includes(string, '', fromIndex)
        ];
      });

      assert.deepEqual(actual, expected);
    }
```

#### should coerce arguments to finite numbers

```ts
test('should coerce arguments to finite numbers', function(assert) {
      assert.expect(1);

      var actual = [
        _.inRange(0, '1'),
        _.inRange(0, '0', 1),
        _.inRange(0, 0, '1'),
        _.inRange(0, NaN, 1),
        _.inRange(-1, -1, NaN)
      ];

      assert.deepEqual(actual, lodashStable.map(actual, stubTrue));
    }
```

#### `_.' + methodName + '` should treat `-0` as `0`

```ts
test('`_.' + methodName + '` should treat `-0` as `0`', function(assert) {
      assert.expect(1);

      var values = [-0, 0],
          expected = lodashStable.map(values, lodashStable.constant(['0']));

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.map(func(values, [value]), lodashStable.toString);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should work with large arrays of `-0` as `0`

```ts
test('`_.' + methodName + '` should work with large arrays of `-0` as `0`', function(assert) {
      assert.expect(1);

      var values = [-0, 0],
          expected = lodashStable.map(values, lodashStable.constant(['0']));

      var actual = lodashStable.map(values, function(value) {
        var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, lodashStable.constant(value));
        return lodashStable.map(func(values, largeArray), lodashStable.toString);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should treat number values for `collection` as empty

```ts
test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.invokeMap(1), []);
    }
```

#### should work with an array from another realm

```ts
test('should work with an array from another realm', function(assert) {
      assert.expect(1);

      if (realm.object) {
        var values = [realm.arguments, realm.array, realm.string],
            expected = lodashStable.map(values, stubTrue),
            actual = lodashStable.map(values, _.isArrayLike);

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should work with jQuery/MooTools DOM query collections

```ts
test('should work with jQuery/MooTools DOM query collections', function(assert) {
      assert.expect(1);

      function Foo(elements) {
        push.apply(this, elements);
      }
      Foo.prototype = { 'length': 0, 'splice': arrayProto.splice };

      assert.strictEqual(_.isEmpty(new Foo([])), true);
    }
```

#### should not treat objects with non-number lengths as array-like

```ts
test('should not treat objects with non-number lengths as array-like', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.isEmpty({ 'length': '0' }), false);
    }
```

#### should return `false` for objects with custom `toString` methods

```ts
test('should return `false` for objects with custom `toString` methods', function(assert) {
      assert.expect(1);

      var primitive,
          object = { 'toString': function() { return primitive; } },
          values = [true, null, 1, 'a', undefined],
          expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value) {
        primitive = value;
        return _.isEqual(object, value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should not handle comparisons when `customizer` returns `true`

```ts
test('should not handle comparisons when `customizer` returns `true`', function(assert) {
      assert.expect(3);

      var customizer = function(value) {
        return _.isString(value) || undefined;
      };

      assert.strictEqual(_.isEqualWith('a', 'b', customizer), true);
      assert.strictEqual(_.isEqualWith(['a'], ['b'], customizer), true);
      assert.strictEqual(_.isEqualWith({ '0': 'a' }, { '0': 'b' }, customizer), true);
    }
```

#### should not handle comparisons when `customizer` returns `false`

```ts
test('should not handle comparisons when `customizer` returns `false`', function(assert) {
      assert.expect(3);

      var customizer = function(value) {
        return _.isString(value) ? false : undefined;
      };

      assert.strictEqual(_.isEqualWith('a', 'a', customizer), false);
      assert.strictEqual(_.isEqualWith(['a'], ['a'], customizer), false);
      assert.strictEqual(_.isEqualWith({ '0': 'a' }, { '0': 'a' }, customizer), false);
    }
```

#### should return `false` for numeric string values

```ts
test('should return `false` for numeric string values', function(assert) {
      assert.expect(1);

      var values = ['2', '0', '08'],
          expected = lodashStable.map(values, stubFalse),
          actual = lodashStable.map(values, _.isFinite);

      assert.deepEqual(actual, expected);
    }
```

#### should return `true` for array view constructors

```ts
test('should return `true` for array view constructors', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(arrayViews, function(type) {
        return objToString.call(root[type]) == funcTag;
      });

      var actual = lodashStable.map(arrayViews, function(type) {
        return _.isFunction(root[type]);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `false` for non-integer number values

```ts
test('should return `false` for non-integer number values', function(assert) {
      assert.expect(1);

      var values = [NaN, Infinity, -Infinity, Object(1), 3.14],
          expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value) {
        return func(value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should not handle comparisons when `customizer` returns `true`

```ts
test('should not handle comparisons when `customizer` returns `true`', function(assert) {
      assert.expect(2);

      var customizer = function(value) {
        return _.isString(value) || undefined;
      };

      assert.strictEqual(_.isMatchWith(['a'], ['b'], customizer), true);
      assert.strictEqual(_.isMatchWith({ '0': 'a' }, { '0': 'b' }, customizer), true);
    }
```

#### should not handle comparisons when `customizer` returns `false`

```ts
test('should not handle comparisons when `customizer` returns `false`', function(assert) {
      assert.expect(2);

      var customizer = function(value) {
        return _.isString(value) ? false : undefined;
      };

      assert.strictEqual(_.isMatchWith(['a'], ['a'], customizer), false);
      assert.strictEqual(_.isMatchWith({ '0': 'a' }, { '0': 'a' }, customizer), false);
    }
```

#### should return `true` for numbers

```ts
test('should return `true` for numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.isNumber(0), true);
      assert.strictEqual(_.isNumber(Object(0)), true);
      assert.strictEqual(_.isNumber(NaN), true);
    }
```

#### should return `false` for non-numbers

```ts
test('should return `false` for non-numbers', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, function(value) {
        return typeof value == 'number';
      });

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isNumber(value) : _.isNumber();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isNumber(args), false);
      assert.strictEqual(_.isNumber([1, 2, 3]), false);
      assert.strictEqual(_.isNumber(true), false);
      assert.strictEqual(_.isNumber(new Date), false);
      assert.strictEqual(_.isNumber(new Error), false);
      assert.strictEqual(_.isNumber(_), false);
      assert.strictEqual(_.isNumber(slice), false);
      assert.strictEqual(_.isNumber({ 'a': 1 }), false);
      assert.strictEqual(_.isNumber(/x/), false);
      assert.strictEqual(_.isNumber('a'), false);
      assert.strictEqual(_.isNumber(symbol), false);
    }
```

#### should work with numbers from another realm

```ts
test('should work with numbers from another realm', function(assert) {
      assert.expect(1);

      if (realm.number) {
        assert.strictEqual(_.isNumber(realm.number), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should work with objects from another realm

```ts
test('should work with objects from another realm', function(assert) {
      assert.expect(8);

      if (realm.element) {
        assert.strictEqual(_.isObject(realm.element), true);
      }
      else {
        skipAssert(assert);
      }
      if (realm.object) {
        assert.strictEqual(_.isObject(realm.boolean), true);
        assert.strictEqual(_.isObject(realm.date), true);
        assert.strictEqual(_.isObject(realm.function), true);
        assert.strictEqual(_.isObject(realm.number), true);
        assert.strictEqual(_.isObject(realm.object), true);
        assert.strictEqual(_.isObject(realm.regexp), true);
        assert.strictEqual(_.isObject(realm.string), true);
      }
      else {
        skipAssert(assert, 7);
      }
    }
```

#### should work with objects from another realm

```ts
test('should work with objects from another realm', function(assert) {
      assert.expect(6);

      if (realm.object) {
        assert.strictEqual(_.isObjectLike(realm.boolean), true);
        assert.strictEqual(_.isObjectLike(realm.date), true);
        assert.strictEqual(_.isObjectLike(realm.number), true);
        assert.strictEqual(_.isObjectLike(realm.object), true);
        assert.strictEqual(_.isObjectLike(realm.regexp), true);
        assert.strictEqual(_.isObjectLike(realm.string), true);
      }
      else {
        skipAssert(assert, 6);
      }
    }
```

#### should return `true` for objects with a writable `Symbol.toStringTag` property

```ts
test('should return `true` for objects with a writable `Symbol.toStringTag` property', function(assert) {
      assert.expect(1);

      if (Symbol && Symbol.toStringTag) {
        var object = {};
        object[Symbol.toStringTag] = 'X';

        assert.deepEqual(_.isPlainObject(object), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for objects with a read-only `Symbol.toStringTag` property

```ts
test('should return `false` for objects with a read-only `Symbol.toStringTag` property', function(assert) {
      assert.expect(1);

      if (Symbol && Symbol.toStringTag) {
        var object = {};
        defineProperty(object, Symbol.toStringTag, {
          'configurable': true,
          'enumerable': false,
          'writable': false,
          'value': 'X'
        });

        assert.deepEqual(_.isPlainObject(object), false);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should not mutate `value`

```ts
test('should not mutate `value`', function(assert) {
      assert.expect(2);

      if (Symbol && Symbol.toStringTag) {
        var proto = {};
        proto[Symbol.toStringTag] = undefined;
        var object = create(proto);

        assert.strictEqual(_.isPlainObject(object), false);
        assert.notOk(lodashStable.has(object, Symbol.toStringTag));
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should return `true` for strings

```ts
test('should return `true` for strings', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.isString('a'), true);
      assert.strictEqual(_.isString(Object('a')), true);
    }
```

#### should return `false` for non-strings

```ts
test('should return `false` for non-strings', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, function(value) {
        return value === '';
      });

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isString(value) : _.isString();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isString(args), false);
      assert.strictEqual(_.isString([1, 2, 3]), false);
      assert.strictEqual(_.isString(true), false);
      assert.strictEqual(_.isString(new Date), false);
      assert.strictEqual(_.isString(new Error), false);
      assert.strictEqual(_.isString(_), false);
      assert.strictEqual(_.isString(slice), false);
      assert.strictEqual(_.isString({ '0': 1, 'length': 1 }), false);
      assert.strictEqual(_.isString(1), false);
      assert.strictEqual(_.isString(/x/), false);
      assert.strictEqual(_.isString(symbol), false);
    }
```

#### should work with strings from another realm

```ts
test('should work with strings from another realm', function(assert) {
      assert.expect(1);

      if (realm.string) {
        assert.strictEqual(_.isString(realm.string), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for subclassed values

```ts
test('should return `false` for subclassed values', function(assert) {
      assert.expect(7);

      var funcs = [
        'isArray', 'isBoolean', 'isDate', 'isFunction',
        'isNumber', 'isRegExp', 'isString'
      ];

      lodashStable.each(funcs, function(methodName) {
        function Foo() {}
        Foo.prototype = root[methodName.slice(2)].prototype;

        var object = new Foo;
        if (objToString.call(object) == objectTag) {
          assert.strictEqual(_[methodName](object), false, '`_.' + methodName + '` returns `false`');
        }
        else {
          skipAssert(assert);
        }
      });
    }
```

#### should not error on host objects (test in IE)

```ts
test('should not error on host objects (test in IE)', function(assert) {
      assert.expect(26);

      var funcs = [
        'isArguments', 'isArray', 'isArrayBuffer', 'isArrayLike', 'isBoolean',
        'isBuffer', 'isDate', 'isElement', 'isError', 'isFinite', 'isFunction',
        'isInteger', 'isMap', 'isNaN', 'isNil', 'isNull', 'isNumber', 'isObject',
        'isObjectLike', 'isRegExp', 'isSet', 'isSafeInteger', 'isString',
        'isUndefined', 'isWeakMap', 'isWeakSet'
      ];

      lodashStable.each(funcs, function(methodName) {
        if (xml) {
          _[methodName](xml);
          assert.ok(true, '`_.' + methodName + '` should not error');
        }
        else {
          skipAssert(assert);
        }
      });
    }
```

#### should return an iteratee created by `_.property` when `func` is a number or string

```ts
test('should return an iteratee created by `_.property` when `func` is a number or string', function(assert) {
      assert.expect(2);

      var array = ['a'],
          prop = _.iteratee(0);

      assert.strictEqual(prop(array), 'a');

      prop = _.iteratee('0');
      assert.strictEqual(prop(array), 'a');
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var fn = function() { return this instanceof Number; },
          array = [fn, fn, fn],
          iteratees = lodashStable.map(array, _.iteratee),
          expected = lodashStable.map(array, stubFalse);

      var actual = lodashStable.map(iteratees, function(iteratee) {
        return iteratee();
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return join all array elements into a string

```ts
test('should return join all array elements into a string', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.join(array, '~'), 'a~b~c');
    }
```

#### should transform keys by `iteratee`

```ts
test('should transform keys by `iteratee`', function(assert) {
      assert.expect(1);

      var expected = { 'a': { 'dir': 'left', 'code': 97 }, 'd': { 'dir': 'right', 'code': 100 } };

      var actual = _.keyBy(array, function(object) {
        return String.fromCharCode(object.code);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work with a number for `iteratee`

```ts
test('should work with a number for `iteratee`', function(assert) {
      assert.expect(2);

      var array = [
        [1, 'a'],
        [2, 'a'],
        [2, 'b']
      ];

      assert.deepEqual(_.keyBy(array, 0), { '1': [1, 'a'], '2': [2, 'b'] });
      assert.deepEqual(_.keyBy(array, 1), { 'a': [2, 'a'], 'b': [2, 'b'] });
    }
```

#### `_.' + methodName + '` should return the string keyed property names of `object`

```ts
test('`_.' + methodName + '` should return the string keyed property names of `object`', function(assert) {
      assert.expect(1);

      var actual = func({ 'a': 1, 'b': 1 }).sort();

      assert.deepEqual(actual, ['a', 'b']);
    }
```

#### `_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties

```ts
test('`_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var expected = isKeys ? ['a'] : ['a', 'b'],
          actual = func(new Foo).sort();

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of arrays

```ts
test('`_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of arrays', function(assert) {
      assert.expect(1);

      arrayProto.a = 1;

      var expected = isKeys ? ['0'] : ['0', 'a'],
          actual = func([1]).sort();

      assert.deepEqual(actual, expected);

      delete arrayProto.a;
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

#### `_.' + methodName + '` should work with string objects

```ts
test('`_.' + methodName + '` should work with string objects', function(assert) {
      assert.expect(1);

      var actual = func(Object('abc')).sort();

      assert.deepEqual(actual, ['0', '1', '2']);
    }
```

#### `_.' + methodName + '` should return keys for custom properties on string objects

```ts
test('`_.' + methodName + '` should return keys for custom properties on string objects', function(assert) {
      assert.expect(1);

      var object = Object('a');
      object.a = 1;

      var actual = func(object).sort();

      assert.deepEqual(actual, ['0', 'a']);
    }
```

#### `_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of string objects

```ts
test('`_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of string objects', function(assert) {
      assert.expect(1);

      stringProto.a = 1;

      var expected = isKeys ? ['0'] : ['0', 'a'],
          actual = func(Object('a')).sort();

      assert.deepEqual(actual, expected);

      delete stringProto.a;
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

#### should assign non array/buffer/typed-array/plain-object source values directly

```ts
test('should assign non array/buffer/typed-array/plain-object source values directly', function(assert) {
      assert.expect(1);

      function Foo() {}

      var values = [new Foo, new Boolean, new Date, Foo, new Number, new String, new RegExp],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        var object = _.merge({}, { 'a': value, 'b': { 'c': value } });
        return object.a === value && object.b.c === value;
      });

      assert.deepEqual(actual, expected);
    }
```

#### should not convert strings to arrays when merging arrays of `source`

```ts
test('should not convert strings to arrays when merging arrays of `source`', function(assert) {
      assert.expect(1);

      var object = { 'a': 'abcde' },
          actual = _.merge(object, { 'a': ['x', 'y', 'z'] });

      assert.deepEqual(actual, { 'a': ['x', 'y', 'z'] });
    }
```

#### should work with a non-string `path`

```ts
test('should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = lodashStable.times(3, _.constant);

      lodashStable.each([1, [1]], function(path) {
        var method = _.method(path);
        assert.strictEqual(method(array), 1);
      });
    }
```

#### should coerce `path` to a string

```ts
test('should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var expected = [1, 2, 3, 4],
          object = { 'null': stubOne, 'undefined': stubTwo, 'fn': stubThree, '[object Object]': stubFour },
          paths = [null, undefined, fn, {}];

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          var method = _.method(index ? [path] : path);
          return method(object);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should work with a non-string `path`

```ts
test('should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = lodashStable.times(3, _.constant);

      lodashStable.each([1, [1]], function(path) {
        var methodOf = _.methodOf(array);
        assert.strictEqual(methodOf(path), 1);
      });
    }
```

#### should coerce `path` to a string

```ts
test('should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var expected = [1, 2, 3, 4],
          object = { 'null': stubOne, 'undefined': stubTwo, 'fn': stubThree, '[object Object]': stubFour },
          paths = [null, undefined, fn, {}];

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          var methodOf = _.methodOf(object);
          return methodOf(index ? [path] : path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should multiply two numbers

```ts
test('should multiply two numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.multiply(6, 4), 24);
      assert.strictEqual(_.multiply(-6, 4), -24);
      assert.strictEqual(_.multiply(-6, -4), 24);
    }
```

#### should coerce arguments to numbers

```ts
test('should coerce arguments to numbers', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.multiply('6', '4'), 24);
      assert.deepEqual(_.multiply('x', 'y'), NaN);
    }
```

#### should work with `orders` specified as string objects

```ts
test('should work with `orders` specified as string objects', function(assert) {
      assert.expect(1);

      var actual = _.orderBy(objects, ['a'], [Object('desc')]);
      assert.deepEqual(actual, [objects[1], objects[3], objects[0], objects[2]]);
    }
```

#### should flatten `transforms`

```ts
test('should flatten `transforms`', function(assert) {
      assert.expect(1);

      var over = _.overArgs(fn, [doubled, square], String);
      assert.deepEqual(over(5, 10, 15), [10, 100, '15']);
    }
```

#### should not transform any argument greater than the number of transforms

```ts
test('should not transform any argument greater than the number of transforms', function(assert) {
      assert.expect(1);

      var over = _.overArgs(fn, doubled, square);
      assert.deepEqual(over(5, 10, 18), [10, 100, 18]);
    }
```

#### should return the number of milliseconds that have elapsed since the Unix epoch

```ts
test('should return the number of milliseconds that have elapsed since the Unix epoch', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var stamp = +new Date,
          actual = _.now();

      assert.ok(actual >= stamp);

      setTimeout(function() {
        assert.ok(_.now() > actual);
        done();
      }, 32);
    }
```

#### should coerce `paths` to strings

```ts
test('should coerce `paths` to strings', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.omit({ '0': 'a' }, 0), {});
    }
```

#### should work with a primitive `object`

```ts
test('should work with a primitive `object`', function(assert) {
      assert.expect(1);

      stringProto.a = 1;
      stringProto.b = 2;

      assert.deepEqual(_.omit('', 'b'), { 'a': 1 });

      delete stringProto.a;
      delete stringProto.b;
    }
```

#### Security: _.omit should not allow modifying prototype or constructor properties

```ts
test('Security: _.omit should not allow modifying prototype or constructor properties', function(assert) {
      assert.expect(3);

      var testObj1 = {};
      assert.strictEqual(typeof testObj1.toString, 'function', 'Object.toString should work before omit');

      _.omit({}, ['__proto__.toString']);
      _.omit({}, ['constructor.prototype.toString']);
      _.omit({}, [['constructor'], ['prototype'], ['toString']]);

      var testObj2 = {};
      assert.strictEqual(typeof testObj2.toString, 'function', 'Object.toString should still work after omit');
      assert.strictEqual(objectProto.toString.call({}), '[object Object]', 'Object.toString should behave as expected');
    }
```

#### `_.' + methodName + '` should create an object with omitted string keyed properties

```ts
test('`_.' + methodName + '` should create an object with omitted string keyed properties', function(assert) {
      assert.expect(2);

      assert.deepEqual(func(object, resolve(object, 'a')), { 'b': 2, 'c': 3, 'd': 4 });
      assert.deepEqual(func(object, resolve(object, ['a', 'c'])), expected);
    }
```

#### `_.' + methodName + '` should include inherited string keyed properties

```ts
test('`_.' + methodName + '` should include inherited string keyed properties', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.prototype = object;

      assert.deepEqual(func(new Foo, resolve(object, ['a', 'c'])), expected);
    }
```

#### should create a function that returns `true` if any predicates return truthy

```ts
test('should create a function that returns `true` if any predicates return truthy', function(assert) {
      assert.expect(2);

      var over = _.overSome(stubFalse, stubOne, stubString);
      assert.strictEqual(over(), true);

      over = _.overSome(stubNull, stubA, stubZero);
      assert.strictEqual(over(), true);
    }
```

#### should return `false` if all predicates return falsey

```ts
test('should return `false` if all predicates return falsey', function(assert) {
      assert.expect(2);

      var over = _.overSome(stubFalse, stubFalse, stubFalse);
      assert.strictEqual(over(), false);

      over = _.overSome(stubNull, stubZero, stubString);
      assert.strictEqual(over(), false);
    }
```

#### should pad a string to a given length

```ts
test('should pad a string to a given length', function(assert) {
      assert.expect(1);

      var values = [, undefined],
          expected = lodashStable.map(values, lodashStable.constant(' abc  '));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.pad(string, 6, value) : _.pad(string, 6);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should truncate pad characters to fit the pad length

```ts
test('should truncate pad characters to fit the pad length', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.pad(string, 8), '  abc   ');
      assert.strictEqual(_.pad(string, 8, '_-'), '_-abc_-_');
    }
```

#### should coerce `string` to a string

```ts
test('should coerce `string` to a string', function(assert) {
      assert.expect(1);

      var values = [Object(string), { 'toString': lodashStable.constant(string) }],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return _.pad(value, 6) === ' abc  ';
      });

      assert.deepEqual(actual, expected);
    }
```

#### should pad a string to a given length

```ts
test('should pad a string to a given length', function(assert) {
      assert.expect(1);

      var values = [, undefined],
          expected = lodashStable.map(values, lodashStable.constant('abc   '));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.padEnd(string, 6, value) : _.padEnd(string, 6);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should truncate pad characters to fit the pad length

```ts
test('should truncate pad characters to fit the pad length', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.padEnd(string, 6, '_-'), 'abc_-_');
    }
```

#### should coerce `string` to a string

```ts
test('should coerce `string` to a string', function(assert) {
      assert.expect(1);

      var values = [Object(string), { 'toString': lodashStable.constant(string) }],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return _.padEnd(value, 6) === 'abc   ';
      });

      assert.deepEqual(actual, expected);
    }
```

#### should pad a string to a given length

```ts
test('should pad a string to a given length', function(assert) {
      assert.expect(1);

      var values = [, undefined],
          expected = lodashStable.map(values, lodashStable.constant('   abc'));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.padStart(string, 6, value) : _.padStart(string, 6);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should truncate pad characters to fit the pad length

```ts
test('should truncate pad characters to fit the pad length', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.padStart(string, 6, '_-'), '_-_abc');
    }
```

#### should coerce `string` to a string

```ts
test('should coerce `string` to a string', function(assert) {
      assert.expect(1);

      var values = [Object(string), { 'toString': lodashStable.constant(string) }],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return _.padStart(value, 6) === '   abc';
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should not pad if string is >= `length`

```ts
test('`_.' + methodName + '` should not pad if string is >= `length`', function(assert) {
      assert.expect(2);

      assert.strictEqual(func(string, 2), string);
      assert.strictEqual(func(string, 3), string);
    }
```

#### `_.' + methodName + '` should treat negative `length` as `0`

```ts
test('`_.' + methodName + '` should treat negative `length` as `0`', function(assert) {
      assert.expect(2);

      lodashStable.each([0, -2], function(length) {
        assert.strictEqual(func(string, length), string);
      });
    }
```

#### `_.' + methodName + '` should coerce `length` to a number

```ts
test('`_.' + methodName + '` should coerce `length` to a number', function(assert) {
      assert.expect(2);

      lodashStable.each(['', '4'], function(length) {
        var actual = length ? (isStart ? ' abc' : 'abc ') : string;
        assert.strictEqual(func(string, length), actual);
      });
    }
```

#### `_.' + methodName + '` should treat nullish values as empty strings

```ts
test('`_.' + methodName + '` should treat nullish values as empty strings', function(assert) {
      assert.expect(6);

      lodashStable.each([undefined, '_-'], function(chars) {
        var expected = chars ? (isPad ? '__' : chars) : '  ';
        assert.strictEqual(func(null, 2, chars), expected);
        assert.strictEqual(func(undefined, 2, chars), expected);
        assert.strictEqual(func('', 2, chars), expected);
      });
    }
```

#### `_.' + methodName + '` should return `string` when `chars` coerces to an empty string

```ts
test('`_.' + methodName + '` should return `string` when `chars` coerces to an empty string', function(assert) {
      assert.expect(1);

      var values = ['', Object('')],
          expected = lodashStable.map(values, lodashStable.constant(string));

      var actual = lodashStable.map(values, function(value) {
        return _.pad(string, 6, value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should use a radix of `16`, for hexadecimals, if `radix` is `undefined` or `0`

```ts
test('should use a radix of `16`, for hexadecimals, if `radix` is `undefined` or `0`', function(assert) {
      assert.expect(8);

      lodashStable.each(['0x20', '0X20'], function(string) {
        assert.strictEqual(_.parseInt(string), 32);
        assert.strictEqual(_.parseInt(string, 0), 32);
        assert.strictEqual(_.parseInt(string, 16), 32);
        assert.strictEqual(_.parseInt(string, undefined), 32);
      });
    }
```

#### should use a radix of `10` for string with leading zeros

```ts
test('should use a radix of `10` for string with leading zeros', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.parseInt('08'), 8);
      assert.strictEqual(_.parseInt('08', 10), 8);
    }
```

#### should parse strings with leading whitespace

```ts
test('should parse strings with leading whitespace', function(assert) {
      assert.expect(2);

      var expected = [8, 8, 10, 10, 32, 32, 32, 32];

      lodashStable.times(2, function(index) {
        var actual = [],
            func = (index ? (lodashBizarro || {}) : _).parseInt;

        if (func) {
          lodashStable.times(2, function(otherIndex) {
            var string = otherIndex ? '10' : '08';
            actual.push(
              func(whitespace + string, 10),
              func(whitespace + string)
            );
          });

          lodashStable.each(['0x20', '0X20'], function(string) {
            actual.push(
              func(whitespace + string),
              func(whitespace + string, 16)
            );
          });

          assert.deepEqual(actual, expected);
        }
        else {
          skipAssert(assert);
        }
      });
    }
```

#### should coerce `radix` to a number

```ts
test('should coerce `radix` to a number', function(assert) {
      assert.expect(2);

      var object = { 'valueOf': stubZero };
      assert.strictEqual(_.parseInt('08', object), 8);
      assert.strictEqual(_.parseInt('0x20', object), 32);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(2);

      var strings = lodashStable.map(['6', '08', '10'], Object),
          actual = lodashStable.map(strings, _.parseInt);

      assert.deepEqual(actual, [6, 8, 10]);

      actual = lodashStable.map('123', _.parseInt);
      assert.deepEqual(actual, [1, 2, 3]);
    }
```

#### should work with a number for `predicate`

```ts
test('should work with a number for `predicate`', function(assert) {
      assert.expect(2);

      var array = [
        [1, 0],
        [0, 1],
        [1, 0]
      ];

      assert.deepEqual(_.partition(array, 0), [[array[0], array[2]], [array[1]]]);
      assert.deepEqual(_.partition(array, 1), [[array[1]], [array[0], array[2]]]);
    }
```

#### should coerce `paths` to strings

```ts
test('should coerce `paths` to strings', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.pick({ '0': 'a', '1': 'b' }, 0), { '0': 'a' });
    }
```

#### `_.' + methodName + '` should create an object of picked string keyed properties

```ts
test('`_.' + methodName + '` should create an object of picked string keyed properties', function(assert) {
      assert.expect(2);

      assert.deepEqual(func(object, resolve(object, 'a')), { 'a': 1 });
      assert.deepEqual(func(object, resolve(object, ['a', 'c'])), expected);
    }
```

#### `_.' + methodName + '` should pick inherited string keyed properties

```ts
test('`_.' + methodName + '` should pick inherited string keyed properties', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.prototype = object;

      var foo = new Foo;
      assert.deepEqual(func(foo, resolve(foo, ['a', 'c'])), expected);
    }
```

#### should work with a non-string `path`

```ts
test('should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3];

      lodashStable.each([1, [1]], function(path) {
        var prop = _.property(path);
        assert.strictEqual(prop(array), 2);
      });
    }
```

#### should coerce `path` to a string

```ts
test('should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var expected = [1, 2, 3, 4],
          object = { 'null': 1, 'undefined': 2, 'fn': 3, '[object Object]': 4 },
          paths = [null, undefined, fn, {}];

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          var prop = _.property(index ? [path] : path);
          return prop(object);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should work with a non-string `path`

```ts
test('should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3],
          propOf = _.propertyOf(array);

      lodashStable.each([1, [1]], function(path) {
        assert.strictEqual(propOf(path), 2);
      });
    }
```

#### should coerce `path` to a string

```ts
test('should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var expected = [1, 2, 3, 4],
          object = { 'null': 1, 'undefined': 2, 'fn': 3, '[object Object]': 4 },
          paths = [null, undefined, fn, {}];

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          var propOf = _.propertyOf(object);
          return propOf(index ? [path] : path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should coerce arguments to finite numbers

```ts
test('should coerce arguments to finite numbers', function(assert) {
      assert.expect(1);

      var actual = [
        _.random(NaN, NaN),
        _.random('1', '1'),
        _.random(Infinity, Infinity)
      ];

      assert.deepEqual(actual, [0, 1, MAX_INTEGER]);
    }
```

#### `_.' + methodName + '` should coerce arguments to finite numbers

```ts
test('`_.' + methodName + '` should coerce arguments to finite numbers', function(assert) {
      assert.expect(1);

      var actual = [
        func('1'),
        func('0', 1),
        func(0, 1, '1'),
        func(NaN),
        func(NaN, NaN)
      ];

      assert.deepEqual(actual, [[0], [0], [0], [], []]);
    }
```

#### should repeat a string `n` times

```ts
test('should repeat a string `n` times', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.repeat('*', 3), '***');
      assert.strictEqual(_.repeat(string, 2), 'abcabc');
    }
```

#### should treat falsey `n` values, except `undefined`, as `0`

```ts
test('should treat falsey `n` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? string : '';
      });

      var actual = lodashStable.map(falsey, function(n, index) {
        return index ? _.repeat(string, n) : _.repeat(string);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return an empty string if `n` is <= `0`

```ts
test('should return an empty string if `n` is <= `0`', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.repeat(string, 0), '');
      assert.strictEqual(_.repeat(string, -2), '');
    }
```

#### should coerce `n` to an integer

```ts
test('should coerce `n` to an integer', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.repeat(string, '2'), 'abcabc');
      assert.strictEqual(_.repeat(string, 2.6), 'abcabc');
      assert.strictEqual(_.repeat('*', { 'valueOf': stubThree }), '***');
    }
```

#### should coerce `string` to a string

```ts
test('should coerce `string` to a string', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.repeat(Object(string), 2), 'abcabc');
      assert.strictEqual(_.repeat({ 'toString': lodashStable.constant('*') }, 3), '***');
    }
```

#### should replace the matched pattern

```ts
test('should replace the matched pattern', function(assert) {
      assert.expect(2);

      var string = 'abcde';
      assert.strictEqual(_.replace(string, 'de', '123'), 'abc123');
      assert.strictEqual(_.replace(string, /[bd]/g, '-'), 'a-c-e');
    }
```

#### `_.' + methodName + '` should get string keyed property values

```ts
test('`_.' + methodName + '` should get string keyed property values', function(assert) {
      assert.expect(2);

      var object = { 'a': 1 };

      lodashStable.each(['a', ['a']], function(path) {
        assert.strictEqual(func(object, path), 1);
      });
    }
```

#### `_.' + methodName + '` should not coerce array paths to strings

```ts
test('`_.' + methodName + '` should not coerce array paths to strings', function(assert) {
      assert.expect(1);

      var object = { 'a,b,c': 3, 'a': { 'b': { 'c': 4 } } };
      assert.strictEqual(func(object, ['a', 'b', 'c']), 4);
    }
```

#### `_.' + methodName + '` should follow `path` over non-plain objects

```ts
test('`_.' + methodName + '` should follow `path` over non-plain objects', function(assert) {
      assert.expect(2);

      var paths = ['a.b', ['a', 'b']];

      lodashStable.each(paths, function(path) {
        numberProto.a = { 'b': 2 };
        assert.strictEqual(func(0, path), 2);
        delete numberProto.a;
      });
    }
```

#### should be lazy when in a lazy sequence

```ts
test('should be lazy when in a lazy sequence', function(assert) {
      assert.expect(3);

      if (!isNpm) {
        var spy = {
          'toString': function() {
            throw new Error('spy was revealed');
          }
        };

        var array = largeArray.concat(spy),
            expected = array.slice();

        try {
          var wrapped = _(array).slice(1).map(String).reverse(),
              actual = wrapped.last();
        } catch (e) {}

        assert.ok(wrapped instanceof _);
        assert.strictEqual(actual, '1');
        assert.deepEqual(array, expected);
      }
      else {
        skipAssert(assert, 3);
      }
    }
```

#### `_.' + methodName + '` should return a rounded number without a precision

```ts
test('`_.' + methodName + '` should return a rounded number without a precision', function(assert) {
      assert.expect(1);

      var actual = func(4.006);
      assert.strictEqual(actual, isCeil ? 5 : 4);
    }
```

#### should use a zeroed `_.uniqueId` counter

```ts
test('should use a zeroed `_.uniqueId` counter', function(assert) {
      assert.expect(3);

      if (!isModularize) {
        lodashStable.times(2, _.uniqueId);

        var oldId = Number(_.uniqueId()),
            lodash = _.runInContext();

        assert.ok(_.uniqueId() > oldId);

        var id = lodash.uniqueId();
        assert.strictEqual(id, '1');
        assert.ok(id < oldId);
      }
      else {
        skipAssert(assert, 3);
      }
    }
```

#### `_.' + methodName + '` should preserve the sign of `0`

```ts
test('`_.' + methodName + '` should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var props = [-0, Object(-0), 0, Object(0)],
          expected = lodashStable.map(props, lodashStable.constant(value));

      var actual = lodashStable.map(props, function(key) {
        var object = { '-0': 'a', '0': 'b' };
        func(object, key, updater);
        return object[lodashStable.toString(key)];
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should not coerce array paths to strings

```ts
test('`_.' + methodName + '` should not coerce array paths to strings', function(assert) {
      assert.expect(1);

      var object = { 'a,b,c': 1, 'a': { 'b': { 'c': 1 } } };

      func(object, ['a', 'b', 'c'], updater);
      assert.strictEqual(object.a.b.c, value);
    }
```

#### `_.' + methodName + '` should not create an array for missing non-index property names that start with numbers

```ts
test('`_.' + methodName + '` should not create an array for missing non-index property names that start with numbers', function(assert) {
      assert.expect(1);

      var object = {};

      func(object, ['1a', '2b', '3c'], updater);
      assert.deepEqual(object, { '1a': { '2b': { '3c': value } } });
    }
```

#### should shuffle small collections

```ts
test('should shuffle small collections', function(assert) {
      assert.expect(1);

      var actual = lodashStable.times(1000, function(assert) {
        return _.shuffle([1, 2]);
      });

      assert.deepEqual(lodashStable.sortBy(lodashStable.uniqBy(actual, String), '0'), [[1, 2], [2, 1]]);
    }
```

#### should treat number values for `collection` as empty

```ts
test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.shuffle(1), []);
    }
```

#### should return the number of own enumerable string keyed properties of an object

```ts
test('should return the number of own enumerable string keyed properties of an object', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.size({ 'one': 1, 'two': 2, 'three': 3 }), 3);
    }
```

#### should work with jQuery/MooTools DOM query collections

```ts
test('should work with jQuery/MooTools DOM query collections', function(assert) {
      assert.expect(1);

      function Foo(elements) {
        push.apply(this, elements);
      }
      Foo.prototype = { 'length': 0, 'splice': arrayProto.splice };

      assert.strictEqual(_.size(new Foo(array)), 3);
    }
```

#### should not treat objects with non-number lengths as array-like

```ts
test('should not treat objects with non-number lengths as array-like', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.size({ 'length': '0' }), 1);
    }
```

#### should treat number values for `collection` as empty

```ts
test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.sortBy(1), []);
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

#### `_.' + methodName + '` should work with an array of strings

```ts
test('`_.' + methodName + '` should work with an array of strings', function(assert) {
      assert.expect(1);

      var array = ['a', 'c'],
          values = ['a', 'b', 'c'],
          expected = isSortedIndex ? [0, 1, 1] : [1, 1, 2];

      var actual = lodashStable.map(values, function(value) {
        return func(array, value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should split a string by `separator`

```ts
test('should split a string by `separator`', function(assert) {
      assert.expect(3);

      var string = 'abcde';
      assert.deepEqual(_.split(string, 'c'), ['ab', 'de']);
      assert.deepEqual(_.split(string, /[bd]/), ['a', 'c', 'e']);
      assert.deepEqual(_.split(string, '', 2), ['a', 'b']);
    }
```

#### should return an array containing an empty string for empty values

```ts
test('should return an array containing an empty string for empty values', function(assert) {
      assert.expect(1);

      var values = [, null, undefined, ''],
          expected = lodashStable.map(values, lodashStable.constant(['']));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.split(value) : _.split();
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var strings = ['abc', 'def', 'ghi'],
          actual = lodashStable.map(strings, _.split);

      assert.deepEqual(actual, [['abc'], ['def'], ['ghi']]);
    }
```

#### should allow mixed string and array prototype methods

```ts
test('should allow mixed string and array prototype methods', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _('abc');
        assert.strictEqual(wrapped.split('b').join(','), 'a,c');
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `true` if a string starts with `target`

```ts
test('should return `true` if a string starts with `target`', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.startsWith(string, 'a'), true);
    }
```

#### should return `false` if a string does not start with `target`

```ts
test('should return `false` if a string does not start with `target`', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.startsWith(string, 'b'), false);
    }
```

#### should work with a `position`

```ts
test('should work with a `position`', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.startsWith(string, 'b', 1), true);
    }
```

#### should work with `position` >= `length`

```ts
test('should work with `position` >= `length`', function(assert) {
      assert.expect(4);

      lodashStable.each([3, 5, MAX_SAFE_INTEGER, Infinity], function(position) {
        assert.strictEqual(_.startsWith(string, 'a', position), false);
      });
    }
```

#### should treat falsey `position` values as `0`

```ts
test('should treat falsey `position` values as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubTrue);

      var actual = lodashStable.map(falsey, function(position) {
        return _.startsWith(string, 'a', position);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should treat a negative `position` as `0`

```ts
test('should treat a negative `position` as `0`', function(assert) {
      assert.expect(6);

      lodashStable.each([-1, -3, -Infinity], function(position) {
        assert.strictEqual(_.startsWith(string, 'a', position), true);
        assert.strictEqual(_.startsWith(string, 'b', position), false);
      });
    }
```

#### should coerce `position` to an integer

```ts
test('should coerce `position` to an integer', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.startsWith(string, 'bc', 1.2), true);
    }
```

#### `_.' + methodName + '` should coerce `string` to a string

```ts
test('`_.' + methodName + '` should coerce `string` to a string', function(assert) {
      assert.expect(2);

      assert.strictEqual(func(Object(string), chr), true);
      assert.strictEqual(func({ 'toString': lodashStable.constant(string) }, chr), true);
    }
```

#### `_.' + methodName + '` should coerce `target` to a string

```ts
test('`_.' + methodName + '` should coerce `target` to a string', function(assert) {
      assert.expect(2);

      assert.strictEqual(func(string, Object(chr)), true);
      assert.strictEqual(func(string, { 'toString': lodashStable.constant(chr) }), true);
    }
```

#### `_.' + methodName + '` should coerce `position` to a number

```ts
test('`_.' + methodName + '` should coerce `position` to a number', function(assert) {
      assert.expect(2);

      var position = isStartsWith ? 1 : 2;

      assert.strictEqual(func(string, 'b', Object(position)), true);
      assert.strictEqual(func(string, 'b', { 'toString': lodashStable.constant(String(position)) }), true);
    }
```

#### should return `true` when `target` is an empty string regardless of `position`

```ts
test('should return `true` when `target` is an empty string regardless of `position`', function(assert) {
      assert.expect(1);

      var positions = [-Infinity, NaN, -3, -1, 0, 1, 2, 3, 5, MAX_SAFE_INTEGER, Infinity];

      assert.ok(lodashStable.every(positions, function(position) {
        return func(string, '', position);
      }));
    }
```

#### `_.' + methodName + '` should return ' + pair[1], function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(values, function(value, index) {
        if (index < 2) {
          return index ? func.call({}) : func();
        }
        return func(value);
      });

      assert.deepEqual(actual, expected);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.subtract');

  (function() {
    QUnit.test('should subtract two numbers

```ts
test('`_.' + methodName + '` should return ' + pair[1], function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(values, function(value, index) {
        if (index < 2) {
          return index ? func.call({}) : func();
        }
        return func(value);
      });

      assert.deepEqual(actual, expected);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.subtract');

  (function() {
    QUnit.test('should subtract two numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.subtract(6, 4), 2);
      assert.strictEqual(_.subtract(-6, 4), -10);
      assert.strictEqual(_.subtract(-6, -4), -2);
    }
```

#### should coerce arguments to numbers

```ts
test('should coerce arguments to numbers', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.subtract('6', '4'), 2);
      assert.deepEqual(_.subtract('x', 'y'), NaN);
    }
```

#### `_.' + methodName + '` should return the sum of an array of numbers

```ts
test('`_.' + methodName + '` should return the sum of an array of numbers', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(array), 12);
    }
```

#### `_.' + methodName + '` should not coerce values to numbers

```ts
test('`_.' + methodName + '` should not coerce values to numbers', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(['1', '2']), '12');
    }
```

#### should escape values in "escape" delimiters

```ts
test('should escape values in "escape" delimiters', function(assert) {
      assert.expect(1);

      var strings = ['<p><%- value %></p>', '<p><%-value%></p>', '<p><%-\nvalue\n%></p>'],
          expected = lodashStable.map(strings, lodashStable.constant('<p>&amp;&lt;&gt;&quot;&#39;/</p>')),
          data = { 'value': '&<>"\'/' };

      var actual = lodashStable.map(strings, function(string) {
        return _.template(string)(data);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should interpolate data properties in "interpolate" delimiters

```ts
test('should interpolate data properties in "interpolate" delimiters', function(assert) {
      assert.expect(1);

      var strings = ['<%= a %>BC', '<%=a%>BC', '<%=\na\n%>BC'],
          expected = lodashStable.map(strings, lodashStable.constant('ABC')),
          data = { 'a': 'A' };

      var actual = lodashStable.map(strings, function(string) {
        return _.template(string)(data);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should support complex "interpolate" delimiters

```ts
test('should support complex "interpolate" delimiters', function(assert) {
      assert.expect(22);

      lodashStable.forOwn({
        '<%= a + b %>': '3',
        '<%= b - a %>': '1',
        '<%= a = b %>': '2',
        '<%= !a %>': 'false',
        '<%= ~a %>': '-2',
        '<%= a * b %>': '2',
        '<%= a / b %>': '0.5',
        '<%= a % b %>': '1',
        '<%= a >> b %>': '0',
        '<%= a << b %>': '4',
        '<%= a & b %>': '0',
        '<%= a ^ b %>': '3',
        '<%= a | b %>': '3',
        '<%= {}.toString.call(0) %>': numberTag,
        '<%= a.toFixed(2) %>': '1.00',
        '<%= obj["a"] %>': '1',
        '<%= delete a %>': 'true',
        '<%= "a" in obj %>': 'true',
        '<%= obj instanceof Object %>': 'true',
        '<%= new Boolean %>': 'false',
        '<%= typeof a %>': 'number',
        '<%= void a %>': ''
      },
      function(value, key) {
        var compiled = _.template(key),
            data = { 'a': 1, 'b': 2 };

        assert.strictEqual(compiled(data), value, key);
      });
    }
```

#### should work with `this` references

```ts
test('should work with `this` references', function(assert) {
      assert.expect(2);

      var compiled = _.template('a<%= this.String("b") %>c');
      assert.strictEqual(compiled(), 'abc');

      var object = { 'b': 'B' };
      object.compiled = _.template('A<%= this.b %>C', { 'variable': 'obj' });
      assert.strictEqual(object.compiled(), 'ABC');
    }
```

#### should work with escaped characters in string literals

```ts
test('should work with escaped characters in string literals', function(assert) {
      assert.expect(2);

      var compiled = _.template('<% print("\'\\n\\r\\t\\u2028\\u2029\\\\") %>');
      assert.strictEqual(compiled(), "'\n\r\t\u2028\u2029\\");

      var data = { 'a': 'A' };
      compiled = _.template('\'\n\r\t<%= a %>\u2028\u2029\\"');
      assert.strictEqual(compiled(data), '\'\n\r\tA\u2028\u2029\\"');
    }
```

#### should resolve nullish values to an empty string

```ts
test('should resolve nullish values to an empty string', function(assert) {
      assert.expect(3);

      var compiled = _.template('<%= a %><%- a %>'),
          data = { 'a': null };

      assert.strictEqual(compiled(data), '');

      data = { 'a': undefined };
      assert.strictEqual(compiled(data), '');

      data = { 'a': {} };
      compiled = _.template('<%= a.b %><%- a.b %>');
      assert.strictEqual(compiled(data), '');
    }
```

#### should return an empty string for empty values

```ts
test('should return an empty string for empty values', function(assert) {
      assert.expect(1);

      var values = [, null, undefined, ''],
          expected = lodashStable.map(values, stubString),
          data = { 'a': 1 };

      var actual = lodashStable.map(values, function(value, index) {
        var compiled = index ? _.template(value) : _.template();
        return compiled(data);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should coerce `text` to a string

```ts
test('should coerce `text` to a string', function(assert) {
      assert.expect(1);

      var object = { 'toString': lodashStable.constant('<%= a %>') },
          data = { 'a': 1 };

      assert.strictEqual(_.template(object)(data), '1');
    }
```

#### should expose the source on compiled templates

```ts
test('should expose the source on compiled templates', function(assert) {
      assert.expect(1);

      var compiled = _.template('x'),
          values = [String(compiled), compiled.source],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.includes(value, '__p');
      });

      assert.deepEqual(actual, expected);
    }
```

#### should use a default `length` of `30`

```ts
test('should use a default `length` of `30`', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.truncate(string), 'hi-diddly-ho there, neighbo...');
    }
```

#### should not truncate if `string` is <= `length`

```ts
test('should not truncate if `string` is <= `length`', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.truncate(string, { 'length': string.length }), string);
      assert.strictEqual(_.truncate(string, { 'length': string.length + 2 }), string);
    }
```

#### should truncate string the given length

```ts
test('should truncate string the given length', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.truncate(string, { 'length': 24 }), 'hi-diddly-ho there, n...');
    }
```

#### should support a `omission` option

```ts
test('should support a `omission` option', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.truncate(string, { 'omission': ' [...]' }), 'hi-diddly-ho there, neig [...]');
    }
```

#### should coerce nullish `omission` values to strings

```ts
test('should coerce nullish `omission` values to strings', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.truncate(string, { 'omission': null }), 'hi-diddly-ho there, neighbnull');
      assert.strictEqual(_.truncate(string, { 'omission': undefined }), 'hi-diddly-ho there, nundefined');
    }
```

#### should support a `length` option

```ts
test('should support a `length` option', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.truncate(string, { 'length': 4 }), 'h...');
    }
```

#### should support a `separator` option

```ts
test('should support a `separator` option', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.truncate(string, { 'length': 24, 'separator': ' ' }), 'hi-diddly-ho there,...');
      assert.strictEqual(_.truncate(string, { 'length': 24, 'separator': /,? +/ }), 'hi-diddly-ho there...');
      assert.strictEqual(_.truncate(string, { 'length': 24, 'separator': /,? +/g }), 'hi-diddly-ho there...');
    }
```

#### should treat negative `length` as `0`

```ts
test('should treat negative `length` as `0`', function(assert) {
      assert.expect(2);

      lodashStable.each([0, -2], function(length) {
        assert.strictEqual(_.truncate(string, { 'length': length }), '...');
      });
    }
```

#### should coerce `length` to an integer

```ts
test('should coerce `length` to an integer', function(assert) {
      assert.expect(4);

      lodashStable.each(['', NaN, 4.6, '4'], function(length, index) {
        var actual = index > 1 ? 'h...' : '...';
        assert.strictEqual(_.truncate(string, { 'length': { 'valueOf': lodashStable.constant(length) } }), actual);
      });
    }
```

#### should coerce `string` to a string

```ts
test('should coerce `string` to a string', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.truncate(Object(string), { 'length': 4 }), 'h...');
      assert.strictEqual(_.truncate({ 'toString': lodashStable.constant(string) }, { 'length': 5 }), 'hi...');
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map([string, string, string], _.truncate),
          truncated = 'hi-diddly-ho there, neighbo...';

      assert.deepEqual(actual, [truncated, truncated, truncated]);
    }
```

#### should convert strings to arrays

```ts
test('should convert strings to arrays', function(assert) {
      assert.expect(3);

      assert.deepEqual(_.toArray(''), []);
      assert.deepEqual(_.toArray('ab'), ['a', 'b']);
      assert.deepEqual(_.toArray(Object('ab')), ['a', 'b']);
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE + 1);

        var object = lodashStable.zipObject(lodashStable.times(LARGE_ARRAY_SIZE, function(index) {
          return ['key' + index, index];
        }));

        var actual = _(array).slice(1).map(String).toArray().value();
        assert.deepEqual(actual, lodashStable.map(array.slice(1), String));

        actual = _(object).toArray().slice(1).map(String).value();
        assert.deepEqual(actual, _.map(_.toArray(object).slice(1), String));
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should convert whole string to lower case

```ts
test('should convert whole string to lower case', function(assert) {
      assert.expect(3);

      assert.deepEqual(_.toLower('--Foo-Bar--'), '--foo-bar--');
      assert.deepEqual(_.toLower('fooBar'), 'foobar');
      assert.deepEqual(_.toLower('__FOO_BAR__'), '__foo_bar__');
    }
```

#### should convert whole string to upper case

```ts
test('should convert whole string to upper case', function(assert) {
      assert.expect(3);

      assert.deepEqual(_.toUpper('--Foo-Bar'), '--FOO-BAR');
      assert.deepEqual(_.toUpper('fooBar'), 'FOOBAR');
      assert.deepEqual(_.toUpper('__FOO_BAR__'), '__FOO_BAR__');
    }
```

#### `_.' + methodName + '` should pass thru primitive number values

```ts
test('`_.' + methodName + '` should pass thru primitive number values', function(assert) {
      assert.expect(1);

      var values = [0, 1, NaN];

      var expected = lodashStable.map(values, function(value) {
        return (!isToNumber && value !== value) ? 0 : value;
      });

      var actual = lodashStable.map(values, func);

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should convert number primitives and objects to numbers

```ts
test('`_.' + methodName + '` should convert number primitives and objects to numbers', function(assert) {
      assert.expect(1);

      var values = [2, 1.2, MAX_SAFE_INTEGER, MAX_INTEGER, Infinity, NaN];

      var expected = lodashStable.map(values, function(value) {
        if (!isToNumber) {
          if (!isToFinite && value == 1.2) {
            value = 1;
          }
          else if (value == Infinity) {
            value = MAX_INTEGER;
          }
          else if (value !== value) {
            value = 0;
          }
          if (isToLength || isToSafeInteger) {
            value = Math.min(value, isToLength ? MAX_ARRAY_LENGTH : MAX_SAFE_INTEGER);
          }
        }
        var neg = isToLength ? 0 : -value;
        return [value, value, neg, neg];
      });

      var actual = lodashStable.map(values, function(value) {
        return [func(value), func(Object(value)), func(-value), func(Object(-value))];
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should convert string primitives and objects to numbers

```ts
test('`_.' + methodName + '` should convert string primitives and objects to numbers', function(assert) {
      assert.expect(1);

      var transforms = [identity, pad, positive, negative];

      var values = [
        '10', '1.234567890', (MAX_SAFE_INTEGER + ''),
        '1e+308', '1e308', '1E+308', '1E308',
        '5e-324', '5E-324',
        'Infinity', 'NaN'
      ];

      var expected = lodashStable.map(values, function(value) {
        var n = +value;
        if (!isToNumber) {
          if (!isToFinite && n == 1.234567890) {
            n = 1;
          }
          else if (n == Infinity) {
            n = MAX_INTEGER;
          }
          else if ((!isToFinite && n == Number.MIN_VALUE) || n !== n) {
            n = 0;
          }
          if (isToLength || isToSafeInteger) {
            n = Math.min(n, isToLength ? MAX_ARRAY_LENGTH : MAX_SAFE_INTEGER);
          }
        }
        var neg = isToLength ? 0 : -n;
        return [n, n, n, n, n, n, neg, neg];
      });

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.flatMap(transforms, function(mod) {
          return [func(mod(value)), func(Object(mod(value)))];
        });
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should convert binary/octal strings to numbers

```ts
test('`_.' + methodName + '` should convert binary/octal strings to numbers', function(assert) {
      assert.expect(1);

      var numbers = [42, 5349, 1715004],
          transforms = [identity, pad],
          values = ['0b101010', '0o12345', '0x1a2b3c'];

      var expected = lodashStable.map(numbers, function(n) {
        return lodashStable.times(8, lodashStable.constant(n));
      });

      var actual = lodashStable.map(values, function(value) {
        var upper = value.toUpperCase();
        return lodashStable.flatMap(transforms, function(mod) {
          return [func(mod(value)), func(Object(mod(value))), func(mod(upper)), func(Object(mod(upper)))];
        });
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should convert invalid binary/octal strings to `' + (isToNumber ? 'NaN' : '0') + '`

```ts
test('`_.' + methodName + '` should convert invalid binary/octal strings to `' + (isToNumber ? 'NaN' : '0') + '`', function(assert) {
      assert.expect(1);

      var transforms = [identity, pad, positive, negative],
          values = ['0b', '0o', '0x', '0b1010102', '0o123458', '0x1a2b3x'];

      var expected = lodashStable.map(values, function(n) {
        return lodashStable.times(8, lodashStable.constant(isToNumber ? NaN : 0));
      });

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.flatMap(transforms, function(mod) {
          return [func(mod(value)), func(Object(mod(value)))];
        });
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should convert symbols to `' + (isToNumber ? 'NaN' : '0') + '`

```ts
test('`_.' + methodName + '` should convert symbols to `' + (isToNumber ? 'NaN' : '0') + '`', function(assert) {
      assert.expect(1);

      if (Symbol) {
        var object1 = Object(symbol),
            object2 = Object(symbol),
            values = [symbol, object1, object2],
            expected = lodashStable.map(values, lodashStable.constant(isToNumber ? NaN : 0));

        object2.valueOf = undefined;
        var actual = lodashStable.map(values, func);

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should convert empty values to `0` or `NaN`

```ts
test('`_.' + methodName + '` should convert empty values to `0` or `NaN`', function(assert) {
      assert.expect(1);

      var values = falsey.concat(whitespace);

      var expected = lodashStable.map(values, function(value) {
        return (isToNumber && value !== whitespace) ? Number(value) : 0;
      });

      var actual = lodashStable.map(values, function(value, index) {
        return index ? func(value) : func();
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should coerce objects to numbers

```ts
test('`_.' + methodName + '` should coerce objects to numbers', function(assert) {
      assert.expect(1);

      var values = [
        {},
        [],
        [1],
        [1, 2],
        { 'valueOf': '1.1' },
        { 'valueOf': '1.1', 'toString': lodashStable.constant('2.2') },
        { 'valueOf': lodashStable.constant('1.1'), 'toString': '2.2' },
        { 'valueOf': lodashStable.constant('1.1'), 'toString': lodashStable.constant('2.2') },
        { 'valueOf': lodashStable.constant('-0x1a2b3c') },
        { 'toString': lodashStable.constant('-0x1a2b3c') },
        { 'valueOf': lodashStable.constant('0o12345') },
        { 'toString': lodashStable.constant('0o12345') },
        { 'valueOf': lodashStable.constant('0b101010') },
        { 'toString': lodashStable.constant('0b101010') }
      ];

      var expected = [
        NaN,  0,   1,   NaN,
        NaN,  2.2, 1.1, 1.1,
        NaN,  NaN,
        5349, 5349,
        42,   42
      ];

      if (isToFinite) {
        expected = [
          0,    0,    1,   0,
          0,    2.2,  1.1, 1.1,
          0,    0,
          5349, 5349,
          42,   42
        ];
      }
      else if (!isToNumber) {
        expected = [
          0,    0,    1, 0,
          0,    2,    1, 1,
          0,    0,
          5349, 5349,
          42,   42
        ];
      }
      var actual = lodashStable.map(values, func);

      assert.deepEqual(actual, expected);
    }
```

#### `_.`' + methodName + '` should prevent ReDoS

```ts
test('`_.`' + methodName + '` should prevent ReDoS', function(assert) {
      assert.expect(2);

      var largeStrLen = 50000,
          largeStr = '1' + lodashStable.repeat(' ', largeStrLen) + '1',
          maxMs = 1000,
          startTime = lodashStable.now();

      assert.deepEqual(_[methodName](largeStr), methodName == 'toNumber' ? NaN : 0);

      var endTime = lodashStable.now(),
          timeSpent = endTime - startTime;

      assert.ok(timeSpent < maxMs, 'operation took ' + timeSpent + 'ms');
    }
```

#### `_.' + methodName + '` should create an array of string keyed-value pairs

```ts
test('`_.' + methodName + '` should create an array of string keyed-value pairs', function(assert) {
      assert.expect(1);

      var object = { 'a': 1, 'b': 2 },
          actual = lodashStable.sortBy(func(object), 0);

      assert.deepEqual(actual, [['a', 1], ['b', 2]]);
    }
```

#### `_.' + methodName + '` should ' + (isToPairs ? 'not ' : '') + 'include inherited string keyed property values

```ts
test('`_.' + methodName + '` should ' + (isToPairs ? 'not ' : '') + 'include inherited string keyed property values', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var expected = isToPairs ? [['a', 1]] : [['a', 1], ['b', 2]],
          actual = lodashStable.sortBy(func(new Foo), 0);

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should convert strings

```ts
test('`_.' + methodName + '` should convert strings', function(assert) {
      assert.expect(2);

      lodashStable.each(['xo', Object('xo')], function(string) {
        var actual = lodashStable.sortBy(func(string), 0);
        assert.deepEqual(actual, [['0', 'x'], ['1', 'o']]);
      });
    }
```

#### should convert a string to a path

```ts
test('should convert a string to a path', function(assert) {
      assert.expect(2);

      assert.deepEqual(_.toPath('a.b.c'), ['a', 'b', 'c']);
      assert.deepEqual(_.toPath('a[0].b.c'), ['a', '0', 'b', 'c']);
    }
```

#### should coerce array elements to strings

```ts
test('should coerce array elements to strings', function(assert) {
      assert.expect(4);

      var array = ['a', 'b', 'c'];

      lodashStable.each([array, lodashStable.map(array, Object)], function(value) {
        var actual = _.toPath(value);
        assert.deepEqual(actual, array);
        assert.notStrictEqual(actual, array);
      });
    }
```

#### should not coerce symbols to strings

```ts
test('should not coerce symbols to strings', function(assert) {
      assert.expect(4);

      if (Symbol) {
        var object = Object(symbol);
        lodashStable.each([symbol, object, [symbol], [object]], function(value) {
          var actual = _.toPath(value);
          assert.ok(lodashStable.isSymbol(actual[0]));
        });
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should flatten inherited string keyed properties

```ts
test('should flatten inherited string keyed properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.b = 2;
      }
      Foo.prototype.c = 3;

      var actual = lodashStable.assign({ 'a': 1 }, _.toPlainObject(new Foo));
      assert.deepEqual(actual, { 'a': 1, 'b': 2, 'c': 3 });
    }
```

#### should treat nullish values as empty strings

```ts
test('should treat nullish values as empty strings', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubString);

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.toString(value) : _.toString();
      });

      assert.deepEqual(actual, expected);
    }
```

#### should preserve the sign of `0`

```ts
test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var values = [-0, Object(-0), 0, Object(0)],
          expected = ['-0', '-0', '0', '0'],
          actual = lodashStable.map(values, _.toString);

      assert.deepEqual(actual, expected);
    }
```

#### should preserve the sign of `0` in an array

```ts
test('should preserve the sign of `0` in an array', function(assert) {
      assert.expect(1);

      var values = [-0, Object(-0), 0, Object(0)];
      assert.deepEqual(_.toString(values), '-0,-0,0,0');
    }
```

#### should not error on symbols

```ts
test('should not error on symbols', function(assert) {
      assert.expect(1);

      if (Symbol) {
        try {
          assert.strictEqual(_.toString(symbol), 'Symbol(a)');
        } catch (e) {
          assert.ok(false, e.message);
        }
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should not error on an array of symbols

```ts
test('should not error on an array of symbols', function(assert) {
      assert.expect(1);

      if (Symbol) {
        try {
          assert.strictEqual(_.toString([symbol]), 'Symbol(a)');
        } catch (e) {
          assert.ok(false, e.message);
        }
      }
      else {
        skipAssert(assert);
      }
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

#### `_.' + methodName + '` should remove ' + parts + ' whitespace

```ts
test('`_.' + methodName + '` should remove ' + parts + ' whitespace', function(assert) {
      assert.expect(1);

      var string = whitespace + 'a b c' + whitespace,
          expected = (index == 2 ? whitespace : '') + 'a b c' + (index == 1 ? whitespace : '');

      assert.strictEqual(func(string), expected);
    }
```

#### `_.' + methodName + '` should coerce `string` to a string

```ts
test('`_.' + methodName + '` should coerce `string` to a string', function(assert) {
      assert.expect(1);

      var object = { 'toString': lodashStable.constant(whitespace + 'a b c' + whitespace) },
          expected = (index == 2 ? whitespace : '') + 'a b c' + (index == 1 ? whitespace : '');

      assert.strictEqual(func(object), expected);
    }
```

#### `_.' + methodName + '` should remove ' + parts + ' `chars`

```ts
test('`_.' + methodName + '` should remove ' + parts + ' `chars`', function(assert) {
      assert.expect(1);

      var string = '-_-a-b-c-_-',
          expected = (index == 2 ? '-_-' : '') + 'a-b-c' + (index == 1 ? '-_-' : '');

      assert.strictEqual(func(string, '_-'), expected);
    }
```

#### `_.' + methodName + '` should coerce `chars` to a string

```ts
test('`_.' + methodName + '` should coerce `chars` to a string', function(assert) {
      assert.expect(1);

      var object = { 'toString': lodashStable.constant('_-') },
          string = '-_-a-b-c-_-',
          expected = (index == 2 ? '-_-' : '') + 'a-b-c' + (index == 1 ? '-_-' : '');

      assert.strictEqual(func(string, object), expected);
    }
```

#### `_.' + methodName + '` should return an empty string for empty values and `chars`

```ts
test('`_.' + methodName + '` should return an empty string for empty values and `chars`', function(assert) {
      assert.expect(6);

      lodashStable.each([null, '_-'], function(chars) {
        assert.strictEqual(func(null, chars), '');
        assert.strictEqual(func(undefined, chars), '');
        assert.strictEqual(func('', chars), '');
      });
    }
```

#### `_.' + methodName + '` should work with `undefined` or empty string values for `chars`

```ts
test('`_.' + methodName + '` should work with `undefined` or empty string values for `chars`', function(assert) {
      assert.expect(2);

      var string = whitespace + 'a b c' + whitespace,
          expected = (index == 2 ? whitespace : '') + 'a b c' + (index == 1 ? whitespace : '');

      assert.strictEqual(func(string, undefined), expected);
      assert.strictEqual(func(string, ''), string);
    }
```

#### `_.' + methodName + '` should work as an iteratee for methods like `_.map`

```ts
test('`_.' + methodName + '` should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var string = Object(whitespace + 'a b c' + whitespace),
          trimmed = (index == 2 ? whitespace : '') + 'a b c' + (index == 1 ? whitespace : ''),
          actual = lodashStable.map([string, string, string], func);

      assert.deepEqual(actual, [trimmed, trimmed, trimmed]);
    }
```

#### `_.' + methodName + '` should return an unwrapped value when implicitly chaining

```ts
test('`_.' + methodName + '` should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var string = whitespace + 'a b c' + whitespace,
            expected = (index == 2 ? whitespace : '') + 'a b c' + (index == 1 ? whitespace : '');

        assert.strictEqual(_(string)[methodName](), expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should return a wrapped value when explicitly chaining

```ts
test('`_.' + methodName + '` should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var string = whitespace + 'a b c' + whitespace;
        assert.ok(_(string).chain()[methodName]() instanceof _);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should account for astral symbols

```ts
test('should account for astral symbols', function(assert) {
      assert.expect(34);

      var allHearts = _.repeat(hearts, 10),
          chars = hearts + comboGlyph,
          string = 'A ' + leafs + ', ' + comboGlyph + ', and ' + rocket,
          trimChars = comboGlyph + hearts,
          trimString = trimChars + string + trimChars;

      assert.strictEqual(_.camelCase(hearts + ' the ' + leafs), hearts + 'The' + leafs);
      assert.strictEqual(_.camelCase(string), 'a' + leafs + comboGlyph + 'And' + rocket);
      assert.strictEqual(_.capitalize(rocket), rocket);

      assert.strictEqual(_.pad(string, 16), ' ' + string + '  ');
      assert.strictEqual(_.padStart(string, 16), '   ' + string);
      assert.strictEqual(_.padEnd(string, 16), string + '   ');

      assert.strictEqual(_.pad(string, 16, chars), hearts + string + chars);
      assert.strictEqual(_.padStart(string, 16, chars), chars + hearts + string);
      assert.strictEqual(_.padEnd(string, 16, chars), string + chars + hearts);

      assert.strictEqual(_.size(string), 13);
      assert.deepEqual(_.split(string, ' '), ['A', leafs + ',', comboGlyph + ',', 'and', rocket]);
      assert.deepEqual(_.split(string, ' ', 3), ['A', leafs + ',', comboGlyph + ',']);
      assert.deepEqual(_.split(string, undefined), [string]);
      assert.deepEqual(_.split(string, undefined, -1), [string]);
      assert.deepEqual(_.split(string, undefined, 0), []);

      var expected = ['A', ' ', leafs, ',', ' ', comboGlyph, ',', ' ', 'a', 'n', 'd', ' ', rocket];

      assert.deepEqual(_.split(string, ''), expected);
      assert.deepEqual(_.split(string, '', 6), expected.slice(0, 6));
      assert.deepEqual(_.toArray(string), expected);

      assert.strictEqual(_.trim(trimString, chars), string);
      assert.strictEqual(_.trimStart(trimString, chars), string + trimChars);
      assert.strictEqual(_.trimEnd(trimString, chars), trimChars + string);

      assert.strictEqual(_.truncate(string, { 'length': 13 }), string);
      assert.strictEqual(_.truncate(string, { 'length': 6 }), 'A ' + leafs + '...');

      assert.deepEqual(_.words(string), ['A', leafs, comboGlyph, 'and', rocket]);
      assert.deepEqual(_.toArray(hashKeycap), [hashKeycap]);
      assert.deepEqual(_.toArray(noMic), [noMic]);

      lodashStable.times(2, function(index) {
        var separator = index ? RegExp(hearts) : hearts,
            options = { 'length': 4, 'separator': separator },
            actual = _.truncate(string, options);

        assert.strictEqual(actual, 'A...');
        assert.strictEqual(actual.length, 4);

        actual = _.truncate(allHearts, options);
        assert.strictEqual(actual, hearts + '...');
        assert.strictEqual(actual.length, 5);
      });
    }
```

#### should match side by side fitzpatrick modifiers separately

```ts
test('should match side by side fitzpatrick modifiers separately ', function(assert) {
      assert.expect(1);

      var string = fitzModifiers[0] + fitzModifiers[0];
      assert.deepEqual(_.toArray(string), [fitzModifiers[0], fitzModifiers[0]]);
    }
```

#### should cap the number of arguments provided to `func`

```ts
test('should cap the number of arguments provided to `func`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(['6', '8', '10'], _.unary(parseInt));
      assert.deepEqual(actual, [6, 8, 10]);
    }
```

#### should handle strings with nothing to unescape

```ts
test('should handle strings with nothing to unescape', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.unescape('abc'), 'abc');
    }
```

#### `_.' + methodName + '` should treat `-0` as `0`

```ts
test('`_.' + methodName + '` should treat `-0` as `0`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(func([-0, 0]), lodashStable.toString);
      assert.deepEqual(actual, ['0']);
    }
```

#### `_.' + methodName + '` should work with large arrays of `-0` as `0`

```ts
test('`_.' + methodName + '` should work with large arrays of `-0` as `0`', function(assert) {
      assert.expect(1);

      var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, function(index) {
        return isEven(index) ? -0 : 0;
      });

      var actual = lodashStable.map(func(largeArray), lodashStable.toString);
      assert.deepEqual(actual, ['0']);
    }
```

#### `_.' + methodName + '` should work with large arrays of well-known symbols

```ts
test('`_.' + methodName + '` should work with large arrays of well-known symbols', function(assert) {
      assert.expect(1);

      // See http://www.ecma-international.org/ecma-262/6.0/#sec-well-known-symbols.
      if (Symbol) {
        var expected = [
          Symbol.hasInstance, Symbol.isConcatSpreadable, Symbol.iterator,
          Symbol.match, Symbol.replace, Symbol.search, Symbol.species,
          Symbol.split, Symbol.toPrimitive, Symbol.toStringTag, Symbol.unscopables
        ];

        var largeArray = [],
            count = Math.ceil(LARGE_ARRAY_SIZE / expected.length);

        expected = lodashStable.map(expected, function(symbol) {
          return symbol || {};
        });

        lodashStable.each(expected, function(value) {
          lodashStable.times(count, function() {
            largeArray.push(value);
          });
        });

        assert.deepEqual(func(largeArray), expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should distinguish between numbers and numeric strings

```ts
test('`_.' + methodName + '` should distinguish between numbers and numeric strings', function(assert) {
      assert.expect(1);

      var largeArray = [],
          expected = ['2', 2, Object('2'), Object(2)],
          count = Math.ceil(LARGE_ARRAY_SIZE / expected.length);

      lodashStable.each(expected, function(value) {
        lodashStable.times(count, function() {
          largeArray.push(value);
        });
      });

      assert.deepEqual(func(largeArray), expected);
    }
```

#### should work with large arrays

```ts
test('should work with large arrays', function(assert) {
      assert.expect(2);

      var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, function() {
        return [1, 2];
      });

      var actual = func(largeArray, String);
      assert.strictEqual(actual[0], largeArray[0]);
      assert.deepEqual(actual, [[1, 2]]);
    }
```

#### should preserve the sign of `0`

```ts
test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, function(index) {
        return isEven(index) ? -0 : 0;
      });

      var arrays = [[-0, 0], largeArray],
          expected = lodashStable.map(arrays, lodashStable.constant(['-0']));

      var actual = lodashStable.map(arrays, function(array) {
        return lodashStable.map(_.uniqWith(array, lodashStable.eq), lodashStable.toString);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return a string value when not providing a `prefix`

```ts
test('should return a string value when not providing a `prefix`', function(assert) {
      assert.expect(1);

      assert.strictEqual(typeof _.uniqueId(), 'string');
    }
```

#### should coerce the prefix argument to a string

```ts
test('should coerce the prefix argument to a string', function(assert) {
      assert.expect(1);

      var actual = [_.uniqueId(3), _.uniqueId(2), _.uniqueId(1)];
      assert.ok(/3\d+,2\d+,1\d+/.test(actual));
    }
```

#### should preserve the sign of `0`

```ts
test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var props = [-0, Object(-0), 0, Object(0)],
          expected = lodashStable.map(props, lodashStable.constant([true, false]));

      var actual = lodashStable.map(props, function(key) {
        var object = { '-0': 'a', '0': 'b' };
        return [_.unset(object, key), lodashStable.toString(key) in object];
      });

      assert.deepEqual(actual, expected);
    }
```

#### should block constructor.prototype paths from primitives but follow regular non-plain paths

```ts
test('should block constructor.prototype paths from primitives but follow regular non-plain paths', function(assert) {
      assert.expect(8);

      var object = { 'a': '' },
          paths = ['constructor.prototype.a', ['constructor', 'prototype', 'a']];

      lodashStable.each(paths, function(path) {
        numberProto.a = 1;

        var actual = _.unset(0, path);
        assert.strictEqual(actual, false);
        assert.ok('a' in numberProto);

        delete numberProto.a;
      });

      lodashStable.each(['a.replace.b', ['a', 'replace', 'b']], function(path) {
        stringProto.replace.b = 1;

        var actual = _.unset(object, path);
        assert.strictEqual(actual, true);
        assert.notOk('a' in stringProto.replace);

        delete stringProto.replace.b;
      });
    }
```

#### Security: _.unset should not allow modifying prototype or constructor properties

```ts
test('Security: _.unset should not allow modifying prototype or constructor properties', function(assert) {
      assert.expect(6);

      var testStr1 = 'ABC';
      assert.strictEqual(typeof testStr1.toLowerCase, 'function', 'String.toLowerCase should exist before unset');

      _.unset({ foo: 'bar' }, 'foo.__proto__.toLowerCase');
      _.unset({ foo: 'bar' }, 'foo.constructor.prototype.toLowerCase');
      _.unset({ foo: 'bar' }, [['foo'], ['__proto__'], ['toLowerCase']]);
      _.unset({ foo: 'bar' }, [['foo'], ['constructor'], ['prototype'], ['toLowerCase']]);
      _.unset({ foo: 'bar' }, ['foo', ['__proto__'], 'toLowerCase']);

      var testStr2 = 'ABC';
      assert.strictEqual(typeof testStr2.toLowerCase, 'function', 'String.toLowerCase should still exist after unset');
      assert.strictEqual(testStr2.toLowerCase(), 'abc', 'String.toLowerCase should work as expected');

      objectProto.foo = 'bar';
      _.unset({}, [['__proto__'], ['foo']]);
      assert.strictEqual(objectProto.foo, 'bar', '__proto__ access via array-wrapped segments should be blocked');
      delete objectProto.foo;

      assert.strictEqual(typeof funcProto.apply, 'function', 'Function.prototype.apply should exist before unset');

      _.unset(0, 'constructor.prototype.toString.constructor.prototype.apply');
      _.unset(0, ['constructor', 'prototype', 'toString', 'constructor', 'prototype', 'apply']);

      assert.strictEqual(typeof funcProto.apply, 'function', 'Function.prototype.apply should not be deletable via deep constructor.prototype chain');
    }
```

#### Security: _.unset should not allow deleting static methods from constructors

```ts
test('Security: _.unset should not allow deleting static methods from constructors', function(assert) {
      assert.expect(8);

      assert.strictEqual(typeof Object.keys, 'function', 'Object.keys should exist before unset');

      _.unset({}, ['constructor', 'keys']);
      _.unset({}, 'constructor.keys');
      _.unset({}, [['constructor'], ['keys']]);

      assert.strictEqual(typeof Object.keys, 'function', 'Object.keys should not be deletable via constructor traversal');

      assert.strictEqual(typeof Array.isArray, 'function', 'Array.isArray should exist before unset');

      _.unset([], [ 'constructor', 'isArray']);

      assert.strictEqual(typeof Array.isArray, 'function', 'Array.isArray should not be deletable via constructor traversal');

      assert.strictEqual(typeof String.fromCharCode, 'function', 'String.fromCharCode should exist before unset');

      _.unset('', [ 'constructor', 'fromCharCode']);
      _.unset({ foo: 'bar' }, ['foo', 'constructor', 'fromCharCode']);

      assert.strictEqual(typeof String.fromCharCode, 'function', 'String.fromCharCode should not be deletable via constructor traversal');

      assert.strictEqual(typeof Number.isFinite, 'function', 'Number.isFinite should exist before unset');

      _.unset(0, ['constructor', 'isFinite']);
      _.unset(0, 'constructor.isFinite');

      assert.strictEqual(typeof Number.isFinite, 'function', 'Number.isFinite should not be deletable via primitive constructor traversal');
    }
```

#### Security: _.unset should protect built-in prototype methods on primitive types

```ts
test('Security: _.unset should protect built-in prototype methods on primitive types', function(assert) {
      assert.expect(11);

      // Number.prototype built-ins
      assert.strictEqual(typeof numberProto.toFixed, 'function', 'Number.prototype.toFixed should exist before unset');

      assert.strictEqual(_.unset(0, 'constructor.prototype.toFixed'), false, 'should return false for built-in Number.prototype.toFixed');
      assert.strictEqual(_.unset(0, ['constructor', 'prototype', 'toFixed']), false, 'should return false for built-in Number.prototype.toFixed (array path)');
      assert.strictEqual(_.unset(0, ['constructor', ['prototype'], 'toFixed']), false, 'should return false for built-in Number.prototype.toFixed (array path)');

      assert.strictEqual(typeof numberProto.toFixed, 'function', 'Number.prototype.toFixed should still exist after unset attempts');

      // String.prototype built-ins
      assert.strictEqual(typeof stringProto.toLowerCase, 'function', 'String.prototype.toLowerCase should exist before unset');

      assert.strictEqual(_.unset('', 'constructor.prototype.toLowerCase'), false, 'should return false for built-in String.prototype.toLowerCase');

      assert.strictEqual(typeof stringProto.toLowerCase, 'function', 'String.prototype.toLowerCase should still exist after unset attempts');

      // Boolean.prototype built-ins
      assert.strictEqual(typeof booleanProto.valueOf, 'function', 'Boolean.prototype.valueOf should exist before unset');

      assert.strictEqual(_.unset(true, 'constructor.prototype.valueOf'), false, 'should return false for built-in Boolean.prototype.valueOf');

      assert.strictEqual(typeof booleanProto.valueOf, 'function', 'Boolean.prototype.valueOf should still exist after unset attempts');
    }
```

#### `_.' + methodName + '` should get string keyed values of `object`

```ts
test('`_.' + methodName + '` should get string keyed values of `object`', function(assert) {
      assert.expect(1);

      var object = { 'a': 1, 'b': 2 },
          actual = func(object).sort();

      assert.deepEqual(actual, [1, 2]);
    }
```

#### `_.' + methodName + '` should ' + (isValues ? 'not ' : '') + 'include inherited string keyed property values

```ts
test('`_.' + methodName + '` should ' + (isValues ? 'not ' : '') + 'include inherited string keyed property values', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var expected = isValues ? [1] : [1, 2],
          actual = func(new Foo).sort();

      assert.deepEqual(actual, expected);
    }
```

#### should work with compound words

```ts
test('should work with compound words', function(assert) {
      assert.expect(12);

      assert.deepEqual(_.words('12ft'), ['12', 'ft']);
      assert.deepEqual(_.words('aeiouAreVowels'), ['aeiou', 'Are', 'Vowels']);
      assert.deepEqual(_.words('enable 6h format'), ['enable', '6', 'h', 'format']);
      assert.deepEqual(_.words('enable 24H format'), ['enable', '24', 'H', 'format']);
      assert.deepEqual(_.words('isISO8601'), ['is', 'ISO', '8601']);
      assert.deepEqual(_.words('LETTERSAeiouAreVowels'), ['LETTERS', 'Aeiou', 'Are', 'Vowels']);
      assert.deepEqual(_.words('tooLegit2Quit'), ['too', 'Legit', '2', 'Quit']);
      assert.deepEqual(_.words('walk500Miles'), ['walk', '500', 'Miles']);
      assert.deepEqual(_.words('xhr2Request'), ['xhr', '2', 'Request']);
      assert.deepEqual(_.words('XMLHttp'), ['XML', 'Http']);
      assert.deepEqual(_.words('XmlHTTP'), ['Xml', 'HTTP']);
      assert.deepEqual(_.words('XmlHttp'), ['Xml', 'Http']);
    }
```

#### should not treat contractions as separate words

```ts
test('should not treat contractions as separate words', function(assert) {
      assert.expect(4);

      var postfixes = ['d', 'll', 'm', 're', 's', 't', 've'];

      lodashStable.each(["'", '\u2019'], function(apos) {
        lodashStable.times(2, function(index) {
          var actual = lodashStable.map(postfixes, function(postfix) {
            var string = 'a b' + apos + postfix +  ' c';
            return _.words(string[index ? 'toUpperCase' : 'toLowerCase']());
          });

          var expected = lodashStable.map(postfixes, function(postfix) {
            var words = ['a', 'b' + apos + postfix, 'c'];
            return lodashStable.map(words, function(word) {
              return word[index ? 'toUpperCase' : 'toLowerCase']();
            });
          });

          assert.deepEqual(actual, expected);
        });
      });
    }
```

#### should not treat ordinal numbers as separate words

```ts
test('should not treat ordinal numbers as separate words', function(assert) {
      assert.expect(2);

      var ordinals = ['1st', '2nd', '3rd', '4th'];

      lodashStable.times(2, function(index) {
        var expected = lodashStable.map(ordinals, function(ordinal) {
          return [ordinal[index ? 'toUpperCase' : 'toLowerCase']()];
        });

        var actual = lodashStable.map(expected, function(words) {
          return _.words(words[0]);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var strings = lodashStable.map(['a', 'b', 'c'], Object),
          actual = lodashStable.map(strings, _.words);

      assert.deepEqual(actual, [['a'], ['b'], ['c']]);
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

#### should stringify the wrapped value when used by `JSON.stringify`

```ts
test('should stringify the wrapped value when used by `JSON.stringify`', function(assert) {
      assert.expect(1);

      if (!isNpm && JSON) {
        var wrapped = _([1, 2, 3]);
        assert.strictEqual(JSON.stringify(wrapped), '[1,2,3]');
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should return an empty string for empty values

```ts
test('`_.' + methodName + '` should return an empty string for empty values', function(assert) {
        assert.expect(1);

        var values = [, null, undefined, ''],
            expected = lodashStable.map(values, stubString);

        var actual = lodashStable.map(values, function(value, index) {
          return index ? func(value) : func();
        });

        assert.deepEqual(actual, expected);
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/utils.js

#### should support strings

```ts
it('should support strings', function(){
    assert.strictEqual(utils.etag('express!'),
      '"8-O2uVAFaQ1rZvlKLT14RnuvjPIdg"')
  }
```

#### should support utf8 strings

```ts
it('should support utf8 strings', function(){
    assert.strictEqual(utils.etag('express❤', 'utf8'),
      '"a-JBiXf7GyzxwcrxY4hVXUwa7tmks"')
  }
```

#### should support empty string

```ts
it('should support empty string', function(){
    assert.strictEqual(utils.etag(''),
      '"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"')
  }
```

#### should support strings

```ts
it('should support strings', function(){
    assert.strictEqual(utils.wetag('express!'),
      'W/"8-O2uVAFaQ1rZvlKLT14RnuvjPIdg"')
  }
```

#### should support utf8 strings

```ts
it('should support utf8 strings', function(){
    assert.strictEqual(utils.wetag('express❤', 'utf8'),
      'W/"a-JBiXf7GyzxwcrxY4hVXUwa7tmks"')
  }
```

#### should support empty string

```ts
it('should support empty string', function(){
    assert.strictEqual(utils.wetag(''),
      'W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"')
  }
```

#### should return generateETag for string values "strong" and "weak"

```ts
it('should return generateETag for string values "strong" and "weak"', function () {
    assert.strictEqual(utils.compileETag('strong')("express"), utils.etag("express"));
    assert.strictEqual(utils.compileETag('weak')("express"), utils.wetag("express"));
  }
```

#### should throw for unknown string values

```ts
it('should throw for unknown string values', function () {
    assert.throws(() => utils.compileETag('foo'), TypeError);
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/collections.js

#### Iterating objects with sketchy length properties

```ts
test('Iterating objects with sketchy length properties', function(assert) {
    var functions = [
      'each', 'map', 'filter', 'find',
      'some', 'every', 'max', 'min',
      'groupBy', 'countBy', 'partition', 'indexBy'
    ];
    var reducers = ['reduce', 'reduceRight'];

    var tricks = [
      {length: '5'},
      {length: {valueOf: _.constant(5)}},
      {length: Math.pow(2, 53) + 1},
      {length: Math.pow(2, 53)},
      {length: null},
      {length: -2},
      {length: new Number(15)}
    ];

    assert.expect(tricks.length * (functions.length + reducers.length + 4));

    _.each(tricks, function(trick) {
      var length = trick.length;
      assert.strictEqual(_.size(trick), 1, 'size on obj with length: ' + length);
      assert.deepEqual(_.toArray(trick), [length], 'toArray on obj with length: ' + length);
      assert.deepEqual(_.shuffle(trick), [length], 'shuffle on obj with length: ' + length);
      assert.deepEqual(_.sample(trick), length, 'sample on obj with length: ' + length);


      _.each(functions, function(method) {
        _[method](trick, function(val, key) {
          assert.strictEqual(key, 'length', method + ': ran with length = ' + val);
        });
      });

      _.each(reducers, function(method) {
        assert.strictEqual(_[method](trick), trick.length, method);
      });
    });
  }
```

#### map

```ts
test('map', function(assert) {
    var doubled = _.map([1, 2, 3], function(num){ return num * 2; });
    assert.deepEqual(doubled, [2, 4, 6], 'doubled numbers');

    var tripled = _.map([1, 2, 3], function(num){ return num * this.multiplier; }, {multiplier: 3});
    assert.deepEqual(tripled, [3, 6, 9], 'tripled numbers with context');

    doubled = _([1, 2, 3]).map(function(num){ return num * 2; });
    assert.deepEqual(doubled, [2, 4, 6], 'OO-style doubled numbers');

    var ids = _.map({length: 2, 0: {id: '1'}, 1: {id: '2'}}, function(n){
      return n.id;
    });
    assert.deepEqual(ids, ['1', '2'], 'Can use collection methods on Array-likes.');

    assert.deepEqual(_.map(null, _.noop), [], 'handles a null properly');

    assert.deepEqual(_.map([1], function() {
      return this.length;
    }, [5]), [1], 'called with context');

    // Passing a property name like _.pluck.
    var people = [{name: 'moe', age: 30}, {name: 'curly', age: 50}];
    assert.deepEqual(_.map(people, 'name'), ['moe', 'curly'], 'predicate string map to object properties');
  }
```

#### filter

```ts
test('filter', function(assert) {
    var evenArray = [1, 2, 3, 4, 5, 6];
    var evenObject = {one: 1, two: 2, three: 3};
    var isEven = function(num){ return num % 2 === 0; };

    assert.deepEqual(_.filter(evenArray, isEven), [2, 4, 6]);
    assert.deepEqual(_.filter(evenObject, isEven), [2], 'can filter objects');
    assert.deepEqual(_.filter([{}, evenObject, []], 'two'), [evenObject], 'predicate string map to object properties');

    _.filter([1], function() {
      assert.equal(this, evenObject, 'given context');
    }, evenObject);

    // Can be used like _.where.
    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}];
    assert.deepEqual(_.filter(list, {a: 1}), [{a: 1, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}]);
    assert.deepEqual(_.filter(list, {b: 2}), [{a: 1, b: 2}, {a: 2, b: 2}]);
    assert.deepEqual(_.filter(list, {}), list, 'Empty object accepts all items');
    assert.deepEqual(_(list).filter({}), list, 'OO-filter');
  }
```

#### reject

```ts
test('reject', function(assert) {
    var odds = _.reject([1, 2, 3, 4, 5, 6], function(num){ return num % 2 === 0; });
    assert.deepEqual(odds, [1, 3, 5], 'rejected each even number');

    var context = 'obj';

    var evens = _.reject([1, 2, 3, 4, 5, 6], function(num){
      assert.equal(context, 'obj');
      return num % 2 !== 0;
    }, context);
    assert.deepEqual(evens, [2, 4, 6], 'rejected each odd number');

    assert.deepEqual(_.reject([odds, {one: 1, two: 2, three: 3}], 'two'), [odds], 'predicate string map to object properties');

    // Can be used like _.where.
    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}];
    assert.deepEqual(_.reject(list, {a: 1}), [{a: 2, b: 2}]);
    assert.deepEqual(_.reject(list, {b: 2}), [{a: 1, b: 3}, {a: 1, b: 4}]);
    assert.deepEqual(_.reject(list, {}), [], 'Returns empty list given empty object');
    assert.deepEqual(_.reject(list, []), [], 'Returns empty list given empty array');
  }
```

#### every

```ts
test('every', function(assert) {
    assert.ok(_.every([], _.identity), 'the empty set');
    assert.ok(_.every([true, true, true], _.identity), 'every true values');
    assert.notOk(_.every([true, false, true], _.identity), 'one false value');
    assert.ok(_.every([0, 10, 28], function(num){ return num % 2 === 0; }), 'even numbers');
    assert.notOk(_.every([0, 11, 28], function(num){ return num % 2 === 0; }), 'an odd number');
    assert.strictEqual(_.every([1], _.identity), true, 'cast to boolean - true');
    assert.strictEqual(_.every([0], _.identity), false, 'cast to boolean - false');
    assert.notOk(_.every([void 0, void 0, void 0], _.identity), 'works with arrays of undefined');

    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}];
    assert.notOk(_.every(list, {a: 1, b: 2}), 'Can be called with object');
    assert.ok(_.every(list, 'a'), 'String mapped to object property');

    list = [{a: 1, b: 2}, {a: 2, b: 2, c: true}];
    assert.ok(_.every(list, {b: 2}), 'Can be called with object');
    assert.notOk(_.every(list, 'c'), 'String mapped to object property');

    assert.ok(_.every({a: 1, b: 2, c: 3, d: 4}, _.isNumber), 'takes objects');
    assert.notOk(_.every({a: 1, b: 2, c: 3, d: 4}, _.isObject), 'takes objects');
    assert.ok(_.every(['a', 'b', 'c', 'd'], _.hasOwnProperty, {a: 1, b: 2, c: 3, d: 4}), 'context works');
    assert.notOk(_.every(['a', 'b', 'c', 'd', 'f'], _.hasOwnProperty, {a: 1, b: 2, c: 3, d: 4}), 'context works');
  }
```

#### some

```ts
test('some', function(assert) {
    assert.notOk(_.some([]), 'the empty set');
    assert.notOk(_.some([false, false, false]), 'all false values');
    assert.ok(_.some([false, false, true]), 'one true value');
    assert.ok(_.some([null, 0, 'yes', false]), 'a string');
    assert.notOk(_.some([null, 0, '', false]), 'falsy values');
    assert.notOk(_.some([1, 11, 29], function(num){ return num % 2 === 0; }), 'all odd numbers');
    assert.ok(_.some([1, 10, 29], function(num){ return num % 2 === 0; }), 'an even number');
    assert.strictEqual(_.some([1], _.identity), true, 'cast to boolean - true');
    assert.strictEqual(_.some([0], _.identity), false, 'cast to boolean - false');
    assert.ok(_.some([false, false, true]));

    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}];
    assert.notOk(_.some(list, {a: 5, b: 2}), 'Can be called with object');
    assert.ok(_.some(list, 'a'), 'String mapped to object property');

    list = [{a: 1, b: 2}, {a: 2, b: 2, c: true}];
    assert.ok(_.some(list, {b: 2}), 'Can be called with object');
    assert.notOk(_.some(list, 'd'), 'String mapped to object property');

    assert.ok(_.some({a: '1', b: '2', c: '3', d: '4', e: 6}, _.isNumber), 'takes objects');
    assert.notOk(_.some({a: 1, b: 2, c: 3, d: 4}, _.isObject), 'takes objects');
    assert.ok(_.some(['a', 'b', 'c', 'd'], _.hasOwnProperty, {a: 1, b: 2, c: 3, d: 4}), 'context works');
    assert.notOk(_.some(['x', 'y', 'z'], _.hasOwnProperty, {a: 1, b: 2, c: 3, d: 4}), 'context works');
  }
```

#### includes

```ts
test('includes', function(assert) {
    _.each([null, void 0, 0, 1, NaN, {}, []], function(val) {
      assert.strictEqual(_.includes(val, 'hasOwnProperty'), false);
    });
    assert.strictEqual(_.includes([1, 2, 3], 2), true, 'two is in the array');
    assert.notOk(_.includes([1, 3, 9], 2), 'two is not in the array');

    assert.strictEqual(_.includes([5, 4, 3, 2, 1], 5, true), true, 'doesn\'t delegate to binary search');

    assert.strictEqual(_.includes({moe: 1, larry: 3, curly: 9}, 3), true, '_.includes on objects checks their values');
    assert.ok(_([1, 2, 3]).includes(2), 'OO-style includes');

    var numbers = [1, 2, 3, 1, 2, 3, 1, 2, 3];
    assert.strictEqual(_.includes(numbers, 1, 1), true, 'takes a fromIndex');
    assert.strictEqual(_.includes(numbers, 1, -1), false, 'takes a fromIndex');
    assert.strictEqual(_.includes(numbers, 1, -2), false, 'takes a fromIndex');
    assert.strictEqual(_.includes(numbers, 1, -3), true, 'takes a fromIndex');
    assert.strictEqual(_.includes(numbers, 1, 6), true, 'takes a fromIndex');
    assert.strictEqual(_.includes(numbers, 1, 7), false, 'takes a fromIndex');

    assert.ok(_.every([1, 2, 3], _.partial(_.includes, numbers)), 'fromIndex is guarded');
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

#### max

```ts
test('max', function(assert) {
    assert.equal(-Infinity, _.max(null), 'can handle null/undefined');
    assert.equal(-Infinity, _.max(void 0), 'can handle null/undefined');
    assert.equal(-Infinity, _.max(null, _.identity), 'can handle null/undefined');

    assert.equal(_.max([1, 2, 3]), 3, 'can perform a regular Math.max');

    var neg = _.max([1, 2, 3], function(num){ return -num; });
    assert.equal(neg, 1, 'can perform a computation-based max');

    assert.equal(-Infinity, _.max({}), 'Maximum value of an empty object');
    assert.equal(-Infinity, _.max([]), 'Maximum value of an empty array');
    assert.equal(_.max({a: 'a'}), -Infinity, 'Maximum value of a non-numeric collection');

    assert.equal(_.max(_.range(1, 300000)), 299999, 'Maximum value of a too-big array');

    assert.equal(_.max([1, 2, 3, 'test']), 3, 'Finds correct max in array starting with num and containing a NaN');
    assert.equal(_.max(['test', 1, 2, 3]), 3, 'Finds correct max in array starting with NaN');

    assert.equal(_.max([1, 2, 3, null]), 3, 'Finds correct max in array starting with num and containing a `null`');
    assert.equal(_.max([null, 1, 2, 3]), 3, 'Finds correct max in array starting with a `null`');

    assert.equal(_.max([1, 2, 3, '']), 3, 'Finds correct max in array starting with num and containing an empty string');
    assert.equal(_.max(['', 1, 2, 3]), 3, 'Finds correct max in array starting with an empty string');

    assert.equal(_.max([1, 2, 3, false]), 3, 'Finds correct max in array starting with num and containing a false');
    assert.equal(_.max([false, 1, 2, 3]), 3, 'Finds correct max in array starting with a false');

    assert.equal(_.max([0, 1, 2, 3, 4]), 4, 'Finds correct max in array containing a zero');
    assert.equal(_.max([-3, -2, -1, 0]), 0, 'Finds correct max in array containing negative numbers');

    assert.deepEqual(_.map([[1, 2, 3], [4, 5, 6]], _.max), [3, 6], 'Finds correct max in array when mapping through multiple arrays');

    var a = {x: -Infinity};
    var b = {x: -Infinity};
    var iterator = function(o){ return o.x; };
    assert.equal(_.max([a, b], iterator), a, 'Respects iterator return value of -Infinity');

    assert.deepEqual(_.max([{a: 1}, {a: 0, b: 3}, {a: 4}, {a: 2}], 'a'), {a: 4}, 'String keys use property iterator');

    assert.deepEqual(_.max([0, 2], function(c){ return c * this.x; }, {x: 1}), 2, 'Iterator context');
    assert.deepEqual(_.max([[1], [2, 3], [-1, 4], [5]], 0), [5], 'Lookup falsy iterator');
    assert.deepEqual(_.max([{0: 1}, {0: 2}, {0: -1}, {a: 1}], 0), {0: 2}, 'Lookup falsy iterator');
  }
```

#### min

```ts
test('min', function(assert) {
    assert.equal(_.min(null), Infinity, 'can handle null/undefined');
    assert.equal(_.min(void 0), Infinity, 'can handle null/undefined');
    assert.equal(_.min(null, _.identity), Infinity, 'can handle null/undefined');

    assert.equal(_.min([1, 2, 3]), 1, 'can perform a regular Math.min');

    var neg = _.min([1, 2, 3], function(num){ return -num; });
    assert.equal(neg, 3, 'can perform a computation-based min');

    assert.equal(_.min({}), Infinity, 'Minimum value of an empty object');
    assert.equal(_.min([]), Infinity, 'Minimum value of an empty array');
    assert.equal(_.min({a: 'a'}), Infinity, 'Minimum value of a non-numeric collection');

    assert.deepEqual(_.map([[1, 2, 3], [4, 5, 6]], _.min), [1, 4], 'Finds correct min in array when mapping through multiple arrays');

    var now = new Date(9999999999);
    var then = new Date(0);
    assert.equal(_.min([now, then]), then);

    assert.equal(_.min(_.range(1, 300000)), 1, 'Minimum value of a too-big array');

    assert.equal(_.min([1, 2, 3, 'test']), 1, 'Finds correct min in array starting with num and containing a NaN');
    assert.equal(_.min(['test', 1, 2, 3]), 1, 'Finds correct min in array starting with NaN');

    assert.equal(_.min([1, 2, 3, null]), 1, 'Finds correct min in array starting with num and containing a `null`');
    assert.equal(_.min([null, 1, 2, 3]), 1, 'Finds correct min in array starting with a `null`');

    assert.equal(_.min([0, 1, 2, 3, 4]), 0, 'Finds correct min in array containing a zero');
    assert.equal(_.min([-3, -2, -1, 0]), -3, 'Finds correct min in array containing negative numbers');

    var a = {x: Infinity};
    var b = {x: Infinity};
    var iterator = function(o){ return o.x; };
    assert.equal(_.min([a, b], iterator), a, 'Respects iterator return value of Infinity');

    assert.deepEqual(_.min([{a: 1}, {a: 0, b: 3}, {a: 4}, {a: 2}], 'a'), {a: 0, b: 3}, 'String keys use property iterator');

    assert.deepEqual(_.min([0, 2], function(c){ return c * this.x; }, {x: -1}), 2, 'Iterator context');
    assert.deepEqual(_.min([[1], [2, 3], [-1, 4], [5]], 0), [-1, 4], 'Lookup falsy iterator');
    assert.deepEqual(_.min([{0: 1}, {0: 2}, {0: -1}, {a: 1}], 0), {0: -1}, 'Lookup falsy iterator');
  }
```

#### sortBy

```ts
test('sortBy', function(assert) {
    var people = [{name: 'curly', age: 50}, {name: 'moe', age: 30}];
    people = _.sortBy(people, function(person){ return person.age; });
    assert.deepEqual(_.pluck(people, 'name'), ['moe', 'curly'], 'stooges sorted by age');

    var list = [void 0, 4, 1, void 0, 3, 2];
    assert.deepEqual(_.sortBy(list, _.identity), [1, 2, 3, 4, void 0, void 0], 'sortBy with undefined values');

    list = ['one', 'two', 'three', 'four', 'five'];
    var sorted = _.sortBy(list, 'length');
    assert.deepEqual(sorted, ['one', 'two', 'four', 'five', 'three'], 'sorted by length');

    function Pair(x, y) {
      this.x = x;
      this.y = y;
    }

    var stableArray = [
      new Pair(1, 1), new Pair(1, 2),
      new Pair(1, 3), new Pair(1, 4),
      new Pair(1, 5), new Pair(1, 6),
      new Pair(2, 1), new Pair(2, 2),
      new Pair(2, 3), new Pair(2, 4),
      new Pair(2, 5), new Pair(2, 6),
      new Pair(void 0, 1), new Pair(void 0, 2),
      new Pair(void 0, 3), new Pair(void 0, 4),
      new Pair(void 0, 5), new Pair(void 0, 6)
    ];

    var stableObject = _.object('abcdefghijklmnopqr'.split(''), stableArray);

    var actual = _.sortBy(stableArray, function(pair) {
      return pair.x;
    });

    assert.deepEqual(actual, stableArray, 'sortBy should be stable for arrays');
    assert.deepEqual(_.sortBy(stableArray, 'x'), stableArray, 'sortBy accepts property string');

    actual = _.sortBy(stableObject, function(pair) {
      return pair.x;
    });

    assert.deepEqual(actual, stableArray, 'sortBy should be stable for objects');

    list = ['q', 'w', 'e', 'r', 't', 'y'];
    assert.deepEqual(_.sortBy(list), ['e', 'q', 'r', 't', 'w', 'y'], 'uses _.identity if iterator is not specified');
  }
```

#### groupBy

```ts
test('groupBy', function(assert) {
    var parity = _.groupBy([1, 2, 3, 4, 5, 6], function(num){ return num % 2; });
    assert.ok('0' in parity && '1' in parity, 'created a group for each value');
    assert.deepEqual(parity[0], [2, 4, 6], 'put each even number in the right group');

    var list = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    var grouped = _.groupBy(list, 'length');
    assert.deepEqual(grouped['3'], ['one', 'two', 'six', 'ten']);
    assert.deepEqual(grouped['4'], ['four', 'five', 'nine']);
    assert.deepEqual(grouped['5'], ['three', 'seven', 'eight']);

    var context = {};
    _.groupBy([{}], function(){ assert.strictEqual(this, context); }, context);

    grouped = _.groupBy([4.2, 6.1, 6.4], function(num) {
      return Math.floor(num) > 4 ? 'hasOwnProperty' : 'constructor';
    });
    assert.equal(grouped.constructor.length, 1);
    assert.equal(grouped.hasOwnProperty.length, 2);

    var array = [{}];
    _.groupBy(array, function(value, index, obj){ assert.strictEqual(obj, array); });

    array = [1, 2, 1, 2, 3];
    grouped = _.groupBy(array);
    assert.equal(grouped['1'].length, 2);
    assert.equal(grouped['3'].length, 1);

    var matrix = [
      [1, 2],
      [1, 3],
      [2, 3]
    ];
    assert.deepEqual(_.groupBy(matrix, 0), {1: [[1, 2], [1, 3]], 2: [[2, 3]]});
    assert.deepEqual(_.groupBy(matrix, 1), {2: [[1, 2]], 3: [[1, 3], [2, 3]]});
  }
```

#### shuffle

```ts
test('shuffle', function(assert) {
    assert.deepEqual(_.shuffle([1]), [1], 'behaves correctly on size 1 arrays');
    var numbers = _.range(20);
    var shuffled = _.shuffle(numbers);
    assert.notDeepEqual(numbers, shuffled, 'does change the order'); // Chance of false negative: 1 in ~2.4*10^18
    assert.notStrictEqual(numbers, shuffled, 'original object is unmodified');
    assert.deepEqual(numbers, _.sortBy(shuffled), 'contains the same members before and after shuffle');

    shuffled = _.shuffle({a: 1, b: 2, c: 3, d: 4});
    assert.equal(shuffled.length, 4);
    assert.deepEqual(shuffled.sort(), [1, 2, 3, 4], 'works on objects');
  }
```

#### sample

```ts
test('sample', function(assert) {
    assert.strictEqual(_.sample([1]), 1, 'behaves correctly when no second parameter is given');
    assert.deepEqual(_.sample([1, 2, 3], -2), [], 'behaves correctly on negative n');
    var numbers = _.range(10);
    var allSampled = _.sample(numbers, 10).sort();
    assert.deepEqual(allSampled, numbers, 'contains the same members before and after sample');
    allSampled = _.sample(numbers, 20).sort();
    assert.deepEqual(allSampled, numbers, 'also works when sampling more objects than are present');
    assert.ok(_.contains(numbers, _.sample(numbers)), 'sampling a single element returns something from the array');
    assert.strictEqual(_.sample([]), void 0, 'sampling empty array with no number returns undefined');
    assert.notStrictEqual(_.sample([], 5), [], 'sampling empty array with a number returns an empty array');
    assert.notStrictEqual(_.sample([1, 2, 3], 0), [], 'sampling an array with 0 picks returns an empty array');
    assert.deepEqual(_.sample([1, 2], -1), [], 'sampling a negative number of picks returns an empty array');
    assert.ok(_.contains([1, 2, 3], _.sample({a: 1, b: 2, c: 3})), 'sample one value from an object');
    var partialSample = _.sample(_.range(1000), 10);
    var partialSampleSorted = partialSample.sort();
    assert.notDeepEqual(partialSampleSorted, _.range(10), 'samples from the whole array, not just the beginning');
  }
```

#### toArray

```ts
test('toArray', function(assert) {
    assert.notOk(_.isArray(arguments), 'arguments object is not an array');
    assert.ok(_.isArray(_.toArray(arguments)), 'arguments object converted into array');
    var a = [1, 2, 3];
    assert.notStrictEqual(_.toArray(a), a, 'array is cloned');
    assert.deepEqual(_.toArray(a), [1, 2, 3], 'cloned array contains same elements');

    var numbers = _.toArray({one: 1, two: 2, three: 3});
    assert.deepEqual(numbers, [1, 2, 3], 'object flattened into array');

    var hearts = '\uD83D\uDC95';
    var pair = hearts.split('');
    var expected = [pair[0], hearts, '&', hearts, pair[1]];
    assert.deepEqual(_.toArray(expected.join('')), expected, 'maintains astral characters');
    assert.deepEqual(_.toArray(''), [], 'empty string into empty array');

    if (typeof document != 'undefined') {
      // test in IE < 9
      var actual;
      try {
        actual = _.toArray(document.childNodes);
      } catch (e) { /* ignored */ }
      assert.deepEqual(actual, _.map(document.childNodes, _.identity), 'works on NodeList');
    }
  }
```

#### size

```ts
test('size', function(assert) {
    assert.equal(_.size({one: 1, two: 2, three: 3}), 3, 'can compute the size of an object');
    assert.equal(_.size([1, 2, 3]), 3, 'can compute the size of an array');
    assert.equal(_.size({length: 3, 0: 0, 1: 0, 2: 0}), 3, 'can compute the size of Array-likes');

    var func = function() {
      return _.size(arguments);
    };

    assert.equal(func(1, 2, 3, 4), 4, 'can test the size of the arguments object');

    assert.equal(_.size('hello'), 5, 'can compute the size of a string literal');
    assert.equal(_.size(new String('hello')), 5, 'can compute the size of string object');

    assert.equal(_.size(null), 0, 'handles nulls');
    assert.equal(_.size(0), 0, 'handles numbers');
  }
```

#### partition

```ts
test('partition', function(assert) {
    var list = [0, 1, 2, 3, 4, 5];
    assert.deepEqual(_.partition(list, function(x) { return x < 4; }), [[0, 1, 2, 3], [4, 5]], 'handles bool return values');
    assert.deepEqual(_.partition(list, function(x) { return x & 1; }), [[1, 3, 5], [0, 2, 4]], 'handles 0 and 1 return values');
    assert.deepEqual(_.partition(list, function(x) { return x - 3; }), [[0, 1, 2, 4, 5], [3]], 'handles other numeric return values');
    assert.deepEqual(_.partition(list, function(x) { return x > 1 ? null : true; }), [[0, 1], [2, 3, 4, 5]], 'handles null return values');
    assert.deepEqual(_.partition(list, function(x) { if (x < 2) return true; }), [[0, 1], [2, 3, 4, 5]], 'handles undefined return values');
    assert.deepEqual(_.partition({a: 1, b: 2, c: 3}, function(x) { return x > 1; }), [[2, 3], [1]], 'handles objects');

    assert.deepEqual(_.partition(list, function(x, index) { return index % 2; }), [[1, 3, 5], [0, 2, 4]], 'can reference the array index');
    assert.deepEqual(_.partition(list, function(x, index, arr) { return x === arr.length - 1; }), [[5], [0, 1, 2, 3, 4]], 'can reference the collection');

    // Default iterator
    assert.deepEqual(_.partition([1, false, true, '']), [[1, true], [false, '']], 'Default iterator');
    assert.deepEqual(_.partition([{x: 1}, {x: 0}, {x: 1}], 'x'), [[{x: 1}, {x: 1}], [{x: 0}]], 'Takes a string');

    // Context
    var predicate = function(x){ return x === this.x; };
    assert.deepEqual(_.partition([1, 2, 3], predicate, {x: 2}), [[2], [1, 3]], 'partition takes a context argument');

    assert.deepEqual(_.partition([{a: 1}, {b: 2}, {a: 1, b: 2}], {a: 1}), [[{a: 1}, {a: 1, b: 2}], [{b: 2}]], 'predicate can be object');

    var object = {a: 1};
    _.partition(object, function(val, key, obj) {
      assert.equal(val, 1);
      assert.equal(key, 'a');
      assert.equal(obj, object);
      assert.equal(this, predicate);
    }, predicate);
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.get.js

#### should throw for non-string header name

```ts
it('should throw for non-string header name', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.end(req.get(42))
      })

      request(app)
      .get('/')
      .expect(500, /TypeError: name must be a string to req.get/, done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.location.js

#### should consistently handle non-string input: boolean

```ts
it('should consistently handle non-string input: boolean', function (done) {
      var app = express()
      app.use(function (req, res) {
        res.location(true).end();
      });

      request(app)
        .get('/')
        .expect('Location', 'true')
        .expect(200, done)
    }
```

#### should consistently handle non-string inputs: object

```ts
it('should consistently handle non-string inputs: object', function (done) {
      var app = express()
      app.use(function (req, res) {
        res.location({}).end();
      });

      request(app)
        .get('/')
        .expect('Location', '[object%20Object]')
        .expect(200, done)
    }
```

#### should consistently handle non-string inputs: array

```ts
it('should consistently handle non-string inputs: array', function (done) {
      var app = express()
      app.use(function (req, res) {
        res.location([]).end();
      });

      request(app)
        .get('/')
        .expect('Location', '')
        .expect(200, done)
    }
```

#### should consistently handle empty string input

```ts
it('should consistently handle empty string input', function (done) {
      var app = express()
      app.use(function (req, res) {
        res.location('').end();
      });

      request(app)
        .get('/')
        .expect('Location', '')
        .expect(200, done)
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

### ../../.sbomtest/repos/f3c62de455-express/test/app.listen.js

#### accepts port + hostname + backlog + callback

```ts
it('accepts port + hostname + backlog + callback', function (done) {
    const app = express();
    const server = app.listen(0, '127.0.0.1', 5, function () {
      const { address, port } = server.address();
      assert.strictEqual(address, '127.0.0.1');
      assert(Number.isInteger(port) && port > 0);
      // backlog isn’t directly inspectable, but if no error was thrown
      // we know it was accepted.
      server.close(done);
    });
  }
```

#### server.address() gives a { address, port, family } object

```ts
it('server.address() gives a { address, port, family } object', function (done) {
    const app = express();
    const server = app.listen(0, () => {
      const addr = server.address();
      assert(addr && typeof addr === 'object');
      assert.strictEqual(typeof addr.address, 'string');
      assert(Number.isInteger(addr.port) && addr.port > 0);
      assert(typeof addr.family === 'string');
      server.close(done);
    });
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.sendFile.js

#### should error for non-string path

```ts
it('should error for non-string path', function (done) {
      var app = createApp(42)

      request(app)
      .get('/')
      .expect(500, /TypeError: path must be a string to res.sendFile/, done)
    }
```

#### should transfer a file with special characters in string

```ts
it('should transfer a file with special characters in string', function (done) {
      var app = createApp(path.resolve(fixtures, '% of dogs.txt'));

      request(app)
      .get('/')
      .expect(200, '20%', done);
    }
```

#### should persist store on error

```ts
it('should persist store on error', function (done) {
        var app = express()
        var store = { foo: 'bar' }

        app.use(function (req, res, next) {
          req.asyncLocalStorage = new AsyncLocalStorage()
          req.asyncLocalStorage.run(store, next)
        })

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'does-not-exist'), function (err) {
            var local = req.asyncLocalStorage.getStore()

            if (local) {
              res.setHeader('x-store-foo', String(local.foo))
            }

            res.send(err ? 'got ' + err.status + ' error' : 'no error')
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('x-store-foo', 'bar')
          .expect('got 404 error')
          .end(done)
      }
```

#### should conditionally respond with if-modified-since

```ts
it('should conditionally respond with if-modified-since', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              lastModified: true
            })
          })

          request(app)
            .get('/')
            .set('If-Modified-Since', (new Date(Date.now() + 99999).toUTCString()))
            .expect(304, done)
        }
```

#### should not honor if-modified-since

```ts
it('should not honor if-modified-since', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              lastModified: false
            })
          })

          request(app)
            .get('/')
            .set('If-Modified-Since', (new Date(Date.now() + 99999).toUTCString()))
            .expect(200)
            .expect(utils.shouldNotHaveHeader('Last-Modified'))
            .end(done)
        }
```

#### should accept plain number as milliseconds

```ts
it('should accept plain number as milliseconds', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              maxAge: '20000'
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Cache-Control', 'public, max-age=20')
            .end(done)
        }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.urlencoded.js

#### should parse array index notation with large array

```ts
it('should parse array index notation with large array', function (done) {
        var str = 'f[0]=0'

        for (var i = 1; i < 500; i++) {
          str += '&f[' + i + ']=' + i.toString(16)
        }

        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(str)
          .expect(function (res) {
            var obj = JSON.parse(res.text)
            assert.strictEqual(Object.keys(obj).length, 1)
            assert.strictEqual(Array.isArray(obj.f), true)
            assert.strictEqual(obj.f.length, 500)
          })
          .expect(200, done)
      }
```

#### should 413 when over limit with Content-Length

```ts
it('should 413 when over limit with Content-Length', function (done) {
      var buf = Buffer.alloc(1024, '.')
      request(createApp({ limit: '1kb' }))
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('Content-Length', '1028')
        .send('str=' + buf.toString())
        .expect(413, done)
    }
```

#### should 413 when over limit with chunked encoding

```ts
it('should 413 when over limit with chunked encoding', function (done) {
      var app = createApp({ limit: '1kb' })
      var buf = Buffer.alloc(1024, '.')
      var test = request(app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.set('Transfer-Encoding', 'chunked')
      test.write('str=')
      test.write(buf.toString())
      test.expect(413, done)
    }
```

#### should accept number of bytes

```ts
it('should accept number of bytes', function (done) {
      var buf = Buffer.alloc(1024, '.')
      request(createApp({ limit: 1024 }))
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('str=' + buf.toString())
        .expect(413, done)
    }
```

#### should not change when options altered

```ts
it('should not change when options altered', function (done) {
      var buf = Buffer.alloc(1024, '.')
      var options = { limit: '1kb' }
      var app = createApp(options)

      options.limit = '100kb'

      request(app)
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('str=' + buf.toString())
        .expect(413, done)
    }
```

#### should reject 0

```ts
it('should reject 0', function () {
        assert.throws(createApp.bind(null, { extended: false, parameterLimit: 0 }),
          /TypeError: option parameterLimit must be a positive number/)
      }
```

#### should reject string

```ts
it('should reject string', function () {
        assert.throws(createApp.bind(null, { extended: false, parameterLimit: 'beep' }),
          /TypeError: option parameterLimit must be a positive number/)
      }
```

#### should work if number is floating point

```ts
it('should work if number is floating point', function (done) {
        request(createApp({ extended: false, parameterLimit: 10.1 }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(11))
          .expect(413, /too many parameters/, done)
      }
```

#### should reject 0

```ts
it('should reject 0', function () {
        assert.throws(createApp.bind(null, { extended: true, parameterLimit: 0 }),
          /TypeError: option parameterLimit must be a positive number/)
      }
```

#### should reject string

```ts
it('should reject string', function () {
        assert.throws(createApp.bind(null, { extended: true, parameterLimit: 'beep' }),
          /TypeError: option parameterLimit must be a positive number/)
      }
```

#### should work if number is floating point

```ts
it('should work if number is floating point', function (done) {
        request(createApp({ extended: true, parameterLimit: 10.1 }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(11))
          .expect(413, /too many parameters/, done)
      }
```

#### should persist store when limit exceeded

```ts
it('should persist store when limit exceeded', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('user=' + Buffer.alloc(1024 * 100, '.').toString())
        .expect(413)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.static.js

#### should require root path to be string

```ts
it('should require root path to be string', function () {
      assert.throws(express.static.bind(null, 42), /root path.*string/)
    }
```

#### should 404 when URL too long

```ts
it('should 404 when URL too long', function (done) {
        var app = express()
        var root = fixtures + Array(10000).join('/foobar')

        app.use(express.static(root, { 'fallthrough': false }))
        app.use(function (req, res, next) {
          res.sendStatus(404)
        })

        request(app)
          .get('/')
          .expect(404, /ENAMETOOLONG/, done)
      }
```

#### should accept string

```ts
it('should accept string', function (done) {
      request(createApp(fixtures, { 'maxAge': '30d' }))
        .get('/todo.txt')
        .expect('cache-control', 'public, max-age=' + (60 * 60 * 24 * 30))
        .expect(200, done)
    }
```

#### should redirect directories with query string

```ts
it('should redirect directories with query string', function (done) {
      request(this.app)
        .get('/users?name=john')
        .expect('Location', '/users/?name=john')
        .expect(301, done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.raw.js

#### should 400 when invalid content-length

```ts
it('should 400 when invalid content-length', function (done) {
    var app = express()

    app.use(function (req, res, next) {
      req.headers['content-length'] = '20' // bad length
      next()
    })

    app.use(express.raw())

    app.post('/', function (req, res) {
      if (Buffer.isBuffer(req.body)) {
        res.json({ buf: req.body.toString('hex') })
      } else {
        res.json(req.body)
      }
    })

    request(app)
      .post('/')
      .set('Content-Type', 'application/octet-stream')
      .send('stuff')
      .expect(400, /content length/, done)
  }
```

#### should handle duplicated middleware

```ts
it('should handle duplicated middleware', function (done) {
    var app = express()

    app.use(express.raw())
    app.use(express.raw())

    app.post('/', function (req, res) {
      if (Buffer.isBuffer(req.body)) {
        res.json({ buf: req.body.toString('hex') })
      } else {
        res.json(req.body)
      }
    })

    request(app)
      .post('/')
      .set('Content-Type', 'application/octet-stream')
      .send('the user is tobi')
      .expect(200, { buf: '746865207573657220697320746f6269' }, done)
  }
```

#### should accept number of bytes

```ts
it('should accept number of bytes', function (done) {
      var buf = Buffer.alloc(1028, '.')
      var app = createApp({ limit: 1024 })
      var test = request(app).post('/')
      test.set('Content-Type', 'application/octet-stream')
      test.write(buf)
      test.expect(413, done)
    }
```

#### should persist store when limit exceeded

```ts
it('should persist store when limit exceeded', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/octet-stream')
        .send('the user is ' + Buffer.alloc(1024 * 100, '.').toString())
        .expect(413)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.jsonp.js

#### should invoke callback with a string

```ts
it('should invoke callback with a string', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.jsonp('tobi')
        })

        request(app)
          .get('/?callback=cb')
          .expect('Content-Type', 'text/javascript; charset=utf-8')
          .expect(200, /cb\("tobi"\)/, done)
      }
```

#### should invoke callback with a number

```ts
it('should invoke callback with a number', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.jsonp(42)
        })

        request(app)
          .get('/?callback=cb')
          .expect('Content-Type', 'text/javascript; charset=utf-8')
          .expect(200, /cb\(42\)/, done)
      }
```

#### should be passed to JSON.stringify()

```ts
it('should be passed to JSON.stringify()', function(done){
        var app = express();

        app.set('json replacer', function(key, val){
          return key[0] === '_'
            ? undefined
            : val;
        });

        app.use(function(req, res){
          res.jsonp({ name: 'tobi', _id: 12345 });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{"name":"tobi"}', done)
      }
```

#### should be passed to JSON.stringify()

```ts
it('should be passed to JSON.stringify()', function(done){
        var app = express();

        app.set('json spaces', 2);

        app.use(function(req, res){
          res.jsonp({ name: 'tobi', age: 2 });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{\n  "name": "tobi",\n  "age": 2\n}', done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.render.js

#### should pass the resulting string

```ts
it('should pass the resulting string', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))

      app.use(function(req, res){
        var tobi = { name: 'tobi' };
        res.render('user.tmpl', { user: tobi }, function (err, html) {
          html = html.replace('tobi', 'loki');
          res.end(html);
        });
      });

      request(app)
      .get('/')
      .expect('<p>loki</p>', done);
    }
```

#### should pass the resulting string

```ts
it('should pass the resulting string', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))

      app.use(function(req, res){
        res.locals.user = { name: 'tobi' };
        res.render('user.tmpl', function (err, html) {
          html = html.replace('tobi', 'loki');
          res.end(html);
        });
      });

      request(app)
      .get('/')
      .expect('<p>loki</p>', done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.text.js

#### should 413 when over limit with Content-Length

```ts
it('should 413 when over limit with Content-Length', function (done) {
      var buf = Buffer.alloc(1028, '.')
      request(createApp({ limit: '1kb' }))
        .post('/')
        .set('Content-Type', 'text/plain')
        .set('Content-Length', '1028')
        .send(buf.toString())
        .expect(413, done)
    }
```

#### should 413 when over limit with chunked encoding

```ts
it('should 413 when over limit with chunked encoding', function (done) {
      var app = createApp({ limit: '1kb' })
      var buf = Buffer.alloc(1028, '.')
      var test = request(app).post('/')
      test.set('Content-Type', 'text/plain')
      test.set('Transfer-Encoding', 'chunked')
      test.write(buf.toString())
      test.expect(413, done)
    }
```

#### should accept number of bytes

```ts
it('should accept number of bytes', function (done) {
      var buf = Buffer.alloc(1028, '.')
      request(createApp({ limit: 1024 }))
        .post('/')
        .set('Content-Type', 'text/plain')
        .send(buf.toString())
        .expect(413, done)
    }
```

#### should not change when options altered

```ts
it('should not change when options altered', function (done) {
      var buf = Buffer.alloc(1028, '.')
      var options = { limit: '1kb' }
      var app = createApp(options)

      options.limit = '100kb'

      request(app)
        .post('/')
        .set('Content-Type', 'text/plain')
        .send(buf.toString())
        .expect(413, done)
    }
```

#### should persist store when limit exceeded

```ts
it('should persist store when limit exceeded', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'text/plain')
        .send('user is ' + Buffer.alloc(1024 * 100, '.').toString())
        .expect(413)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.protocol.js

#### should return the protocol string

```ts
it('should return the protocol string', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.protocol);
      });

      request(app)
      .get('/')
      .expect('http', done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.param.js

#### should map the array

```ts
it('should map the array', function(done){
      var app = express();

      app.param(['id', 'uid'], function(req, res, next, id){
        id = Number(id);
        if (isNaN(id)) return next('route');
        req.params.id = id;
        next();
      });

      app.get('/post/:id', function(req, res){
        var id = req.params.id;
        res.send((typeof id) + ':' + id)
      });

      app.get('/user/:uid', function(req, res){
        var id = req.params.id;
        res.send((typeof id) + ':' + id)
      });

      request(app)
        .get('/user/123')
        .expect(200, 'number:123', function (err) {
          if (err) return done(err)
          request(app)
            .get('/post/123')
            .expect('number:123', done)
        })
    }
```

#### should map logic for a single param

```ts
it('should map logic for a single param', function(done){
      var app = express();

      app.param('id', function(req, res, next, id){
        id = Number(id);
        if (isNaN(id)) return next('route');
        req.params.id = id;
        next();
      });

      app.get('/user/:id', function(req, res){
        var id = req.params.id;
        res.send((typeof id) + ':' + id)
      });

      request(app)
        .get('/user/123')
        .expect(200, 'number:123', done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.hostname.js

#### should strip port number

```ts
it('should strip port number', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.hostname);
      });

      request(app)
      .post('/')
      .set('Host', 'example.com:3000')
      .expect('example.com', done);
    }
```

#### should return undefined otherwise

```ts
it('should return undefined otherwise', function(done){
      var app = express();

      app.use(function(req, res){
        req.headers.host = null;
        res.end(String(req.hostname));
      });

      request(app)
      .post('/')
      .expect('undefined', done);
    }
```

#### should strip port number

```ts
it('should strip port number', function (done) {
          var app = express()

          app.enable('trust proxy')

          app.use(function (req, res) {
            res.send(req.hostname)
          })

          request(app)
          .get('/')
          .set('Host', 'localhost')
          .set('X-Forwarded-Host', 'example.com:8080 , foobar.com:8888')
          .expect(200, 'example.com', done)
        }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/functions.js

#### partial

```ts
test('partial', function(assert) {
    var obj = {name: 'moe'};
    var func = function() { return this.name + ' ' + _.toArray(arguments).join(' '); };

    obj.func = _.partial(func, 'a', 'b');
    assert.equal(obj.func('c', 'd'), 'moe a b c d', 'can partially apply');

    obj.func = _.partial(func, _, 'b', _, 'd');
    assert.equal(obj.func('a', 'c'), 'moe a b c d', 'can partially apply with placeholders');

    func = _.partial(function() { return arguments.length; }, _, 'b', _, 'd');
    assert.equal(func('a', 'c', 'e'), 5, 'accepts more arguments than the number of placeholders');
    assert.equal(func('a'), 4, 'accepts fewer arguments than the number of placeholders');

    func = _.partial(function() { return typeof arguments[2]; }, _, 'b', _, 'd');
    assert.equal(func('a'), 'undefined', 'unfilled placeholders are undefined');

    // passes context
    function MyWidget(name, options) {
      this.name = name;
      this.options = options;
    }
    MyWidget.prototype.get = function() {
      return this.name;
    };
    var MyWidgetWithCoolOpts = _.partial(MyWidget, _, {a: 1});
    var widget = new MyWidgetWithCoolOpts('foo');
    assert.ok(widget instanceof MyWidget, 'Can partially bind a constructor');
    assert.equal(widget.get(), 'foo', 'keeps prototype');
    assert.deepEqual(widget.options, {a: 1});

    _.partial.placeholder = obj;
    func = _.partial(function() { return arguments.length; }, obj, 'b', obj, 'd');
    assert.equal(func('a'), 4, 'allows the placeholder to be swapped out');

    _.partial.placeholder = {};
    func = _.partial(function() { return arguments.length; }, obj, 'b', obj, 'd');
    assert.equal(func('a'), 5, 'swapping the placeholder preserves previously bound arguments');

    _.partial.placeholder = _;
  }
```

#### bindAll

```ts
test('bindAll', function(assert) {
    var curly = {name: 'curly'};
    var moe = {
      name: 'moe',
      getName: function() { return 'name: ' + this.name; },
      sayHi: function() { return 'hi: ' + this.name; }
    };
    curly.getName = moe.getName;
    _.bindAll(moe, 'getName', 'sayHi');
    curly.sayHi = moe.sayHi;
    assert.equal(curly.getName(), 'name: curly', 'unbound function is bound to current object');
    assert.equal(curly.sayHi(), 'hi: moe', 'bound function is still bound to original object');

    curly = {name: 'curly'};
    moe = {
      name: 'moe',
      getName: function() { return 'name: ' + this.name; },
      sayHi: function() { return 'hi: ' + this.name; },
      sayLast: function() { return this.sayHi(_.last(arguments)); }
    };

    assert.raises(function() { _.bindAll(moe); }, Error, 'throws an error for bindAll with no functions named');
    assert.raises(function() { _.bindAll(moe, 'sayBye'); }, TypeError, 'throws an error for bindAll if the given key is undefined');
    assert.raises(function() { _.bindAll(moe, 'name'); }, TypeError, 'throws an error for bindAll if the given key is not a function');

    _.bindAll(moe, 'sayHi', 'sayLast');
    curly.sayHi = moe.sayHi;
    assert.equal(curly.sayHi(), 'hi: moe');

    var sayLast = moe.sayLast;
    assert.equal(sayLast(1, 2, 3, 4, 5, 6, 7, 'Tom'), 'hi: moe', 'createCallback works with any number of arguments');

    _.bindAll(moe, ['getName']);
    var getName = moe.getName;
    assert.equal(getName(), 'name: moe', 'flattens arguments into a single list');
  }
```

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

#### iteratee

```ts
test('iteratee', function(assert) {
    var identity = _.iteratee();
    assert.equal(identity, _.identity, '_.iteratee is exposed as an external function.');

    function fn() {
      return arguments;
    }
    _.each([_.iteratee(fn), _.iteratee(fn, {})], function(cb) {
      assert.equal(cb().length, 0);
      assert.deepEqual(_.toArray(cb(1, 2, 3)), _.range(1, 4));
      assert.deepEqual(_.toArray(cb(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)), _.range(1, 11));
    });

    // Test custom iteratee
    var builtinIteratee = _.iteratee;
    _.iteratee = function(value) {
      // RegEx values return a function that returns the number of matches
      if (_.isRegExp(value)) return function(obj) {
        return (obj.match(value) || []).length;
      };
      return value;
    };

    var collection = ['foo', 'bar', 'bbiz'];

    // Test all methods that claim to be transformed through `_.iteratee`
    assert.deepEqual(_.countBy(collection, /b/g), {0: 1, 1: 1, 2: 1});
    assert.equal(_.every(collection, /b/g), false);
    assert.deepEqual(_.filter(collection, /b/g), ['bar', 'bbiz']);
    assert.equal(_.find(collection, /b/g), 'bar');
    assert.equal(_.findIndex(collection, /b/g), 1);
    assert.equal(_.findKey(collection, /b/g), 1);
    assert.equal(_.findLastIndex(collection, /b/g), 2);
    assert.deepEqual(_.groupBy(collection, /b/g), {0: ['foo'], 1: ['bar'], 2: ['bbiz']});
    assert.deepEqual(_.indexBy(collection, /b/g), {0: 'foo', 1: 'bar', 2: 'bbiz'});
    assert.deepEqual(_.map(collection, /b/g), [0, 1, 2]);
    assert.equal(_.max(collection, /b/g), 'bbiz');
    assert.equal(_.min(collection, /b/g), 'foo');
    assert.deepEqual(_.partition(collection, /b/g), [['bar', 'bbiz'], ['foo']]);
    assert.deepEqual(_.reject(collection, /b/g), ['foo']);
    assert.equal(_.some(collection, /b/g), true);
    assert.deepEqual(_.sortBy(collection, /b/g), ['foo', 'bar', 'bbiz']);
    assert.equal(_.sortedIndex(collection, 'blah', /b/g), 1);
    assert.deepEqual(_.uniq(collection, /b/g), ['foo', 'bar', 'bbiz']);

    var objCollection = {a: 'foo', b: 'bar', c: 'bbiz'};
    assert.deepEqual(_.mapObject(objCollection, /b/g), {a: 0, b: 1, c: 2});

    // Restore the builtin iteratee
    _.iteratee = builtinIteratee;
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.host.js

#### should strip port number

```ts
it('should strip port number', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.host);
      });

      request(app)
      .post('/')
      .set('Host', 'example.com:3000')
      .expect(200, 'example.com:3000', done);
    }
```

#### should return undefined otherwise

```ts
it('should return undefined otherwise', function(done){
      var app = express();

      app.use(function(req, res){
        req.headers.host = null;
        res.end(String(req.host));
      });

      request(app)
      .post('/')
      .expect('undefined', done);
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/cross-document.js

#### isEqual

```ts
test('isEqual', function(assert) {

    assert.notOk(_.isEqual(iNumber, 101));
    assert.ok(_.isEqual(iNumber, 100));

    // Objects from another frame.
    assert.ok(_.isEqual({}, iObject), 'Objects with equivalent members created in different documents are equal');

    // Array from another frame.
    assert.ok(_.isEqual([1, 2, 3], iArray), 'Arrays with equivalent elements created in different documents are equal');
  }
```

#### isEmpty

```ts
test('isEmpty', function(assert) {
    assert.notOk(_([iNumber]).isEmpty(), '[1] is not empty');
    assert.notOk(_.isEmpty(iArray), '[] is empty');
    assert.ok(_.isEmpty(iObject), '{} is empty');
  }
```

#### isElement

```ts
test('isElement', function(assert) {
    assert.notOk(_.isElement('div'), 'strings are not dom elements');
    assert.ok(_.isElement(document.body), 'the body tag is a DOM element');
    assert.ok(_.isElement(iElement), 'even from another frame');
  }
```

#### isString

```ts
test('isString', function(assert) {
    assert.ok(_.isString(iString), 'even from another frame');
  }
```

#### isNumber

```ts
test('isNumber', function(assert) {
    assert.ok(_.isNumber(iNumber), 'even from another frame');
  }
```

#### IE host objects

```ts
test('IE host objects', function(assert) {
      var xml = new ActiveXObject('Msxml2.DOMDocument.3.0');
      assert.notOk(_.isNumber(xml));
      assert.notOk(_.isBoolean(xml));
      assert.notOk(_.isNaN(xml));
      assert.notOk(_.isFunction(xml));
      assert.notOk(_.isNull(xml));
      assert.notOk(_.isUndefined(xml));
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.json.js

#### should respond with json for Number

```ts
it('should respond with json for Number', function(done){
        var app = express();

        app.use(function(req, res){
          res.json(300);
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '300', done)
      }
```

#### should respond with json for String

```ts
it('should respond with json for String', function(done){
        var app = express();

        app.use(function(req, res){
          res.json('str');
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '"str"', done)
      }
```

#### should be passed to JSON.stringify()

```ts
it('should be passed to JSON.stringify()', function(done){
        var app = express();

        app.set('json replacer', function(key, val){
          return key[0] === '_'
            ? undefined
            : val;
        });

        app.use(function(req, res){
          res.json({ name: 'tobi', _id: 12345 });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{"name":"tobi"}', done)
      }
```

#### should be passed to JSON.stringify()

```ts
it('should be passed to JSON.stringify()', function(done){
        var app = express();

        app.set('json spaces', 2);

        app.use(function(req, res){
          res.json({ name: 'tobi', age: 2 });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{\n  "name": "tobi",\n  "age": 2\n}', done)
      }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/arrays.js

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

#### range

```ts
test('range', function(assert) {
    assert.deepEqual(_.range(0), [], 'range with 0 as a first argument generates an empty array');
    assert.deepEqual(_.range(4), [0, 1, 2, 3], 'range with a single positive argument generates an array of elements 0,1,2,...,n-1');
    assert.deepEqual(_.range(5, 8), [5, 6, 7], 'range with two arguments a &amp; b, a&lt;b generates an array of elements a,a+1,a+2,...,b-2,b-1');
    assert.deepEqual(_.range(3, 10, 3), [3, 6, 9], 'range with three arguments a &amp; b &amp; c, c &lt; b-a, a &lt; b generates an array of elements a,a+c,a+2c,...,b - (multiplier of a) &lt; c');
    assert.deepEqual(_.range(3, 10, 15), [3], 'range with three arguments a &amp; b &amp; c, c &gt; b-a, a &lt; b generates an array with a single element, equal to a');
    assert.deepEqual(_.range(12, 7, -2), [12, 10, 8], 'range with three arguments a &amp; b &amp; c, a &gt; b, c &lt; 0 generates an array of elements a,a-c,a-2c and ends with the number not less than b');
    assert.deepEqual(_.range(0, -10, -1), [0, -1, -2, -3, -4, -5, -6, -7, -8, -9], 'final example in the Python docs');
    assert.strictEqual(1 / _.range(-0, 1)[0], -Infinity, 'should preserve -0');
    assert.deepEqual(_.range(8, 5), [8, 7, 6], 'negative range generates descending array');
    assert.deepEqual(_.range(-3), [0, -1, -2], 'negative range generates descending array');
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/test/test-fp.js

#### should only clone objects in `path`

```ts
test('should only clone objects in `path`', function(assert) {
      assert.expect(11);

      var object = { 'a': { 'b': 2, 'c': 3 }, 'd': { 'e': 4 } },
          value = _.cloneDeep(object),
          actual = fp.set('a.b.c.d', 5, value);

      assert.ok(_.isObject(actual.a.b), 'fp.set');
      assert.ok(_.isNumber(actual.a.b), 'fp.set');

      assert.strictEqual(actual.a.b.c.d, 5, 'fp.set');
      assert.strictEqual(actual.d, value.d, 'fp.set');

      value = _.cloneDeep(object);
      actual = fp.setWith(Object)('[0][1]')('a')(value);

      assert.deepEqual(actual[0], { '1': 'a' }, 'fp.setWith');

      value = _.cloneDeep(object);
      actual = fp.unset('a.b')(value);

      assert.notOk('b' in actual.a, 'fp.unset');
      assert.strictEqual(actual.a.c, value.a.c, 'fp.unset');

      value = _.cloneDeep(object);
      actual = fp.update('a.b')(square)(value);

      assert.strictEqual(actual.a.b, 4, 'fp.update');
      assert.strictEqual(actual.d, value.d, 'fp.update');

      value = _.cloneDeep(object);
      actual = fp.updateWith(Object)('[0][1]')(_.constant('a'))(value);

      assert.deepEqual(actual[0], { '1': 'a' }, 'fp.updateWith');
      assert.strictEqual(actual.d, value.d, 'fp.updateWith');
    }
```

#### `fp.' + methodName + '` should remove ' + parts + ' `chars`

```ts
test('`fp.' + methodName + '` should remove ' + parts + ' `chars`', function(assert) {
      assert.expect(1);

      var string = '-_-a-b-c-_-',
          expected = (index == 2 ? '-_-' : '') + 'a-b-c' + (index == 1 ? '-_-' : '');

      assert.strictEqual(func('_-')(string), expected);
    }
```

#### should not convert end of `path` to an object

```ts
test('should not convert end of `path` to an object', function(assert) {
      assert.expect(1);

      var actual = fp.update('a.b')(_.identity)({ 'a': { 'b': 1 } });
      assert.strictEqual(typeof actual.a.b, 'number');
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.use.js

#### should reject string as middleware

```ts
it('should reject string as middleware', function () {
      var app = express()
      assert.throws(function () { app.use('/', 'foo') }, /argument handler must be a function/)
    }
```

#### should reject number as middleware

```ts
it('should reject number as middleware', function () {
      var app = express()
      assert.throws(function () { app.use('/', 42) }, /argument handler must be a function/)
    }
```

#### should support empty string path

```ts
it('should support empty string path', function (done) {
      var app = express();

      app.use('', function (req, res) {
        res.send('saw ' + req.method + ' ' + req.url + ' through ' + req.originalUrl);
      });

      request(app)
      .get('/')
      .expect(200, 'saw GET / through /', done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.send.js

#### should send ETag for empty string response

```ts
it('should send ETag for empty string response', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.send('');
        });

        app.enable('etag');

        request(app)
        .get('/')
        .expect('ETag', 'W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"')
        .expect(200, done);
      }
```

#### should send custom ETag

```ts
it('should send custom ETag', function (done) {
        var app = express();

        app.set('etag', function (body, encoding) {
          var chunk = !Buffer.isBuffer(body)
            ? Buffer.from(body, encoding)
            : body;
          assert.strictEqual(chunk.toString(), 'hello, world!')
          return '"custom"';
        });

        app.use(function (req, res) {
          res.send('hello, world!');
        });

        request(app)
        .get('/')
        .expect('ETag', '"custom"')
        .expect(200, done);
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/Router.js

#### should reject string as middleware

```ts
it('should reject string as middleware', function () {
      var router = new Router()
      assert.throws(function () { router.use('/', 'foo') }, /argument handler must be a function/)
    }
```

#### should reject number as middleware

```ts
it('should reject number as middleware', function () {
      var router = new Router()
      assert.throws(function () { router.use('/', 42) }, /argument handler must be a function/)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.json.js

#### should 413 when over limit with Content-Length

```ts
it('should 413 when over limit with Content-Length', function (done) {
      var buf = Buffer.alloc(1024, '.')
      request(createApp({ limit: '1kb' }))
        .post('/')
        .set('Content-Type', 'application/json')
        .set('Content-Length', '1034')
        .send(JSON.stringify({ str: buf.toString() }))
        .expect(413, '[entity.too.large] request entity too large', done)
    }
```

#### should 413 when over limit with chunked encoding

```ts
it('should 413 when over limit with chunked encoding', function (done) {
      var app = createApp({ limit: '1kb' })
      var buf = Buffer.alloc(1024, '.')
      var test = request(app).post('/')
      test.set('Content-Type', 'application/json')
      test.set('Transfer-Encoding', 'chunked')
      test.write('{"str":')
      test.write('"' + buf.toString() + '"}')
      test.expect(413, done)
    }
```

#### should accept number of bytes

```ts
it('should accept number of bytes', function (done) {
      var buf = Buffer.alloc(1024, '.')
      request(createApp({ limit: 1024 }))
        .post('/')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ str: buf.toString() }))
        .expect(413, done)
    }
```

#### should not change when options altered

```ts
it('should not change when options altered', function (done) {
      var buf = Buffer.alloc(1024, '.')
      var options = { limit: '1kb' }
      var app = createApp(options)

      options.limit = '100kb'

      request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ str: buf.toString() }))
        .expect(413, done)
    }
```

#### should persist store when limit exceeded

```ts
it('should persist store when limit exceeded', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send('{"user":"' + Buffer.alloc(1024 * 100, '.').toString() + '"}')
        .expect(413)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

#### should 413 when inflated value exceeds limit

```ts
it('should 413 when inflated value exceeds limit', function (done) {
      // gzip'd data exceeds 1kb, but deflated below 1kb
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('1f8b080000000000000bedc1010d000000c2a0f74f6d0f071400000000000000', 'hex'))
      test.write(Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'))
      test.write(Buffer.from('0000000000000000004f0625b3b71650c30000', 'hex'))
      test.expect(413, done)
    })
  })
})

function createApp (options) {
  var app = express()

  app.use(express.json(options))

  app.use(function (err, req, res, next) {
    // console.log(err)
    res.status(err.status || 500)
    res.send(String(req.headers['x-error-property']
      ? err[req.headers['x-error-property']]
      : ('[' + err.type + '] ' + err.message)))
  })

  app.post('/', function (req, res) {
    res.json(req.body)
  })

  return app
}

function parseError (str) {
  try {
    JSON.parse(str); throw new SyntaxError('strict violation')
  } catch (e) {
    return e.message
  }
}

function shouldContainInBody (str) {
  return function (res) {
    assert.ok(res.text.indexOf(str) !== -1,
      'expected \'' + res.text + '\' to contain \'' + str + '\'')
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.router.js

#### should restore req.params after leaving router

```ts
it('should restore req.params after leaving router', function (done) {
    var app = express();
    var router = new express.Router();

    function handler1(req, res, next) {
      res.setHeader('x-user-id', String(req.params.id));
      next()
    }

    function handler2(req, res) {
      res.send(req.params.id);
    }

    router.use(function (req, res, next) {
      res.setHeader('x-router', String(req.params.id));
      next();
    });

    app.get('/user/:id', handler1, router, handler2);

    request(app)
      .get('/user/1')
      .expect('x-router', 'undefined')
      .expect('x-user-id', '1')
      .expect(200, '1', done);
  }
```

#### should reject numbers for app.' + method, function () {
        var app = express();
        assert.throws(app[method].bind(app, '/

```ts
it('should reject numbers for app.' + method, function () {
        var app = express();
        assert.throws(app[method].bind(app, '/', 3), /argument handler must be a function/);
      })
    });

    it('should re-route when method is altered', function (done) {
      var app = express();
      var cb = after(3, done);

      app.use(function (req, res, next) {
        if (req.method !== 'POST') return next();
        req.method = 'DELETE';
        res.setHeader('X-Method-Altered', '1');
        next();
      });

      app.delete('/', function (req, res) {
        res.end('deleted everything');
      });

      request(app)
        .get('/')
        .expect(404, cb)

      request(app)
        .delete('/')
        .expect(200, 'deleted everything', cb);

      request(app)
        .post('/')
        .expect('X-Method-Altered', '1')
        .expect(200, 'deleted everything', cb);
    }
```

#### should merge numeric indices req.params when parent has same number

```ts
it('should merge numeric indices req.params when parent has same number', function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get(/\/name:(\w+)/, function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(keys.map(function (k) { return [k, req.params[k]] }));
      });

      app.use(/\/user\/id:(\d+)/, router);

      request(app)
        .get('/user/id:10/name:tj')
        .expect(200, '[["0","10"],["1","tj"]]', done);
    }
```

