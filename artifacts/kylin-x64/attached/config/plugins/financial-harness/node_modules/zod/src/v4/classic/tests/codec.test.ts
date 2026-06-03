import { expect, expectTypeOf, test } from "vitest";
import * as z from "zod/v4";

const isoDateCodec = z.codec(
  z.iso.datetime(), // Input: ISO string (validates to string)
  z.date(), // Output: Date object
  {
    decode: (isoString) => new Date(isoString), // Forward: ISO string → Date
    encode: (date) => date.toISOString(), // Backward: Date → ISO string
  }
);

test("instanceof", () => {
  expect(isoDateCodec instanceof z.ZodCodec).toBe(true);
  expect(isoDateCodec instanceof z.ZodPipe).toBe(true);
  expect(isoDateCodec instanceof z.ZodType).toBe(true);
  expect(isoDateCodec instanceof z.core.$ZodCodec).toBe(true);
  expect(isoDateCodec instanceof z.core.$ZodPipe).toBe(true);
  expect(isoDateCodec instanceof z.core.$ZodType).toBe(true);

  expectTypeOf(isoDateCodec.def).toEqualTypeOf<z.core.$ZodCodecDef<z.ZodISODateTime, z.ZodDate>>();
});

test("codec basic functionality", () => {
  // ISO string -> Date codec using z.iso.datetime() for input validation

  const testIsoString = "2024-01-15T10:30:00.000Z";
  const testDate = new Date("2024-01-15T10:30:00.000Z");

  // Forward decoding (ISO string -> Date)
  const decodedResult = z.decode(isoDateCodec, testIsoString);
  expect(decodedResult).toBeInstanceOf(Date);
  expect(decodedResult.toISOString()).toMatchInlineSnapshot(`"2024-01-15T10:30:00.000Z"`);

  // Backward encoding (Date -> ISO string)
  const encodedResult = z.encode(isoDateCodec, testDate);
  expect(typeof encodedResult).toBe("string");
  expect(encodedResult).toMatchInlineSnapshot(`"2024-01-15T10:30:00.000Z"`);
});

test("codec round trip", () => {
  const isoDateCodec = z.codec(z.iso.datetime(), z.date(), {
    decode: (isoString) => new Date(isoString),
    encode: (date) => date.toISOString(),
  });

  const original = "2024-12-25T15:45:30.123Z";
  const toDate = z.decode(isoDateCodec, original);
  const backToString = z.encode(isoDateCodec, toDate);

  expect(backToString).toMatchInlineSnapshot(`"2024-12-25T15:45:30.123Z"`);
  expect(toDate).toBeInstanceOf(Date);
  expect(toDate.getTime()).toMatchInlineSnapshot(`1735141530123`);
});

