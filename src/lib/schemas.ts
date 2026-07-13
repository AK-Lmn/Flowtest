import { z } from "zod";

// Centralized configuration constants
export const CONFIG_LIMITS = {
  maxUrlLength: 2048,
  maxInstructionLength: 1000,
  maxPlannedSteps: 10,
  maxBrowserActions: 6,
  maxAssertions: 6,
  maxValueLength: 200,
  maxRunDurationMs: 120000, // 2 minutes
  maxModelRetries: 2,
  maxScreenshotCount: 4,
  maxResponsePayloadSizeBytes: 5 * 1024 * 1024, // 5MB
};

export const ViewportPresetSchema = z.enum(["desktop", "mobile"]);
export type ViewportPreset = z.infer<typeof ViewportPresetSchema>;

export const PlannedStepKindSchema = z.enum([
  "navigate",
  "click",
  "fill",
  "press",
  "select",
  "scroll",
  "wait",
  "assert-visible",
  "assert-text",
  "assert-url",
  "assert-title",
  "assert-enabled",
]);
export type PlannedStepKind = z.infer<typeof PlannedStepKindSchema>;

export const PlannedStepSchema = z.object({
  id: z.string(),
  instruction: z.string().max(CONFIG_LIMITS.maxInstructionLength),
  kind: PlannedStepKindSchema,
  target: z.string().max(CONFIG_LIMITS.maxValueLength).optional(),
  value: z.string().max(CONFIG_LIMITS.maxValueLength).optional(),
  assertion: z.string().max(CONFIG_LIMITS.maxValueLength).optional(),
});
export type PlannedStep = z.infer<typeof PlannedStepSchema>;

export const TestPlanSchema = z.object({
  title: z.string().min(1).max(100),
  startUrl: z.string().url().max(CONFIG_LIMITS.maxUrlLength),
  viewport: ViewportPresetSchema,
  steps: z.array(PlannedStepSchema).max(CONFIG_LIMITS.maxPlannedSteps),
});
export type TestPlan = z.infer<typeof TestPlanSchema>;

// API request schema
export const TestRunRequestSchema = z.object({
  url: z.string().url().max(CONFIG_LIMITS.maxUrlLength),
  name: z.string().min(1).max(100),
  instructions: z.string().min(1).max(2000), // raw multi-line instructions
  viewport: ViewportPresetSchema,
});
export type TestRunRequest = z.infer<typeof TestRunRequestSchema>;

// Types for final reports
export interface TestScreenshot {
  id: string;
  stepId?: string;
  base64Data: string;
  contentType: string; // e.g. "image/jpeg"
  timestamp: string;
}

export interface BrowserConsoleMessage {
  type: string; // e.g. "log", "error", "warning"
  text: string;
  url?: string;
  line?: number;
}

export interface BrowserPageError {
  message: string;
  stack?: string;
  timestamp: string;
}

export interface FailedNetworkRequest {
  method: string;
  url: string; // sanitized
  resourceType: string;
  failureReason: string;
}

export interface StepResult {
  id: string;
  instruction: string;
  kind: PlannedStepKind;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  expected?: string;
  actual?: string;
  message: string;
  screenshotId?: string;
}

export interface TestRunResult {
  id: string;
  title: string;
  startUrl: string;
  finalUrl: string;
  viewport: ViewportPreset;
  status: "passed" | "failed" | "blocked" | "error";
  startedAt: string;
  durationMs: number;
  plan: PlannedStep[];
  steps: StepResult[];
  screenshots: TestScreenshot[];
  consoleMessages: BrowserConsoleMessage[];
  pageErrors: BrowserPageError[];
  failedRequests: FailedNetworkRequest[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  sessionReplayUrl?: string;
}
