(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.AnyBase = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

/**
 * Converter
 *
 * @param {string} srcAlphabet
 * @param {string} dstAlphabet
 * @constructor
 */
function Converter(srcAlphabet, dstAlphabet) {
    if (!srcAlphabet || !dstAlphabet || !srcAlphabet.length || !dstAlphabet.length) {
        throw new Error('Bad alphabet');
    }
    this.srcAlphabet = srcAlphabet;
    this.dstAlphabet = dstAlphabet;
}

/**
 * Convert number from source alphabet to destonation alphabet
 *
 * @param {string} number - number represent as a string
 *
 * @returns {string}
 */
Converter.prototype.convert = function(number) {
    var i, divide, newlen,
    numberMap = {},
    fromBase = this.srcAlphabet.length,
    toBase = this.dstAlphabet.length,
    length = number.length,
    result = '';

    if (this.srcAlphabet === this.dstAlphabet) {
        return number;
    }

    for (i = 0; i < length; i++) {
        numberMap[i] = this.srcAlphabet.indexOf(number[i]);
    }
    do {
        divide = 0;
        newlen = 0;
        for (i = 0; i < length; i++) {
            divide = divide * fromBase + numberMap[i];
            if (divide >= toBase) {
                numberMap[newlen++] = parseInt(divide / toBase, 10);
                divide = divide % toBase;
            } else if (newlen > 0) {
                numberMap[newlen++] = 0;
            }
        }
        length = newlen;
        result = this.dstAlphabet[divide] + result;
    } while (newlen != 0);

    return result;
}

module.exports = Converter;
},{}],2:[function(require,module,exports){
var Converter = require('./src/converter');

/**
 * Function get source and destination alphabet and return convert function
 *
 * @param {string} srcAlphabet
 * @param {string} dstAlphabet
 *
 * @returns {function(number)}
 */
function anyBase(srcAlphabet, dstAlphabet) {
    var converter = new Converter(srcAlphabet, dstAlphabet);
    /**
     * Convert function
     *
     * @param {string} number
     *
     * @return {string} number
     */
    return function (number) {
        return converter.convert(number);
    }
};

anyBase.BIN = '01';
anyBase.OCT = '01234567';
anyBase.DEC = '0123456789';
anyBase.HEX = '0123456789abcdef';

module.exports = anyBase;
},{"./src/converter":1}]},{},[2])(2)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvY29udmVydGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XG5cbi8qKlxuICogQ29udmVydGVyXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHNyY0FscGhhYmV0XG4gKiBAcGFyYW0ge3N0cmluZ30gZHN0QWxwaGFiZXRcbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBDb252ZXJ0ZXIoc3JjQWxwaGFiZXQsIGRzdEFscGhhYmV0KSB7XG4gICAgaWYgKCFzcmNBbHBoYWJldCB8fCAhZHN0QWxwaGFiZXQgfHwgIXNyY0FscGhhYmV0Lmxlbmd0aCB8fCAhZHN0QWxwaGFiZXQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCYWQgYWxwaGFiZXQnKTtcbiAgICB9XG4gICAgdGhpcy5zcmNBbHBoYWJldCA9IHNyY0FscGhhYmV0O1xuICAgIHRoaXMuZHN0QWxwaGFiZXQgPSBkc3RBbHBoYWJldDtcbn1cblxuLyoqXG4gKiBDb252ZXJ0IG51bWJlciBmcm9tIHNvdXJjZSBhbHBoYWJldCB0byBkZXN0b25hdGlvbiBhbHBoYWJldFxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBudW1iZXIgLSBudW1iZXIgcmVwcmVzZW50IGFzIGEgc3RyaW5nXG4gKlxuICogQHJldHVybnMge3N0cmluZ31cbiAqL1xuQ29udmVydGVyLnByb3RvdHlwZS5jb252ZXJ0ID0gZnVuY3Rpb24obnVtYmVyKSB7XG4gICAgdmFyIGksIGRpdmlkZSwgbmV3bGVuLFxuICAgIG51bWJlck1hcCA9IHt9LFxuICAgIGZyb21CYXNlID0gdGhpcy5zcmNBbHBoYWJldC5sZW5ndGgsXG4gICAgdG9CYXNlID0gdGhpcy5kc3RBbHBoYWJldC5sZW5ndGgsXG4gICAgbGVuZ3RoID0gbnVtYmVyLmxlbmd0aCxcbiAgICByZXN1bHQgPSAnJztcblxuICAgIGlmICh0aGlzLnNyY0FscGhhYmV0ID09PSB0aGlzLmRzdEFscGhhYmV0KSB7XG4gICAgICAgIHJldHVybiBudW1iZXI7XG4gICAgfVxuXG4gICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIG51bWJlck1hcFtpXSA9IHRoaXMuc3JjQWxwaGFiZXQuaW5kZXhPZihudW1iZXJbaV0pO1xuICAgIH1cbiAgICBkbyB7XG4gICAgICAgIGRpdmlkZSA9IDA7XG4gICAgICAgIG5ld2xlbiA9IDA7XG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgZGl2aWRlID0gZGl2aWRlICogZnJvbUJhc2UgKyBudW1iZXJNYXBbaV07XG4gICAgICAgICAgICBpZiAoZGl2aWRlID49IHRvQmFzZSkge1xuICAgICAgICAgICAgICAgIG51bWJlck1hcFtuZXdsZW4rK10gPSBwYXJzZUludChkaXZpZGUgLyB0b0Jhc2UsIDEwKTtcbiAgICAgICAgICAgICAgICBkaXZpZGUgPSBkaXZpZGUgJSB0b0Jhc2U7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKG5ld2xlbiA+IDApIHtcbiAgICAgICAgICAgICAgICBudW1iZXJNYXBbbmV3bGVuKytdID0gMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBsZW5ndGggPSBuZXdsZW47XG4gICAgICAgIHJlc3VsdCA9IHRoaXMuZHN0QWxwaGFiZXRbZGl2aWRlXSArIHJlc3VsdDtcbiAgICB9IHdoaWxlIChuZXdsZW4gIT0gMCk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IENvbnZlcnRlcjsiXX0=