test("codec with refinement", () => {
  const isoDateCodec = z
    .codec(z.iso.datetime(), z.date(), {
      decode: (isoString) => new Date(isoString),
      encode: (date) => date.toISOString(),
    })
    .refine((val) => val.getFullYear() === 2024, { error: "Year must be 2024" });

  // Valid 2024 date
  const validDate = z.decode(isoDateCodec, "2024-01-15T10:30:00.000Z");
  expect(validDate.getFullYear()).toMatchInlineSnapshot(`2024`);
  expect(validDate.getTime()).toMatchInlineSnapshot(`1705314600000`);

  // Invalid year should fail safely
  const invalidYearResult = z.safeDecode(isoDateCodec, "2023-01-15T10:30:00.000Z");
  expect(invalidYearResult.success).toBe(false);
  if (!invalidYearResult.success) {
    expect(invalidYearResult.error.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "custom",
          "message": "Year must be 2024",
          "path": [],
        },
      ]
    `);
  }
});

test("safe codec operations", () => {
  const isoDateCodec = z.codec(z.iso.datetime(), z.date(), {
    decode: (isoString) => new Date(isoString),
    encode: (date) => date.toISOString(),
  });

  // Safe decode with invalid input
  const safeDecodeResult = z.safeDecode(isoDateCodec, "invalid-date");
  expect(safeDecodeResult.success).toBe(false);
  if (!safeDecodeResult.success) {
    expect(safeDecodeResult.error.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "invalid_format",
          "format": "datetime",
          "message": "Invalid ISO datetime",
          "origin": "string",
          "path": [],
          "pattern": "/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$/",
        },
      ]
    `);
  }

  // Safe decode with valid input
  const safeDecodeValid = z.safeDecode(isoDateCodec, "2024-01-15T10:30:00.000Z");
  expect(safeDecodeValid.success).toBe(true);
  if (safeDecodeValid.success) {
    expect(safeDecodeValid.data).toBeInstanceOf(Date);
    expect(safeDecodeValid.data.getTime()).toMatchInlineSnapshot(`1705314600000`);
  }

  // Safe encode with valid input
  const safeEncodeResult = z.safeEncode(isoDateCodec, new Date("2024-01-01"));
  expect(safeEncodeResult.success).toBe(true);
  if (safeEncodeResult.success) {
    expect(safeEncodeResult.data).toMatchInlineSnapshot(`"2024-01-01T00:00:00.000Z"`);
  }
});

test("codec with different types", () => {
  // String -> Number codec
  const stringNumberCodec = z.codec(z.string(), z.number(), {
    decode: (str) => Number.parseFloat(str),
    encode: (num) => num.toString(),
  });

  const decodedNumber = z.decode(stringNumberCodec, "42.5");
  expect(decodedNumber).toMatchInlineSnapshot(`42.5`);
  expect(typeof decodedNumber).toBe("number");

  const encodedString = z.encode(stringNumberCodec, 42.5);
  expect(encodedString).toMatchInlineSnapshot(`"42.5"`);
  expect(typeof encodedString).toBe("string");
});

test("async codec operations", async () => {
  const isoDateCodec = z.codec(z.iso.datetime(), z.date(), {
    decode: (isoString) => new Date(isoString),
    encode: (date) => date.toISOString(),
  });

  // Async decode
  const decodedResult = await z.decodeAsync(isoDateCodec, "2024-01-15T10:30:00.000Z");
  expect(decodedResult).toBeInstanceOf(Date);
  expect(decodedResult.getTime()).toMatchInlineSnapshot(`1705314600000`);

  // Async encode
  const encodedResult = await z.encodeAsync(isoDateCodec, new Date("2024-01-15T10:30:00.000Z"));
  expect(typeof encodedResult).toBe("string");
  expect(encodedResult).toMatchInlineSnapshot(`"2024-01-15T10:30:00.000Z"`);

  // Safe async operations
  const safeDecodeResult = await z.safeDecodeAsync(isoDateCodec, "2024-01-15T10:30:00.000Z");
  expect(safeDecodeResult.success).toBe(true);
  if (safeDecodeResult.success) {
    expect(safeDecodeResult.data.getTime()).toMatchInlineSnapshot(`1705314600000`);
  }

  const safeEncodeResult = await z.safeEncodeAsync(isoDateCodec, new Date("2024-01-15T10:30:00.000Z"));
  expect(safeEncodeResult.success).toBe(true);
  if (safeEncodeResult.success) {
    expect(safeEncodeResult.data).toMatchInlineSnapshot(`"2024-01-15T10:30:00.000Z"`);
  }
});

test("codec type inference", () => {
  const codec = z.codec(z.string(), z.number(), {
    decode: (str) => Number.parseInt(str),
    encode: (num) => num.toString(),
  });

  // These should compile without type errors
  const decoded: number = z.decode(codec, "123");
  const encoded: string = z.encode(codec, 123);

  expect(decoded).toMatchInlineSnapshot(`123`);
  expect(encoded).toMatchInlineSnapshot(`"123"`);
});

