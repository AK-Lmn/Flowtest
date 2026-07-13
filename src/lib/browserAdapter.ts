import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import {
  TestPlan,
  TestRunResult,
  StepResult,
  TestScreenshot,
  BrowserConsoleMessage,
  BrowserPageError,
  FailedNetworkRequest,
  CONFIG_LIMITS,
} from "./schemas";
import { validateUrl } from "./safety";

declare global {
  interface Window {
    __flowTestErrors?: Array<{
      message: string;
      url: string;
      line: number;
      col: number;
      errorType: string;
    }>;
  }
}

/**
 * Sanitizes URLs to redact sensitive query parameters.
 */
export function sanitizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    const sensitiveParams = [
      "token",
      "key",
      "api_key",
      "password",
      "secret",
      "auth",
      "session",
      "code",
      "apiKey",
      "accessToken",
    ];
    let modified = false;
    url.searchParams.forEach((_, key) => {
      if (sensitiveParams.some((p) => key.toLowerCase().includes(p.toLowerCase()))) {
        url.searchParams.set(key, "[REDACTED]");
        modified = true;
      }
    });
    return modified ? url.toString() : urlStr;
  } catch {
    return urlStr;
  }
}

interface StagehandPage {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  on(event: "console", listener: (msg: { type: () => string; text: () => string; location: () => { url?: string; lineNumber?: number } }) => void): void;
  route(
    url: string,
    handler: (
      route: { abort: (reason?: string) => Promise<void>; continue: () => Promise<void> },
      req: { url: () => string; isNavigationRequest: () => boolean }
    ) => void
  ): Promise<void>;
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): {
    waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
    click(): Promise<void>;
    fill(value: string): Promise<void>;
  };
  act(instruction: string): Promise<void>;
  extract<T>(instruction: string, schema: z.ZodType<T>): Promise<T>;
  keyboard: {
    press(key: string): Promise<void>;
  };
  screenshot(options?: { type?: string; quality?: number }): Promise<Buffer>;
  addInitScript(script: () => void): Promise<void>;
  evaluate<R = unknown>(fn: () => R): Promise<R>;
}

/**
 * Runs a validated TestPlan in an isolated cloud browser via Stagehand and Steel.
 */
