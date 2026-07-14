import { NextResponse } from "next/server";
import { TestRunRequestSchema, TestRunResult } from "@/lib/schemas";
import { validateUrl } from "@/lib/safety";
import { generatePlan } from "@/lib/planGenerator";
import { runTestPlan } from "@/lib/browserAdapter";

// Enforce Node.js runtime and configure a maximum function execution duration on Vercel
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 1. Validate Input JSON structure
    const parsedRequest = TestRunRequestSchema.safeParse(body);
    if (!parsedRequest.success) {
      return NextResponse.json(
        {
          error: "INVALID_REQUEST",
          message: "Request inputs failed schema validation.",
          details: parsedRequest.error.format(),
        },
        { status: 400 }
      );
    }

    const { url, name, instructions, viewport } = parsedRequest.data;

    // 2. Perform Server-Side SSRF URL validation
    const urlValidation = await validateUrl(url);
    if (!urlValidation.isValid) {
      // Return a clean blocked report rather than throwing a raw 500 error
      const mockResult: TestRunResult = {
        id: `blocked_${Date.now()}`,
        title: name,
        startUrl: url,
        finalUrl: url,
        viewport,
        status: "blocked",
        startedAt: new Date().toISOString(),
        durationMs: 0,
        plan: [],
        steps: [],
        screenshots: [],
        consoleMessages: [],
        pageErrors: [
          {
            message: `URL_SAFETY_BLOCK: ${urlValidation.error || "The requested URL was blocked for security reasons."}`,
            timestamp: new Date().toISOString(),
          },
        ],
        failedRequests: [],
        summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
      };
      return NextResponse.json(mockResult);
    }

    // 3. Generate a structured test plan
    const plan = await generatePlan(name, url, viewport, instructions);

    // 4. Run the test plan
    const report = await runTestPlan(plan);

    // 5. Respond with the detailed test result
    return NextResponse.json(report);
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Test Run API handler encountered an unhandled error:", err);

    // Return structured INTERNAL_ERROR instead of raw stack traces
    const errorResult: TestRunResult = {
      id: `err_${Date.now()}`,
      title: "Error Execution",
      startUrl: "",
      finalUrl: "",
      viewport: "desktop",
      status: "error",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      plan: [],
      steps: [],
      screenshots: [],
      consoleMessages: [],
      pageErrors: [
        {
          message: `INTERNAL_ERROR: An unexpected error occurred while executing the test. ${err.message || ""}`,
          timestamp: new Date().toISOString(),
        },
      ],
      failedRequests: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    };
    return NextResponse.json(errorResult, { status: 500 });
  }
}
