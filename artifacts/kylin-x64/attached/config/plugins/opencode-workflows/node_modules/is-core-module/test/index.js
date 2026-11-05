'use strict';

var test = require('tape');
var keys = require('object-keys');
var semver = require('semver');
var mockProperty = require('mock-property');

var isCore = require('../');
var data = require('../core.json');

var supportsNodePrefix = semver.satisfies(process.versions.node, '^14.18 || >= 16', { includePrerelease: true });

test('core modules', function (t) {
	t.test('isCore()', function (st) {
		st.ok(isCore('fs'));
		st.ok(isCore('net'));
		st.ok(isCore('http'));

		st.ok(!isCore('seq'));
		st.ok(!isCore('../'));

		st.ok(!isCore('toString'));

		st.end();
	});

	t.test('core list', function (st) {
		var cores = keys(data);
		st.plan(cores.length);

		for (var i = 0; i < cores.length; ++i) {
			var mod = cores[i];
			var requireFunc = function () { require(mod); }; // eslint-disable-line no-loop-func
			if (isCore(mod)) {
				st.doesNotThrow(requireFunc, mod + ' supported; requiring does not throw');
			} else {
				st['throws'](requireFunc, mod + ' not supported; requiring throws');
			}
		}

		st.end();
	});

	t.test('core via repl module', { skip: !data.repl }, function (st) {
		var libs = require('repl')._builtinLibs; // eslint-disable-line no-underscore-dangle
		if (!libs) {
			st.skip('repl._builtinLibs does not exist');
		} else {
			for (var i = 0; i < libs.length; ++i) {
				var mod = libs[i];
				st.ok(data[mod], mod + ' is a core module');
				st.doesNotThrow(
					function () { require(mod); }, // eslint-disable-line no-loop-func
					'requiring ' + mod + ' does not throw'
				);
				if (mod.slice(0, 5) !== 'node:') {
					if (supportsNodePrefix) {
						st.doesNotThrow(
							function () { require('node:' + mod); }, // eslint-disable-line no-loop-func
							'requiring node:' + mod + ' does not throw'
						);
					} else {
						st['throws'](
							function () { require('node:' + mod); }, // eslint-disable-line no-loop-func
							'requiring node:' + mod + ' throws'
						);
					}
				}
			}
		}
		st.end();
	});

	t.test('core via builtinModules list', { skip: !data.module }, function (st) {
		var Module = require('module');
		var libs = Module.builtinModules;
		if (!libs) {
			st.skip('module.builtinModules does not exist');
		} else {
			var excludeList = [
				'_debug_agent',
				'v8/tools/tickprocessor-driver',
				'v8/tools/SourceMap',
				'v8/tools/tickprocessor',
				'v8/tools/profile'
			];

			// see https://github.com/nodejs/node/issues/42785
			if (semver.satisfies(process.version, '>= 18')) {
				libs = libs.concat('node:test');
			}
			if (semver.satisfies(process.version, '^20.12 || >= 21.7')) {
				libs = libs.concat('node:sea');
			}
			if (semver.satisfies(process.version, '>= 23.4')) {
				libs = libs.concat('node:sqlite');
			}

			for (var i = 0; i < libs.length; ++i) {
				var mod = libs[i];
				if (excludeList.indexOf(mod) === -1) {
					st.ok(data[mod], mod + ' is a core module');

					if (Module.isBuiltin) {
						st.ok(Module.isBuiltin(mod), 'module.isBuiltin(' + mod + ') is true');
					}

					st.doesNotThrow(
						function () { require(mod); }, // eslint-disable-line no-loop-func
						'requiring ' + mod + ' does not throw'
					);

					if (process.getBuiltinModule) {
						st.equal(
							process.getBuiltinModule(mod),
							require(mod),
							'process.getBuiltinModule(' + mod + ') === require(' + mod + ')'
						);
					}

					if (mod.slice(0, 5) !== 'node:') {
						if (supportsNodePrefix) {
							st.doesNotThrow(
								function () { require('node:' + mod); }, // eslint-disable-line no-loop-func
								'requiring node:' + mod + ' does not throw'
							);
						} else {
							st['throws'](
								function () { require('node:' + mod); }, // eslint-disable-line no-loop-func
								'requiring node:' + mod + ' throws'
							);
						}
					}
				}
			}
		}

		st.end();
	});

	t.test('isCore with explicit nodeVersion', function (st) {
		st.ok(isCore('async_hooks', '8.0.0'), 'async_hooks is core in 8.0.0 (exact match on >= specifier)');
		st.ok(isCore('buffer_ieee754', '0.5.0'), 'buffer_ieee754 is core in 0.5.0');
		st.ok(!isCore('buffer_ieee754', '0.9.7'), 'buffer_ieee754 is not core in 0.9.7');
		st.ok(!isCore('buffer_ieee754', '1.0.0'), 'buffer_ieee754 is not core in 1.0.0');
		st.ok(isCore('buffer_ieee754', '0.8.0'), 'buffer_ieee754 is core in 0.8.0');

		st['throws'](
			function () { isCore('async_hooks', null); },
			TypeError,
			'isCore with non-string non-undefined nodeVersion throws TypeError'
		);
		st['throws'](
			function () { isCore('async_hooks', 123); },
			TypeError,
			'isCore with numeric nodeVersion throws TypeError'
		);

		st.end();
	});

	t.test('isCore with non-boolean specifier and invalid nodeVersion', function (st) {
		st['throws'](
			function () { isCore('async_hooks', null); },
			TypeError,
			'isCore with null nodeVersion on non-boolean module throws TypeError'
		);
		st['throws'](
			function () { isCore('async_hooks', 123); },
			TypeError,
			'isCore with numeric nodeVersion on non-boolean module throws TypeError'
		);

		st.end();
	});

	t.test('isCore with undefined nodeVersion and non-string process.versions.node', function (st) {
		st.teardown(mockProperty(process, 'versions', { value: { node: null } }));

		st['throws'](
			function () { isCore('async_hooks'); },
			TypeError,
			'isCore throws when process.versions.node is not a string'
		);

		st.end();
	});

	t.test('isCore with undefined nodeVersion and falsy process.versions', function (st) {
		st.teardown(mockProperty(process, 'versions', { value: null }));

		st['throws'](
			function () { isCore('async_hooks'); },
			TypeError,
			'isCore throws when process.versions is falsy'
		);

		st.end();
	});

	t.test('specifierIncluded with = operator (bare version)', function (st) {
		var testKey = '__test_equal_op';
		data[testKey] = '14.18';
		st.teardown(function () { delete data[testKey]; });

		st.ok(!isCore(testKey, '14.17.0'), 'returns false when minor version does not match with = op');
		st.ok(!isCore(testKey, '15.0.0'), 'returns false when major version does not match with = op');
		st.ok(!isCore(testKey, '14.18.0'), 'returns false for exact match with = op (= is not >=)');

		st.end();
	});

	t.test('isCore with short version strings', function (st) {
		st.ok(isCore('async_hooks', '8'), 'async_hooks is core with single-part version "8"');
		st.ok(!isCore('async_hooks', '7'), 'async_hooks is not core with single-part version "7"');
		st.ok(isCore('cluster', '0.5'), 'cluster is core with two-part version "0.5"');

		st.end();
	});

	t.test('matchesRange with empty specifiers array', function (st) {
		var testKey = '__test_empty_split';
		var testRange = '__test_range__';
		data[testKey] = testRange;
		st.teardown(function () { delete data[testKey]; });

		var origSplit = String.prototype.split;
		st.teardown(mockProperty(String.prototype, 'split', {
			value: function () {
				if (String(this) === testRange) {
					return [];
				}
				return origSplit.apply(this, arguments);
			}
		}));

		st.ok(!isCore(testKey, '8.0.0'), 'returns false when specifiers array is empty');

		st.end();
	});

	t.test('Object.prototype pollution', function (st) {
		var nonKey = 'not a core module';
		st.teardown(mockProperty(Object.prototype, 'fs', { value: false }));
		st.teardown(mockProperty(Object.prototype, 'path', { value: '>= 999999999' }));
		st.teardown(mockProperty(Object.prototype, 'http', { value: data.http }));
		st.teardown(mockProperty(Object.prototype, nonKey, { value: true }));

		st.equal(isCore('fs'), true, 'fs is a core module even if Object.prototype lies');
		st.equal(isCore('path'), true, 'path is a core module even if Object.prototype lies');
		st.equal(isCore('http'), true, 'path is a core module even if Object.prototype matches data');
		st.equal(isCore(nonKey), false, '"' + nonKey + '" is not a core module even if Object.prototype lies');

		st.end();
	});

	t.end();
});
