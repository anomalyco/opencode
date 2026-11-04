import { test } from "vitest";
import * as z from "zod/v4";

test("extend chaining preserves and overrides properties", () => {
  const schema1 = z.object({
    email: z.string(),
  });

  const schema2 = schema1.extend({
    email: schema1.shape.email.check(z.email()),
  });

  const schema3 = schema2.extend({
    email: schema2.shape.email.or(z.literal("")),
  });

  schema3.parse({ email: "test@example.com" });
});
