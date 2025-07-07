import { expect, test, describe } from "bun:test";
// Config is no longer needed here for these specific tests
import { ModelsDev } from "../src/provider/models";
import { Provider } from "../src/provider/provider";

describe("Provider Logic", () => {
  // No longer need to mock Config.get for these tests

  test("should use standard pricing for small contexts", () => {
    const model: ModelsDev.Model = {
      id: "gemini-pro",
      name: "Gemini Pro",
      release_date: "2023-12-15",
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        standard: { input: 1.25, output: 10.00 },
        large_context: { input: 2.50, output: 15.00 },
      },
      limit: {
        context: 1000000,
        output: 8192,
        standard_context_threshold: 200000,
      },
      options: {},
    };

    const cost = Provider.getCost(model, false, 100000); // Pass false directly
    expect(cost.input).toBe(1.25);
    expect(cost.output).toBe(10.00);
  });

  test("should use large context pricing for large contexts", () => {
    const model: ModelsDev.Model = {
      id: "gemini-pro",
      name: "Gemini Pro",
      release_date: "2023-12-15",
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        standard: { input: 1.25, output: 10.00 },
        large_context: { input: 2.50, output: 15.00 },
      },
      limit: {
        context: 1000000,
        output: 8192,
        standard_context_threshold: 200000,
      },
      options: {},
    };

    const cost = Provider.getCost(model, false, 300000); // Pass false directly
    expect(cost.input).toBe(2.50);
    expect(cost.output).toBe(15.00);
  });

  test("should use standard pricing for large contexts when use_standard_pricing_only is true", () => {
    const model: ModelsDev.Model = {
      id: "gemini-pro",
      name: "Gemini Pro",
      release_date: "2023-12-15",
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        standard: { input: 1.25, output: 10.00 },
        large_context: { input: 2.50, output: 15.00 },
      },
      limit: {
        context: 1000000,
        output: 8192,
        standard_context_threshold: 200000,
      },
      options: {},
    };

    const cost = Provider.getCost(model, true, 300000); // Pass true directly
    expect(cost.input).toBe(1.25);
    expect(cost.output).toBe(10.00);
  });

  test("should use standard pricing when tiered pricing is not available", () => {
    const model: ModelsDev.Model = {
      id: "some-other-model",
      name: "Some Other Model",
      release_date: "2023-12-15",
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: { input: 1.00, output: 5.00 }, // No tiered pricing
      limit: {
        context: 1000000,
        output: 8192,
      },
      options: {},
    };

    // For models without tiered pricing, the use_standard_pricing_only flag doesn't change the outcome.
    // We can test with either true or false, e.g., false.
    const cost = Provider.getCost(model, false, 300000);
    expect(cost.input).toBe(1.00);
    expect(cost.output).toBe(5.00);
  });
});
