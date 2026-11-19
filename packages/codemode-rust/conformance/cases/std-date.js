// Only time-zone-independent results: local forms are checked by round trip.
const out = []
const d = new Date(0)
out.push(d.toString(), d.toUTCString(), d.toGMTString(), d.toLocaleString(), d.toLocaleDateString(), d.toLocaleTimeString(), d.toISOString(), d.toJSON(), String(d), `${d}`, d + 1, d - 1, +d, d.valueOf(), d.getTime())
for (const s of ["2024-01-02", "2024-01-02T03:04:05.123+02:00", "+012024-01-02T00:00:00Z", "-000001-01-01T00:00:00Z", "2024", "2024-05", "2024-13-01", "2024-01-32", "Tue, 02 Jan 2024 03:04:05 GMT", "Tue Jan 02 2024 03:04:05 GMT+0100 (CET)", "garbage", "", "2024-01-02T03:04:05.1234567Z", "2024-01-02T03:04:05.1Z", "Thu, 01 Jan 1970 00:00:00 GMT+0130", "Mon, 25 Dec 1995 13:30:00 +0430", "12:00", "2024-01-02T24:00:00Z", "2024-01-02T24:00:01Z", "2024-02-30", "1970-01-01T00:00:00.000Z", "1995-12-17T03:24:00Z", "2024-01-02T03:04Z", "2024-01-02T03:04:05-0800", "Wed, 09 Aug 1995 00:00:00 UTC", "Sat, 01 Jun 2024 12:00:00 PDT"]) out.push([s, Date.parse(s)])
const local = (s) => { const t = new Date(s); return [t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()] }
for (const s of ["2024-01-02T03:04", "Jan 2, 2024", "2 January 2024 10:00", "2024/01/02", "01/02/2024", "1/2/2024 3:04 PM", "1/2/2024 12:30 AM", "2024-01-02 03:04:05", "June 5", "2024-1-2", "Jan 2024", "December 17, 1995 03:24:00", "Wed, 09 Aug 1995 00:00:00", "5", "Tuesday, March 5, 2024 18:30:15"]) out.push([s, local(s)])
out.push(new Date(-62198755200000).toUTCString(), new Date(-62198755200000).toISOString(), new Date(8.64e15).toISOString(), new Date(-8.64e15).toISOString(), new Date(-1).toISOString(), new Date(8.64e15 + 1).getTime())
out.push(new Date(Date.UTC(20, 0, 1)).toUTCString(), new Date(NaN).toUTCString(), new Date(NaN).toDateString(), new Date(NaN).toTimeString(), new Date(NaN).toLocaleString(), String(new Date(NaN)), new Date(NaN).toJSON(), new Date(NaN).getDay(), new Date(NaN).getTimezoneOffset())
out.push(new Date(Date.UTC(2024, 5, 15, 13, 5, 9)).toLocaleString(), new Date(Date.UTC(2024, 5, 15, 0, 5, 9)).toLocaleTimeString(), new Date(Date.UTC(-5, 5, 15)).toLocaleString(), new Date(Date.UTC(-5, 5, 15)).toUTCString())
const c = new Date(2024, 0, 31, 10, 20, 30, 400)
out.push([c.getFullYear(), c.getMonth(), c.getDate(), c.getDay(), c.getHours(), c.getMinutes(), c.getSeconds(), c.getMilliseconds()])
c.setMonth(1); out.push(local(c))
c.setDate(0); out.push(local(c))
c.setHours(25, 61, 61, 1001); out.push(local(c))
c.setFullYear(2000, 1, 29); out.push(local(c))
c.setMinutes(9); c.setSeconds(8); c.setMilliseconds(7); out.push(local(c))
const u = new Date(Date.UTC(2000, 0, 2, 3, 4, 5, 6))
out.push(u.setUTCMinutes(5), u.setUTCSeconds(1, 2), u.setUTCHours(3), u.setUTCDate(4), u.setUTCMonth(5, 6), u.setUTCFullYear(1999), u.setUTCMilliseconds(10), u.setTime("5"), u.setUTCHours(1, 2, 3, 4), u.setUTCDate(40), u.toISOString())
out.push([u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCDay(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), u.getUTCMilliseconds()])
const bad = new Date(NaN)
out.push(bad.setMonth(1), bad.setUTCDate(3), bad.getTime(), bad.setUTCFullYear(2020), bad.toISOString())
out.push(new Date(5).setUTCMonth(), new Date(5).setTime(), new Date(5).setUTCSeconds(undefined))
const order = []
const date = new Date(0)
date.setUTCMonth({ valueOf() { order.push("m"); return 1 } }, { valueOf() { order.push("d"); return 2 } })
out.push(order, date.toISOString())
out.push(Date.UTC(2024), Date.UTC(2024, 1), Date.UTC(99, 0), Date.UTC(), Date.UTC(NaN), Date.UTC(2024, 0, 1, 0, 0, 0, 0, 99), new Date(99, 0).getFullYear(), new Date(2024, 0).getMonth())
out.push(new Date(true).getTime(), new Date(null).getTime(), new Date(undefined).getTime(), new Date([]).getTime(), new Date(["1970-01-01T00:00:00.000Z"]).getTime(), new Date({}).getTime(), new Date(new Date(5)).getTime(), new Date({ valueOf() { return 7 } }).getTime(), new Date(1.9).getTime(), new Date(-1.9).getTime())
out.push(typeof Date(), Date().length, typeof Date.now(), new Date(0) instanceof Date, Object.prototype.toString.call(new Date(0)), JSON.stringify({ d: new Date(0), n: new Date(NaN) }), new Date(0) == "1970-01-01T00:00:00.000Z", new Date(5) == 5, new Date(1) < new Date(2), new Date(3000) - new Date(1000), Date.length, Date.name)
try { new Date(NaN).toISOString() } catch (e) { out.push(e.name, e.message) }
try { Date.prototype.getTime.call({}) } catch (e) { out.push(e.name, e.message) }
try { Date.prototype.toISOString.call(5) } catch (e) { out.push(e.name, e.message) }
console.log(new Date(0), [new Date(0)], { d: new Date(NaN) })
out.push(new Date(0), [new Date(1000)], [new Date(3000), new Date(1000)].sort((a, b) => a - b).map(Number))
return out
