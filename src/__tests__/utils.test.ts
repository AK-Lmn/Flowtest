import { describe, it, expect } from "vitest";
import { sanitizeUrl } from "@/lib/browserAdapter";
import { generatePlanDeterministic } from "@/lib/planGenerator";
import { CONFIG_LIMITS } from "@/lib/schemas";

describe("sanitization and plan utilities", () => {
  describe("sanitizeUrl", () => {
    it("should redact sensitive params from standard URLs", () => {
      const url = "https://example.com/api/v1?token=abcdef123&query=stagehand";
      const sanitized = sanitizeUrl(url);
      expect(sanitized).toContain("token=%5BREDACTED%5D");
      expect(sanitized).toContain("query=stagehand");
    });

    it("should redact apiKey, secret, password parameters case-insensitively", () => {
      const url = "https://test.org/auth?API_KEY=secret_val&password=123&user=john";
      const sanitized = sanitizeUrl(url);
      expect(sanitized).toContain("API_KEY=%5BREDACTED%5D");
      expect(sanitized).toContain("password=%5BREDACTED%5D");
      expect(sanitized).toContain("user=john");
    });

    it("should keep safe URLs unchanged", () => {
      const url = "https://example.com/docs/intro?topic=stagehand&ref=google";
      const sanitized = sanitizeUrl(url);
      expect(sanitized).toBe(url);
    });
  });

  describe("generatePlanDeterministic", () => {
    it("should parse standard flow lines correctly", () => {
      const instructions = `Open the homepage
Click the Sign in button
Type "hello@example.com" into the email field
Verify that "Welcome back" is visible
Verify that the URL contains "/login"`;

      const plan = generatePlanDeterministic("Test Name", "https://example.com", "desktop", instructions);

      expect(plan.steps).toHaveLength(5);
      expect(plan.steps[0]).toEqual({
        id: "step_1",
        instruction: "Open the homepage",
        kind: "navigate",
        target: "the homepage",
        value: undefined,
      });

      expect(plan.steps[1]).toEqual({
        id: "step_2",
        instruction: "Click the Sign in button",
        kind: "click",
        target: "Sign in button",
        value: undefined,
      });

      expect(plan.steps[2]).toEqual({
        id: "step_3",
        instruction: 'Type "hello@example.com" into the email field',
        kind: "fill",
        target: "email field",
        value: "hello@example.com",
      });

      expect(plan.steps[3]).toEqual({
        id: "step_4",
        instruction: 'Verify that "Welcome back" is visible',
        kind: "assert-visible",
        target: '"Welcome back"',
        value: undefined,
      });

      expect(plan.steps[4]).toEqual({
        id: "step_5",
        instruction: 'Verify that the URL contains "/login"',
        kind: "assert-url",
        target: undefined,
        value: "/login",
      });
    });

    it("should cap steps at maxPlannedSteps", () => {
      const longInstructions = Array(20).fill("Click a button").join("\n");
      const plan = generatePlanDeterministic("Test Name", "https://example.com", "desktop", longInstructions);
      expect(plan.steps).toHaveLength(CONFIG_LIMITS.maxPlannedSteps);
    });
  });
});
