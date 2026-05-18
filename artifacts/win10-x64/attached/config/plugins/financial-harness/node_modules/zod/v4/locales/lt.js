import * as util from "../core/util.js";
export const parsedType = (data) => {
    const t = typeof data;
    return parsedTypeFromType(t, data);
};
const parsedTypeFromType = (t, data = undefined) => {
    switch (t) {
        case "number": {
            return Number.isNaN(data) ? "NaN" : "skaičius";
        }
        case "bigint": {
            return "sveikasis skaičius";
        }
        case "string": {
            return "eilutė";
        }
        case "boolean": {
            return "loginė reikšmė";
        }
        case "undefined":
        case "void": {
            return "neapibrėžta reikšmė";
        }
        case "function": {
            return "funkcija";
        }
        case "symbol": {
            return "simbolis";
        }
        case "object": {
            if (data === undefined)
                return "nežinomas objektas";
            if (data === null)
                return "nulinė reikšmė";
            if (Array.isArray(data))
                return "masyvas";
            if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
                return data.constructor.name;
            }
            return "objektas";
        }
        //Zod types below
        case "null": {
            return "nulinė reikšmė";
        }
    }
    return t;
};
const capitalizeFirstCharacter = (text) => {
    return text.charAt(0).toUpperCase() + text.slice(1);
};
function getUnitTypeFromNumber(number) {
    const abs = Math.abs(number);
    const last = abs % 10;
    const last2 = abs % 100;
    if ((last2 >= 11 && last2 <= 19) || last === 0)
        return "many";
    if (last === 1)
        return "one";
    return "few";
}
const error = () => {
    const Sizable = {
        string: {
            unit: {
                one: "simbolis",
                few: "simboliai",
                many: "simbolių",
            },
            verb: {
                smaller: {
                    inclusive: "turi būti ne ilgesnė kaip",
                    notInclusive: "turi būti trumpesnė kaip",
                },
                bigger: {
                    inclusive: "turi būti ne trumpesnė kaip",
                    notInclusive: "turi būti ilgesnė kaip",
                },
            },
        },
        file: {
            unit: {
                one: "baitas",
                few: "baitai",
                many: "baitų",
            },
            verb: {
                smaller: {
                    inclusive: "turi būti ne didesnis kaip",
                    notInclusive: "turi būti mažesnis kaip",
                },
                bigger: {
                    inclusive: "turi būti ne mažesnis kaip",
                    notInclusive: "turi būti didesnis kaip",
                },
            },
        },
        array: {
            unit: {
                one: "elementą",
                few: "elementus",
                many: "elementų",
            },
            verb: {
                smaller: {
                    inclusive: "turi turėti ne daugiau kaip",
                    notInclusive: "turi turėti mažiau kaip",
                },
                bigger: {
                    inclusive: "turi turėti ne mažiau kaip",
                    notInclusive: "turi turėti daugiau kaip",
                },
            },
        },
        set: {
            unit: {
                one: "elementą",
                few: "elementus",
                many: "elementų",
            },
            verb: {
                smaller: {
                    inclusive: "turi turėti ne daugiau kaip",
                    notInclusive: "turi turėti mažiau kaip",
                },
                bigger: {
                    inclusive: "turi turėti ne mažiau kaip",
                    notInclusive: "turi turėti daugiau kaip",
                },
            },
        },
    };
    function getSizing(origin, unitType, inclusive, targetShouldBe) {
        const result = Sizable[origin] ?? null;
        if (result === null)
            return result;
        return {
            unit: result.unit[unitType],
            verb: result.verb[targetShouldBe][inclusive ? "inclusive" : "notInclusive"],
        };
    }
    const Nouns = {
        regex: "įvestis",
        email: "el. pašto adresas",
        url: "URL",
        emoji: "jaustukas",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO data ir laikas",
        date: "ISO data",
        time: "ISO laikas",
        duration: "ISO trukmė",
        ipv4: "IPv4 adresas",
        ipv6: "IPv6 adresas",
        cidrv4: "IPv4 tinklo prefiksas (CIDR)",
        cidrv6: "IPv6 tinklo prefiksas (CIDR)",
        base64: "base64 užkoduota eilutė",
        base64url: "base64url užkoduota eilutė",
        json_string: "JSON eilutė",
        e164: "E.164 numeris",
        jwt: "JWT",
        template_literal: "įvestis",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type":
                return `Gautas tipas ${parsedType(issue.input)}, o tikėtasi - ${parsedTypeFromType(issue.expected)}`;
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Privalo būti ${util.stringifyPrimitive(issue.values[0])}`;
                return `Privalo būti vienas iš ${util.joinValues(issue.values, "|")} pasirinkimų`;
            case "too_big": {
                const origin = parsedTypeFromType(issue.origin);
                const sizing = getSizing(issue.origin, getUnitTypeFromNumber(Number(issue.maximum)), issue.inclusive ?? false, "smaller");
                if (sizing?.verb)
                    return `${capitalizeFirstCharacter(origin ?? issue.origin ?? "reikšmė")} ${sizing.verb} ${issue.maximum.toString()} ${sizing.unit ?? "elementų"}`;
                const adj = issue.inclusive ? "ne didesnis kaip" : "mažesnis kaip";
                return `${capitalizeFirstCharacter(origin ?? issue.origin ?? "reikšmė")} turi būti ${adj} ${issue.maximum.toString()} ${sizing?.unit}`;
            }
            case "too_small": {
                const origin = parsedTypeFromType(issue.origin);
                const sizing = getSizing(issue.origin, getUnitTypeFromNumber(Number(issue.minimum)), issue.inclusive ?? false, "bigger");
                if (sizing?.verb)
                    return `${capitalizeFirstCharacter(origin ?? issue.origin ?? "reikšmė")} ${sizing.verb} ${issue.minimum.toString()} ${sizing.unit ?? "elementų"}`;
                const adj = issue.inclusive ? "ne mažesnis kaip" : "didesnis kaip";
                return `${capitalizeFirstCharacter(origin ?? issue.origin ?? "reikšmė")} turi būti ${adj} ${issue.minimum.toString()} ${sizing?.unit}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Eilutė privalo prasidėti "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Eilutė privalo pasibaigti "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Eilutė privalo įtraukti "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Eilutė privalo atitikti ${_issue.pattern}`;
                return `Neteisingas ${Nouns[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Skaičius privalo būti ${issue.divisor} kartotinis.`;
            case "unrecognized_keys":
                return `Neatpažint${issue.keys.length > 1 ? "i" : "as"} rakt${issue.keys.length > 1 ? "ai" : "as"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return "Rastas klaidingas raktas";
            case "invalid_union":
                return "Klaidinga įvestis";
            case "invalid_element": {
                const origin = parsedTypeFromType(issue.origin);
                return `${capitalizeFirstCharacter(origin ?? issue.origin ?? "reikšmė")} turi klaidingą įvestį`;
            }
            default:
                return "Klaidinga įvestis";
        }
    };
};
export default function () {
    return {
        localeError: error(),
    };
}
