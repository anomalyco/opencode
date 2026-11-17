const out = []
out.push(await (async () => {

        const create = () => new Date(Date.UTC(2000, 0, 2, 3, 4, 5, 6))
        const result = []
        let date = create()
        result.push([date.setTime(1234) === date.getTime(), date.getTime()])
        date = create()
        result.push([date.setUTCMilliseconds(10) === date.getTime(), date.getUTCMilliseconds()])
        date = create()
        result.push([date.setUTCSeconds(10, 11) === date.getTime(), date.getUTCSeconds(), date.getUTCMilliseconds()])
        date = create()
        result.push([date.setUTCMinutes(10, 11, 12) === date.getTime(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()])
        date = create()
        result.push([date.setUTCHours(10, 11, 12, 13) === date.getTime(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()])
        date = create()
        result.push([date.setUTCDate(10) === date.getTime(), date.getUTCDate()])
        date = create()
        result.push([date.setUTCMonth(6, 10) === date.getTime(), date.getUTCMonth(), date.getUTCDate()])
        date = create()
        result.push([date.setUTCFullYear(2020, 6, 10) === date.getTime(), date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()])
        return result
      
})().then((v) => [0, v], (e) => [0, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const create = () => new Date(2000, 0, 2, 3, 4, 5, 6)
        const result = []
        let date = create()
        date.setMilliseconds(10)
        result.push(date.getMilliseconds())
        date = create()
        date.setSeconds(10, 11)
        result.push([date.getSeconds(), date.getMilliseconds()])
        date = create()
        date.setMinutes(10, 11, 12)
        result.push([date.getMinutes(), date.getSeconds(), date.getMilliseconds()])
        date = create()
        date.setHours(10, 11, 12, 13)
        result.push([date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()])
        date = create()
        date.setDate(10)
        result.push(date.getDate())
        date = create()
        date.setMonth(6, 10)
        result.push([date.getMonth(), date.getDate()])
        date = create()
        date.setFullYear(2020, 6, 10)
        result.push([date.getFullYear(), date.getMonth(), date.getDate()])
        return result
      
})().then((v) => [1, v], (e) => [1, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const calls = []
        const date = new Date(0)
        const returned = date.setUTCSeconds(
          { valueOf: () => { calls.push("seconds"); return "2" } },
          { valueOf: () => { calls.push("milliseconds"); return true } },
        )
        const fallback = new Date(0)
        fallback.setTime({ valueOf: () => ({}), toString: () => "3" })
        return [returned === date.getTime(), date.getUTCSeconds(), date.getUTCMilliseconds(), fallback.getTime(), calls]
      
})().then((v) => [2, v], (e) => [2, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const date = new Date(Date.UTC(2000, 5, 15, 1, 2, 3, 4))
        date.setUTCFullYear({
          valueOf: () => {
            date.setTime(Date.UTC(2020, 11, 20))
            return 2001
          },
        })

        const invalid = new Date(NaN)
        invalid.setUTCFullYear({ valueOf: () => { invalid.setTime(0); return 1 } })

        const effects = []
        const staysInvalid = new Date(NaN)
        const result = staysInvalid.setUTCMonth(
          { valueOf: () => { effects.push("month"); return 0 } },
          { valueOf: () => { effects.push("date"); return 1 } },
        )
        return [
          date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
          invalid.getUTCFullYear(), invalid.getUTCMonth(), invalid.getUTCDate(),
          Number.isNaN(result), Number.isNaN(staysInvalid.getTime()), effects,
        ]
      
})().then((v) => [3, v], (e) => [3, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const year = new Date(NaN)
        const yearResult = year.setFullYear(2016)
        const month = new Date(NaN)
        const monthResult = month.setFullYear(2016, 6)
        const day = new Date(NaN)
        const dayResult = day.setFullYear(2016, 6, 7)
        return [
          yearResult === year.getTime(), year.getFullYear(), year.getMonth(), year.getDate(),
          monthResult === month.getTime(), month.getFullYear(), month.getMonth(), month.getDate(),
          dayResult === day.getTime(), day.getFullYear(), day.getMonth(), day.getDate(),
        ]
      
})().then((v) => [4, v], (e) => [4, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const calls = []
        const failure = { valueOf: () => { throw new Error("stop") } }
        const counter = { valueOf: () => { calls.push("counter"); return 1 } }
        const results = []

        const time = new Date(0)
        try { time.setTime(failure) } catch (error) { results.push(error.message) }
        results.push(time.getTime())

        const year = new Date(0)
        try { year.setFullYear(failure, counter, counter) } catch (error) { results.push(error.message) }
        results.push(year.getTime())

        const month = new Date(0)
        try { month.setFullYear(0, failure, counter) } catch (error) { results.push(error.message) }
        results.push(month.getTime())

        const day = new Date(0)
        try { day.setFullYear(0, 0, failure) } catch (error) { results.push(error.message) }
        results.push(day.getTime(), calls)
        return results
      
})().then((v) => [5, v], (e) => [5, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const calls = []
        const omittedOptional = new Date(0)
        const explicitUndefined = new Date(0)
        const noArgument = new Date(0)
        const extra = new Date(0)
        const clipped = new Date(0)
        const badPrimitive = new Date(0)
        let conversionError = ""
        try {
          badPrimitive.setTime({ valueOf: () => ({}), toString: () => ({}) })
        } catch (error) {
          conversionError = error.name
        }
        return [
          omittedOptional.setUTCSeconds(1),
          Number.isNaN(explicitUndefined.setUTCSeconds(1, undefined)),
          Number.isNaN(noArgument.setTime()),
          extra.setTime(1, { valueOf: () => { calls.push("extra"); return 2 } }),
          calls,
          Number.isNaN(clipped.setTime(8.64e15 + 1)),
          Number.isNaN(clipped.getTime()),
          conversionError,
        ]
      
})().then((v) => [6, v], (e) => [6, "threw", e?.name, e?.message]))
out.push(await (async () => {

        const date = new Date(0)
        const text = String(date)
        return [
          date + date === text + text,
          date + 0 === text + "0",
          date + true === text + "true",
          date == text,
          text == date,
          date == Number(date),
          Number(date) == date,
          date != Number(date),
          date == date,
          date == new Date(0),
          date == null,
        ]
      
})().then((v) => [7, v], (e) => [7, "threw", e?.name, e?.message]))
return out