test("nested codec with object containing codec property", () => {
  // Nested schema: object containing a codec as one of its properties, with refinements at all levels
  const waypointSchema = z
    .object({
      name: z.string().min(1, "Waypoint name required"),
      difficulty: z.enum(["easy", "medium", "hard"]),
      coordinate: z
        .codec(
          z
            .string()
            .regex(/^-?\d+,-?\d+$/, "Must be 'x,y' format"), // Input: coordinate string
          z
            .object({ x: z.number(), y: z.number() })
            .refine((coord) => coord.x >= 0 && coord.y >= 0, { error: "Coordinates must be non-negative" }), // Output: coordinate object
          {
            decode: (coordString: string) => {
              const [x, y] = coordString.split(",").map(Number);
              return { x, y };
            },
            encode: (coord: { x: number; y: number }) => `${coord.x},${coord.y}`,
          }
        )
        .refine((coord) => coord.x <= 1000 && coord.y <= 1000, { error: "Coordinates must be within bounds" }),
    })
    .refine((waypoint) => waypoint.difficulty !== "hard" || waypoint.coordinate.x >= 100, {
      error: "Hard waypoints must be at least 100 units from origin",
    });

  // Test data
  const inputWaypoint = {
    name: "Summit Point",
    difficulty: "medium" as const,
    coordinate: "150,200",
  };

  // Forward decoding (object with string coordinate -> object with coordinate object)
  const decodedWaypoint = z.decode(waypointSchema, inputWaypoint);
  expect(decodedWaypoint).toMatchInlineSnapshot(`
    {
      "coordinate": {
        "x": 150,
        "y": 200,
      },
      "difficulty": "medium",
      "name": "Summit Point",
    }
  `);

  // Backward encoding (object with coordinate object -> object with string coordinate)
  const encodedWaypoint = z.encode(waypointSchema, decodedWaypoint);
  expect(encodedWaypoint).toMatchInlineSnapshot(`
    {
      "coordinate": "150,200",
      "difficulty": "medium",
      "name": "Summit Point",
    }
  `);

  // Test refinements at all levels
  // String validation (empty waypoint name)
  const emptyNameResult = z.safeDecode(waypointSchema, {
    name: "",
    difficulty: "easy",
    coordinate: "10,20",
  });
  expect(emptyNameResult.success).toBe(false);
  if (!emptyNameResult.success) {
    expect(emptyNameResult.error.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "too_small",
          "inclusive": true,
          "message": "Waypoint name required",
          "minimum": 1,
          "origin": "string",
          "path": [
            "name",
          ],
        },
      ]
    `);
  }

  // Enum validation (invalid difficulty)
  const invalidDifficultyResult = z.safeDecode(waypointSchema, {
    name: "Test Point",
    difficulty: "impossible" as any,
    coordinate: "10,20",
  });
  expect(invalidDifficultyResult.success).toBe(false);
  if (!invalidDifficultyResult.success) {
    expect(invalidDifficultyResult.error.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "invalid_value",
          "message": "Invalid option: expected one of "easy"|"medium"|"hard"",
          "path": [
            "difficulty",
          ],
          "values": [
            "easy",
            "medium",
            "hard",
          ],
        },
      ]
    `);
  }

  // Codec string format validation (invalid coordinate format)
  const invalidFormatResult = z.safeDecode(waypointSchema, {
    name: "Test Point",
    difficulty: "easy",
    coordinate: "invalid",
  });
  expect(invalidFormatResult.success).toBe(false);
  if (!invalidFormatResult.success) {
    expect(invalidFormatResult.error.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "invalid_format",
          "format": "regex",
          "message": "Must be 'x,y' format",
          "origin": "string",
          "path": [
            "coordinate",
          ],
          "pattern": "/^-?\\d+,-?\\d+$/",
        },
      ]
    `);
  }

  // Codec object refinement (negative coordinates)
  const negativeCoordResult = z.safeDecode(waypointSchema, {
    name: "Test Point",
    difficulty: "easy",
    coordinate: "-5,10",
  });
  expect(negativeCoordResult.success).toBe(false);
  if (!negativeCoordResult.success) {
    expect(negativeCoordResult.error.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "custom",
          "message": "Coordinates must be non-negative",
          "path": [
            "coordinate",
          ],
        },
      ]
    `);
  }

  // Codec-level refinement (coordinates out of bounds)
  const outOfBoundsResult = z.safeDecode(waypointSchema, {
    name: "Test Point",
    difficulty: "easy",
    coordinate: "1500,2000",
  });
  expect(outOfBoundsResult.success).toBe(false);
  if (!outOfBoundsResult.success) {
    expect(outOfBoundsResult.error.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "custom",
          "message": "Coordinates must be within bounds",
          "path": [
            "coordinate",
          ],
        },
      ]
    `);
  }

  // Object-level refinement (hard waypoint too close to origin)
  const hardWaypointResult = z.safeDecode(waypointSchema, {
    name: "Expert Point",
    difficulty: "hard",
    coordinate: "50,60", // x < 100, but hard waypoints need x >= 100
  });
  expect(hardWaypointResult.success).toBe(false);
  if (!hardWaypointResult.success) {
    expect(hardWaypointResult.error.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "custom",
          "message": "Hard waypoints must be at least 100 units from origin",
          "path": [],
        },
      ]
    `);
  }

  // Round trip test
  const roundTripResult = z.encode(waypointSchema, z.decode(waypointSchema, inputWaypoint));
  expect(roundTripResult).toMatchInlineSnapshot(`
    {
      "coordinate": "150,200",
      "difficulty": "medium",
      "name": "Summit Point",
    }
  `);
});

