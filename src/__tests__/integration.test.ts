import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runTestPlan } from "@/lib/browserAdapter";
import { generatePlanDeterministic } from "@/lib/planGenerator";

vi.mock("dns", () => ({
  default: {
    promises: {
      lookup: vi.fn().mockResolvedValue({ address: "104.244.42.1", family: 4 }),
    },
  },
}));

describe("mocked browser execution integration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, MOCK_BROWSER: "true" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should validate, plan, and successfully run a mock flow test", async () => {
    const instructions = `Open the homepage
Click the link
Verify that "Success Page" is visible`;

    const plan = generatePlanDeterministic(
      "Smoke Integration Test",
      "https://public-site.com",
      "desktop",
      instructions
    );

    // Run the execution flow adapter
    const report = await runTestPlan(plan);

    // Verify output structures
    expect(report.status).toBe("passed");
    expect(report.summary.passed).toBe(3);
    expect(report.summary.failed).toBe(0);
    expect(report.steps).toHaveLength(3);
    expect(report.screenshots).toHaveLength(3); // navigation + click + assert
    expect(report.consoleMessages).toHaveLength(1);
    expect(report.pageErrors).toHaveLength(0);
    expect(report.failedRequests).toHaveLength(0);
  });

  it("should fail gracefully and record step failure if a failing instruction is encountered", async () => {
    const instructions = `Open the homepage
Click the element causing a failure
Verify that "Success Page" is visible`;

    const plan = generatePlanDeterministic(
      "Failure Flow Test",
      "https://public-site.com",
      "desktop",
      instructions
    );

    const report = await runTestPlan(plan);

    expect(report.status).toBe("failed");
    expect(report.summary.passed).toBe(1); // Nav pass
    expect(report.summary.failed).toBe(1); // Click fail
    expect(report.summary.skipped).toBe(1); // Assert skip
    expect(report.steps[1].status).toBe("failed");
    expect(report.steps[1].message).toContain("Action failed");
    expect(report.steps[2].status).toBe("skipped");
    expect(report.pageErrors).toHaveLength(1);
    expect(report.failedRequests).toHaveLength(1);
  });
});
