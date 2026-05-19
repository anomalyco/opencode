(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(factory((global.awaitToJs = {})));
}(this, (function (exports) { 'use strict';

/**
 * @param { Promise } promise
 * @param { Object= } errorExt - Additional Information you can pass to the err object
 * @return { Promise }
 */
function to(promise, errorExt) {
    return promise
        .then(function (data) { return [null, data]; })
        .catch(function (err) {
        if (errorExt) {
            Object.assign(err, errorExt);
        }
        return [err, undefined];
    });
}

exports.to = to;
exports['default'] = to;

Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=await-to-js.umd.js.map