export async function runTestPlan(
  plan: TestPlan,
  abortSignal?: AbortSignal
): Promise<TestRunResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  const isMock = process.env.MOCK_BROWSER === "true";
  const steelApiKey = process.env.STEEL_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!isMock) {
    if (!steelApiKey) {
      return createBlockedResult(
        plan,
        "STEEL_API_KEY is not configured on the server. Please add it to your environment variables.",
        startedAt
      );
    }
    if (!geminiApiKey) {
      return createBlockedResult(
        plan,
        "GEMINI_API_KEY is not configured on the server. Please add it to your environment variables.",
        startedAt
      );
    }
  }

  // Define collections
  const stepResults: StepResult[] = [];
  const screenshots: TestScreenshot[] = [];
  const consoleMessages: BrowserConsoleMessage[] = [];
  const pageErrors: BrowserPageError[] = [];
  const failedRequests: FailedNetworkRequest[] = [];

  let finalUrl = plan.startUrl;
  let status: TestRunResult["status"] = "passed";

  // Check URL safety
  const safetyCheck = await validateUrl(plan.startUrl);
  if (!safetyCheck.isValid) {
    return createBlockedResult(
      plan,
      safetyCheck.error || "The target URL is blocked due to security validation.",
      startedAt
    );
  }

  const approvedOrigin = safetyCheck.parsedUrl?.origin || "";

  // ----------------------------------------------------
  // Mock Mode Execution (used for testing/local-no-auth)
  // ----------------------------------------------------
  if (isMock) {
    let mockScreenshotsCount = 0;
    const captureMockScreenshot = (stepId?: string) => {
      if (mockScreenshotsCount < CONFIG_LIMITS.maxScreenshotCount) {
        mockScreenshotsCount++;
        screenshots.push({
          id: `screenshot_${mockScreenshotsCount}`,
          stepId,
          base64Data: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/",
          contentType: "image/jpeg",
          timestamp: new Date().toISOString(),
        });
      }
    };

    // Add navigation screenshot
    captureMockScreenshot();

    let abortedOrFailed = false;
    for (const step of plan.steps) {
      const stepStart = Date.now();
      
      if (abortSignal?.aborted || abortedOrFailed) {
        stepResults.push({
          id: step.id,
          instruction: step.instruction,
          kind: step.kind,
          status: "skipped",
          durationMs: 0,
          message: abortSignal?.aborted ? "Test run aborted by client." : "Step skipped due to previous failure.",
        });
        continue;
      }

      // Simulate step delay
      await new Promise((resolve) => setTimeout(resolve, 50));

      const isAssertion = step.kind.startsWith("assert-");
      const durationMs = Date.now() - stepStart;

      // Make a step fail for specific instructions to test failure modes
      const shouldFail =
        step.instruction.toLowerCase().includes("fail") ||
        step.instruction.toLowerCase().includes("missing") ||
        step.instruction.toLowerCase().includes("error");

      if (shouldFail) {
        status = "failed";
        abortedOrFailed = true;
        captureMockScreenshot(step.id);
        
        if (isAssertion) {
          stepResults.push({
            id: step.id,
            instruction: step.instruction,
            kind: step.kind,
            status: "failed",
            durationMs,
            expected: step.value || step.target || "Visible element",
            actual: "Not found",
            message: `Assertion failed: ${step.instruction}`,
            screenshotId: `screenshot_${mockScreenshotsCount}`,
          });
        } else {
          stepResults.push({
            id: step.id,
            instruction: step.instruction,
            kind: step.kind,
            status: "failed",
            durationMs,
            message: `Action failed: Target not found: ${step.target || step.instruction}`,
            screenshotId: `screenshot_${mockScreenshotsCount}`,
          });
        }
      } else {
        stepResults.push({
          id: step.id,
          instruction: step.instruction,
          kind: step.kind,
          status: "passed",
          durationMs,
          message: `Step executed successfully.`,
        });
        
        // Capture screenshot on important interactions or asserts
        if (step.kind === "click" || step.kind === "fill" || isAssertion) {
          captureMockScreenshot(step.id);
        }
      }
    }

    // Populate diagnostics with some safe test messages
    consoleMessages.push({
      type: "info",
      text: "App mounted successfully",
    });
    
    if (plan.steps.some(s => s.instruction.toLowerCase().includes("fail"))) {
      pageErrors.push({
        message: "Uncaught ReferenceError: element is not defined",
        timestamp: new Date().toISOString(),
      });
      failedRequests.push({
        method: "GET",
        url: "https://example.com/api/missing-asset.png",
        resourceType: "image",
        failureReason: "net::ERR_FILE_NOT_FOUND",
      });
    }

    const durationMs = Date.now() - startTime;
    return finalizeResult(
      plan,
      status,
      finalUrl,
      stepResults,
      screenshots,
      consoleMessages,
      pageErrors,
      failedRequests,
      startedAt,
      durationMs
    );
  }

  // ----------------------------------------------------
  // Live Steel / Stagehand Execution
  // ----------------------------------------------------
  let stagehand: Stagehand | null = null;
  let sessionId: string | null = null;

  try {
    // 1. Create Steel Browser Session
    const steelSessionRes = await fetch("https://api.steel.dev/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "steel-api-key": steelApiKey || "",
      },
      body: JSON.stringify({
        timeout: CONFIG_LIMITS.maxRunDurationMs,
      }),
    });

    if (!steelSessionRes.ok) {
      const errorText = await steelSessionRes.text();
      throw new Error(`Failed to create Steel browser session: ${steelSessionRes.status} ${errorText}`);
    }

    const session = await steelSessionRes.json() as { id: string; websocketUrl: string };
    sessionId = session.id;

    // 2. Construct CDP URL
    const separator = session.websocketUrl.includes("?") ? "&" : "?";
    const cdpUrl = `${session.websocketUrl}${separator}apiKey=${steelApiKey}`;

    // 3. Connect Stagehand via CDP
    stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        cdpUrl,
      },
      model: {
        modelName: "google/gemini-2.5-flash",
        apiKey: geminiApiKey,
      },
      verbose: 1,
    });

    await stagehand.init();
    const context = stagehand.context;
    let pageObj = context.activePage() ?? context.pages()[0];
    if (!pageObj) {
      pageObj = await context.newPage();
    }
    context.setActivePage(pageObj);
    const page = pageObj as unknown as StagehandPage;

    // 1. Enforce Viewport Size
    const width = plan.viewport === "desktop" ? 1280 : 390;
    const height = plan.viewport === "desktop" ? 720 : 844;
    await page.setViewportSize({ width, height });

    // 2. Set up console listener
    page.on("console", (msg) => {
      if (consoleMessages.length < 50) {
        consoleMessages.push({
          type: msg.type(),
          text: msg.text().slice(0, 500),
          url: sanitizeUrl(msg.location()?.url || ""),
          line: msg.location()?.lineNumber,
        });
      }
    });

    // Add init script to collect page errors in window.__flowTestErrors
    await page.addInitScript(() => {
      window.__flowTestErrors = [];
      window.addEventListener('error', function (event) {
        if (!window.__flowTestErrors || window.__flowTestErrors.length >= 20) return;
        window.__flowTestErrors.push({
          message: event.message || 'Unknown runtime error',
          url: event.filename || '',
          line: event.lineno || 0,
          col: event.colno || 0,
          errorType: event.error ? event.error.name : 'Error'
        });
      }, true);
      window.addEventListener('unhandledrejection', function (event) {
        if (!window.__flowTestErrors || window.__flowTestErrors.length >= 20) return;
        const reason = event.reason;
        const msg = reason ? (reason.message || String(reason)) : 'Unhandled promise rejection';
        window.__flowTestErrors.push({
          message: 'Unhandled Promise Rejection: ' + msg,
          url: window.location.href,
          line: 0,
          col: 0,
          errorType: 'UnhandledRejection'
        });
      }, true);
    });

    // 3. Enforce Origin Isolation Policy
    await page.route("**/*", (route, req) => {
      try {
        const reqUrl = new URL(req.url());
        const isNavigation = req.isNavigationRequest();
        
        if (isNavigation && reqUrl.origin !== approvedOrigin) {
          // Block external navigation attempts
          console.warn(`Blocking navigation attempt to external origin: ${reqUrl.origin}`);
          route.abort("blockedbyclient");
        } else {
          route.continue();
        }
      } catch {
        route.continue();
      }
    });

    // Helper to capture a compressed screenshot safely
    const captureScreenshot = async (stepId?: string) => {
      if (screenshots.length >= CONFIG_LIMITS.maxScreenshotCount) return;
      try {
        const screenshotBuf = await page.screenshot({
          type: "jpeg",
          quality: 75,
        });
        screenshots.push({
          id: `screenshot_${screenshots.length + 1}`,
          stepId,
          base64Data: `data:image/jpeg;base64,${screenshotBuf.toString("base64")}`,
          contentType: "image/jpeg",
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Failed to capture screenshot:", err);
      }
    };

    const fetchPageErrors = async () => {
      try {
        const rawErrors = await page.evaluate(() => {
          const errs = window.__flowTestErrors || [];
          window.__flowTestErrors = [];
          return errs;
        });

        for (const err of rawErrors) {
          if (pageErrors.length >= 20) break;
          const sanitizedUrl = sanitizeUrl(err.url).slice(0, 500);
          const sanitizedMsg = err.message.slice(0, 1000);
          pageErrors.push({
            message: `[${err.errorType}] ${sanitizedMsg} (${sanitizedUrl}:${err.line}:${err.col})`,
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
        // Safe catch to prevent crashing the test run
      }
    };

    try {
      await page.goto(plan.startUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await fetchPageErrors();
      await captureScreenshot();
      finalUrl = sanitizeUrl(page.url());
    } catch (err: unknown) {
      status = "error";
      const error = err as Error;
      return createBlockedResult(
        plan,
        `Navigation to start URL failed: ${error.message || error}`,
        startedAt,
        Date.now() - startTime
      );
    }

    // 5. Execute step-by-step
    let abortedOrFailed = false;
    for (const step of plan.steps) {
      if (abortSignal?.aborted || abortedOrFailed) {
        stepResults.push({
          id: step.id,
          instruction: step.instruction,
          kind: step.kind,
          status: "skipped",
          durationMs: 0,
          message: abortSignal?.aborted ? "Execution aborted." : "Step skipped due to previous failure.",
        });
        continue;
      }

      const stepStart = Date.now();
      let stepPassed = true;
      let stepMessage = "Step executed successfully.";
      let expected: string | undefined;
      let actual: string | undefined;

      try {
        // Enforce maximum execution duration boundary per run
        if (Date.now() - startTime > CONFIG_LIMITS.maxRunDurationMs) {
          throw new Error("TEST_TIMEOUT: Maximum test run duration exceeded.");
        }

        switch (step.kind) {
          case "navigate": {
            // Only allow navigating inside original approved origin
            const targetUrlStr = step.value || step.target || plan.startUrl;
            const targetUrlCheck = await validateUrl(targetUrlStr);
            if (!targetUrlCheck.isValid || targetUrlCheck.parsedUrl?.origin !== approvedOrigin) {
              throw new Error(`BLOCKED_DESTINATION: Navigation to external origin or unsafe URL blocked.`);
            }
            await page.goto(targetUrlStr, { waitUntil: "domcontentloaded", timeout: 15000 });
            finalUrl = sanitizeUrl(page.url());
            break;
          }

          case "click":
          case "fill":
          case "select":
          case "scroll": {
            // Run natural-language actions
            await page.act(step.instruction);
            break;
          }

          case "press": {
            if (step.value) {
              await page.keyboard.press(step.value);
            } else {
              await page.act(step.instruction);
            }
            break;
          }

          case "wait": {
            if (step.target) {
              await page.locator(step.target).waitFor({ state: "visible", timeout: 10000 });
            } else {
              const waitMs = parseInt(step.value || "2000", 10);
              await new Promise((r) => setTimeout(r, Math.min(waitMs, 10000)));
            }
            break;
          }

          case "assert-visible": {
            expected = `Element "${step.target}" to be visible`;
            const check = await page.extract(`Is the element "${step.target}" currently visible on the page?`, z.boolean());
            actual = check ? "Visible" : "Not visible";
            if (!check) {
              throw new Error(`Element "${step.target}" is not visible.`);
            }
            break;
          }

          case "assert-text": {
            expected = `Text "${step.value}" to be present`;
            const check = await page.extract(`Is the text "${step.value}" visible on the page?`, z.boolean());
            actual = check ? "Present" : "Not present";
            if (!check) {
              throw new Error(`Text "${step.value}" was not found visible on the page.`);
            }
            break;
          }

          case "assert-url": {
            expected = `URL contains "${step.value}"`;
            const currentUrl = page.url();
            actual = `URL is "${currentUrl}"`;
            if (!currentUrl.includes(step.value || "")) {
              throw new Error(`URL assertion failed. Expected URL to contain "${step.value}".`);
            }
            break;
          }

          case "assert-title": {
            expected = `Title contains "${step.value}"`;
            const title = await page.title();
            actual = `Title is "${title}"`;
            if (!title.toLowerCase().includes((step.value || "").toLowerCase())) {
              throw new Error(`Title assertion failed. Expected title to contain "${step.value}".`);
            }
            break;
          }

          case "assert-enabled": {
            expected = `Element "${step.target}" to be enabled`;
            const check = await page.extract(`Is the element "${step.target}" enabled?`, z.boolean());
            actual = check ? "Enabled" : "Disabled";
            if (!check) {
              throw new Error(`Element "${step.target}" is disabled.`);
            }
            break;
          }

          default:
            throw new Error(`Unsupported step kind: ${step.kind}`);
        }
      } catch (err: unknown) {
        stepPassed = false;
        status = "failed";
        const error = err as Error;
        stepMessage = error.message || "Unknown execution error";
        abortedOrFailed = true;
      }

      const durationMs = Date.now() - stepStart;
      const screenshotId = !stepPassed || step.kind === "click" || step.kind === "fill" || step.kind.startsWith("assert-")
        ? `screenshot_${screenshots.length + 1}`
        : undefined;

      if (screenshotId) {
        await captureScreenshot(step.id);
      }

      await fetchPageErrors();

      stepResults.push({
        id: step.id,
        instruction: step.instruction,
        kind: step.kind,
        status: stepPassed ? "passed" : "failed",
        durationMs,
        expected,
        actual,
        message: stepMessage,
        screenshotId: stepPassed || screenshots.some(s => s.stepId === step.id) ? screenshotId : undefined,
      });
    }
  } catch (err: unknown) {
    status = "error";
    const error = err as Error;
    return createBlockedResult(
      plan,
      `Internal browser provider error: ${error.message || error}`,
      startedAt,
      Date.now() - startTime
    );
  } finally {
    // Crucial Quality Gate: Always close the browser session in finally
    if (stagehand) {
      try {
        await stagehand.close();
      } catch (err) {
        console.error("Error closing Stagehand session:", err);
      }
    }
    if (sessionId) {
      try {
        await fetch(`https://api.steel.dev/v1/sessions/${sessionId}/release`, {
          method: "POST",
          headers: {
            "steel-api-key": steelApiKey || "",
          },
        });
      } catch (err) {
        console.error("Error releasing Steel session:", err);
      }
    }
  }

  const durationMs = Date.now() - startTime;
  return finalizeResult(
    plan,
    status,
    finalUrl,
    stepResults,
    screenshots,
    consoleMessages,
    pageErrors,
    failedRequests,
    startedAt,
    durationMs
  );
}

/**
 * Generates a standard result block for blocked/error runs.
 */
function createBlockedResult(
  plan: TestPlan,
  errorMessage: string,
  startedAt: string,
  durationMs: number = 0
): TestRunResult {
  return {
    id: `run_${Math.random().toString(36).substring(7)}`,
    title: plan.title,
    startUrl: plan.startUrl,
    finalUrl: plan.startUrl,
    viewport: plan.viewport,
    status: "blocked",
    startedAt,
    durationMs,
    plan: plan.steps,
    steps: plan.steps.map((step) => ({
      id: step.id,
      instruction: step.instruction,
      kind: step.kind,
      status: "skipped",
      durationMs: 0,
      message: "Step skipped due to setup/security block.",
    })),
    screenshots: [],
    consoleMessages: [],
    pageErrors: [
      {
        message: errorMessage,
        timestamp: new Date().toISOString(),
      },
    ],
    failedRequests: [],
    summary: {
      total: plan.steps.length,
      passed: 0,
      failed: 0,
      skipped: plan.steps.length,
    },
  };
}

/**
 * Combines collections into the final structured TestRunResult.
 */
function finalizeResult(
  plan: TestPlan,
  status: TestRunResult["status"],
  finalUrl: string,
  steps: StepResult[],
  screenshots: TestScreenshot[],
  consoleMessages: BrowserConsoleMessage[],
  pageErrors: BrowserPageError[],
  failedRequests: FailedNetworkRequest[],
  startedAt: string,
  durationMs: number
): TestRunResult {
  const passed = steps.filter((s) => s.status === "passed").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const skipped = plan.steps.length - passed - failed;

  return {
    id: `run_${Math.random().toString(36).substring(7)}`,
    title: plan.title,
    startUrl: plan.startUrl,
    finalUrl,
    viewport: plan.viewport,
    status: status === "passed" && failed > 0 ? "failed" : status,
    startedAt,
    durationMs,
    plan: plan.steps,
    steps,
    screenshots,
    consoleMessages,
    pageErrors,
    failedRequests,
    summary: {
      total: plan.steps.length,
      passed,
      failed,
      skipped,
    },
  };
}
