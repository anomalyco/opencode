/**
 * converts a list of change objects to a serialized XML format
 */
export function convertChangesToXML(changes) {
    const ret = [];
    for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
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
    let n = s;
    n = n.replace(/&/g, '&amp;');
    n = n.replace(/</g, '&lt;');
    n = n.replace(/>/g, '&gt;');
    n = n.replace(/"/g, '&quot;');
    return n;
}
