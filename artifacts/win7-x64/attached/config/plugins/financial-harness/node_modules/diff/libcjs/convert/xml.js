"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertChangesToXML = convertChangesToXML;
/**
 * converts a list of change objects to a serialized XML format
 */
function convertChangesToXML(changes) {
    var ret = [];
    for (var i = 0; i < changes.length; i++) {
        var change = changes[i];
        if (change.added) {
            ret.push('<ins>');
        }
        else if (change.removed) {
            ret.push('<del>');
        }
        ret.push(escapeHTML(change.value));
        if (change.added) {
            ret.push('</ins>');
        }
        else if (change.removed) {
            ret.push('</del>');
        }
    }
    return ret.join('');
}
function escapeHTML(s) {
    var n = s;
    n = n.replace(/&/g, '&amp;');
    n = n.replace(/</g, '&lt;');
    n = n.replace(/>/g, '&gt;');
    n = n.replace(/"/g, '&quot;');
    return n;
}