test("mutating refinements", () => {
  const A = z.codec(z.string(), z.string().trim(), {
    decode: (val) => val,
    encode: (val) => val,
  });

  expect(z.decode(A, " asdf ")).toMatchInlineSnapshot(`"asdf"`);
  expect(z.encode(A, " asdf ")).toMatchInlineSnapshot(`"asdf"`);

  const B = z
    .codec(z.string(), z.string(), {
      decode: (val) => val,
      encode: (val) => val,
    })
    .check(z.trim(), z.maxLength(4));

  expect(z.decode(B, " asdf ")).toMatchInlineSnapshot(`"asdf"`);
  expect(z.encode(B, " asdf ")).toMatchInlineSnapshot(`"asdf"`);
});

test("codec type enforcement - correct encode/decode signatures", () => {
  // Test that codec functions have correct type signatures
  const stringToNumberCodec = z.codec(z.string(), z.number(), {
    decode: (value: string) => Number(value), // core.output<A> -> core.input<B>
    encode: (value: number) => String(value), // core.input<B> -> core.output<A>
  });

  // These should compile without errors - correct types (async support)
  expectTypeOf<(value: string, payload: z.core.ParsePayload<string>) => z.core.util.MaybeAsync<number>>(
    stringToNumberCodec.def.transform
  ).toBeFunction();
  expectTypeOf<(value: number, payload: z.core.ParsePayload<number>) => z.core.util.MaybeAsync<string>>(
    stringToNumberCodec.def.reverseTransform
  ).toBeFunction();

  // Test that decode parameter type is core.output<A> (string)
  const validDecode = (value: string) => Number(value);
  expectTypeOf(validDecode).toMatchTypeOf<(value: string) => number>();

  // Test that encode parameter type is core.input<B> (number)
  const validEncode = (value: number) => String(value);
  expectTypeOf(validEncode).toMatchTypeOf<(value: number) => string>();

  z.codec(z.string(), z.number(), {
    // @ts-expect-error - decode should NOT accept core.input<A> as parameter
    decode: (value: never, _payload) => Number(value), // Wrong: should be string, not unknown
    encode: (value: number, _payload) => String(value),
  });

  z.codec(z.string(), z.number(), {
    decode: (value: string) => Number(value),
    // @ts-expect-error - encode should NOT accept core.output<B> as parameter
    encode: (value: never) => String(value), // Wrong: should be number, not unknown
  });

  z.codec(z.string(), z.number(), {
    // @ts-expect-error - decode return type should be core.input<B>
    decode: (value: string) => String(value), // Wrong: should return number, not string
    encode: (value: number) => String(value),
  });

  z.codec(z.string(), z.number(), {
    decode: (value: string) => Number(value),
    // @ts-expect-error - encode return type should be core.output<A>
    encode: (value: number) => Number(value), // Wrong: should return string, not number
  });
});

