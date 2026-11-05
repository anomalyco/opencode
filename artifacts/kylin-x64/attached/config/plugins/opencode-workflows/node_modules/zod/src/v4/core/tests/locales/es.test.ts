import { expect, test } from "vitest";
import { z } from "../../../../index.js";
import es from "../../../locales/es.js";

test("Spanish locale - type name translations in too_small errors", () => {
  z.config(es());

  // Test string type translation
  const stringSchema = z.string().min(5);
  const stringResult = stringSchema.safeParse("abc");
  expect(stringResult.success).toBe(false);
  if (!stringResult.success) {
    expect(stringResult.error.issues[0].message).toBe(
      "Demasiado pequeño: se esperaba que texto tuviera >=5 caracteres"
    );
  }

  // Test number type translation
  const numberSchema = z.number().min(10);
  const numberResult = numberSchema.safeParse(5);
  expect(numberResult.success).toBe(false);
  if (!numberResult.success) {
    expect(numberResult.error.issues[0].message).toBe("Demasiado pequeño: se esperaba que número fuera >=10");
  }

  // Test array type translation
  const arraySchema = z.array(z.string()).min(3);
  const arrayResult = arraySchema.safeParse(["a", "b"]);
  expect(arrayResult.success).toBe(false);
  if (!arrayResult.success) {
    expect(arrayResult.error.issues[0].message).toBe(
      "Demasiado pequeño: se esperaba que arreglo tuviera >=3 elementos"
    );
  }

  // Test set type translation
  const setSchema = z.set(z.string()).min(2);
  const setResult = setSchema.safeParse(new Set(["a"]));
  expect(setResult.success).toBe(false);
  if (!setResult.success) {
    expect(setResult.error.issues[0].message).toBe("Demasiado pequeño: se esperaba que conjunto tuviera >=2 elementos");
  }
});

test("Spanish locale - type name translations in too_big errors", () => {
  z.config(es());

  // Test string type translation
  const stringSchema = z.string().max(3);
  const stringResult = stringSchema.safeParse("abcde");
  expect(stringResult.success).toBe(false);
  if (!stringResult.success) {
    expect(stringResult.error.issues[0].message).toBe("Demasiado grande: se esperaba que texto tuviera <=3 caracteres");
  }

  // Test number type translation
  const numberSchema = z.number().max(10);
  const numberResult = numberSchema.safeParse(15);
  expect(numberResult.success).toBe(false);
  if (!numberResult.success) {
    expect(numberResult.error.issues[0].message).toBe("Demasiado grande: se esperaba que número fuera <=10");
  }

  // Test array type translation
  const arraySchema = z.array(z.string()).max(2);
  const arrayResult = arraySchema.safeParse(["a", "b", "c"]);
  expect(arrayResult.success).toBe(false);
  if (!arrayResult.success) {
    expect(arrayResult.error.issues[0].message).toBe("Demasiado grande: se esperaba que arreglo tuviera <=2 elementos");
  }
});

test("Spanish locale - type name translations in invalid_type errors", () => {
  z.config(es());

  // Test string expected, number received
  const stringSchema = z.string();
  const stringResult = stringSchema.safeParse(123);
  expect(stringResult.success).toBe(false);
  if (!stringResult.success) {
    expect(stringResult.error.issues[0].message).toBe("Entrada inválida: se esperaba texto, recibido número");
  }

  // Test number expected, string received
  const numberSchema = z.number();
  const numberResult = numberSchema.safeParse("abc");
  expect(numberResult.success).toBe(false);
  if (!numberResult.success) {
    expect(numberResult.error.issues[0].message).toBe("Entrada inválida: se esperaba número, recibido texto");
  }

  // Test boolean expected, null received
  const booleanSchema = z.boolean();
  const booleanResult = booleanSchema.safeParse(null);
  expect(booleanResult.success).toBe(false);
  if (!booleanResult.success) {
    expect(booleanResult.error.issues[0].message).toBe("Entrada inválida: se esperaba booleano, recibido nulo");
  }

  // Test array expected, object received
  const arraySchema = z.array(z.string());
  const arrayResult = arraySchema.safeParse({});
  expect(arrayResult.success).toBe(false);
  if (!arrayResult.success) {
    expect(arrayResult.error.issues[0].message).toBe("Entrada inválida: se esperaba arreglo, recibido objeto");
  }
});

test("Spanish locale - fallback for unknown type names", () => {
  z.config(es());

  // Test with a type that's not in the TypeNames dictionary
  // This will test the fallback behavior
  const dateSchema = z.date().min(new Date("2025-01-01"));
  const dateResult = dateSchema.safeParse(new Date("2024-01-01"));
  expect(dateResult.success).toBe(false);
  if (!dateResult.success) {
    // Should use "fecha" since we included it in TypeNames
    expect(dateResult.error.issues[0].message).toContain("fecha");
  }
});

test("Spanish locale - other error cases", () => {
  z.config(es());

  // Test invalid_element with tuple
  const tupleSchema = z.tuple([z.string(), z.number()]);
  const tupleResult = tupleSchema.safeParse(["abc", "not a number"]);
  expect(tupleResult.success).toBe(false);
  if (!tupleResult.success) {
    expect(tupleResult.error.issues[0].message).toContain("Entrada inválida");
  }

  // Test invalid_value with enum
  const enumSchema = z.enum(["a", "b"]);
  const enumResult = enumSchema.safeParse("c");
  expect(enumResult.success).toBe(false);
  if (!enumResult.success) {
    expect(enumResult.error.issues[0].message).toBe('Opción inválida: se esperaba una de "a"|"b"');
  }

  // Test not_multiple_of
  const multipleSchema = z.number().multipleOf(3);
  const multipleResult = multipleSchema.safeParse(10);
  expect(multipleResult.success).toBe(false);
  if (!multipleResult.success) {
    expect(multipleResult.error.issues[0].message).toBe("Número inválido: debe ser múltiplo de 3");
  }

  // Test unrecognized_keys
  const strictSchema = z.object({ a: z.string() }).strict();
  const strictResult = strictSchema.safeParse({ a: "test", b: "extra" });
  expect(strictResult.success).toBe(false);
  if (!strictResult.success) {
    expect(strictResult.error.issues[0].message).toBe('Llave desconocida: "b"');
  }

  // Test invalid_union
  const unionSchema = z.union([z.string(), z.number()]);
  const unionResult = unionSchema.safeParse(true);
  expect(unionResult.success).toBe(false);
  if (!unionResult.success) {
    expect(unionResult.error.issues[0].message).toBe("Entrada inválida");
  }

  // Test invalid_format with regex
  const regexSchema = z.string().regex(/^[a-z]+$/);
  const regexResult = regexSchema.safeParse("ABC123");
  expect(regexResult.success).toBe(false);
  if (!regexResult.success) {
    expect(regexResult.error.issues[0].message).toBe("Cadena inválida: debe coincidir con el patrón /^[a-z]+$/");
  }

  // Test invalid_format with startsWith
  const startsWithSchema = z.string().startsWith("hello");
  const startsWithResult = startsWithSchema.safeParse("world");
  expect(startsWithResult.success).toBe(false);
  if (!startsWithResult.success) {
    expect(startsWithResult.error.issues[0].message).toBe('Cadena inválida: debe comenzar con "hello"');
  }
});