test("codec type enforcement - complex types", () => {
  type User = { id: number; name: string };
  type UserInput = { id: string; name: string };

  const userCodec = z.codec(
    z.object({ id: z.string(), name: z.string() }),
    z.object({ id: z.number(), name: z.string() }),
    {
      decode: (input: UserInput) => ({ id: Number(input.id), name: input.name }),
      encode: (user: User) => ({ id: String(user.id), name: user.name }),
    }
  );

  // Verify correct types are inferred (async support)
  expectTypeOf<(input: UserInput, payload: z.core.ParsePayload<UserInput>) => z.core.util.MaybeAsync<User>>(
    userCodec.def.transform
  ).toBeFunction();
  expectTypeOf<(user: User, payload: z.core.ParsePayload<User>) => z.core.util.MaybeAsync<UserInput>>(
    userCodec.def.reverseTransform
  ).toBeFunction();

  z.codec(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
    z.object({ id: z.number(), name: z.string() }),
    {
      // @ts-expect-error - decode parameter should be UserInput, not User
      decode: (input: User) => ({ id: Number(input.id), name: input.name }), // Wrong type
      encode: (user: User) => ({ id: String(user.id), name: user.name }),
    }
  );

  z.codec(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
    z.object({ id: z.number(), name: z.string() }),
    {
      decode: (input: UserInput) => ({ id: Number(input.id), name: input.name }),
      // @ts-expect-error - encode parameter should be User, not UserInput
      encode: (user: UserInput) => ({ id: String(user.id), name: user.name }), // Wrong type
    }
  );
});

test("codex with overwrites", () => {
  const stringPlusA = z.string().overwrite((val) => val + "a");
  const A = z
    .codec(stringPlusA, stringPlusA, {
      decode: (val) => val,
      encode: (val) => val,
    })
    .overwrite((val) => val + "a");

  expect(z.decode(A, "")).toEqual("aaa");
  expect(z.encode(A, "")).toEqual("aaa");

  // @ts-expect-error
  expect(z.safeEncode(A, Symbol("a"))).toMatchInlineSnapshot(`
    {
      "error": [ZodError: [
      {
        "expected": "string",
        "code": "invalid_type",
        "path": [],
        "message": "Invalid input: expected string, received symbol"
      }
    ]],
      "success": false,
    }
  `);
});

test("async codec functionality", async () => {
  // Test that async encode/decode functions work properly
  const asyncCodec = z.codec(z.string(), z.number(), {
    decode: async (str) => {
      await new Promise((resolve) => setTimeout(resolve, 1)); // Simulate async work
      return Number.parseFloat(str);
    },
    encode: async (num) => {
      await new Promise((resolve) => setTimeout(resolve, 1)); // Simulate async work
      return num.toString();
    },
  });

  // Test async decode/encode
  const decoded = await z.decodeAsync(asyncCodec, "42.5");
  expect(decoded).toBe(42.5);

  const encoded = await z.encodeAsync(asyncCodec, 42.5);
  expect(encoded).toBe("42.5");

  // Test that both sync and async work
  const mixedCodec = z.codec(z.string(), z.number(), {
    decode: async (str) => Number.parseFloat(str),
    encode: (num) => num.toString(), // sync encode
  });

  const mixedResult = await z.decodeAsync(mixedCodec, "123");
  expect(mixedResult).toBe(123);
});
