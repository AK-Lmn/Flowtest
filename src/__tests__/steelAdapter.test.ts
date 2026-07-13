import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { runTestPlan } from "@/lib/browserAdapter";
import { generatePlanDeterministic } from "@/lib/planGenerator";
import { Stagehand } from "@browserbasehq/stagehand";

const mockPage = {
  setViewportSize: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  route: vi.fn().mockResolvedValue(undefined),
  goto: vi.fn().mockResolvedValue(undefined),
  act: vi.fn().mockResolvedValue(undefined),
  extract: vi.fn().mockResolvedValue(true),
  url: vi.fn().mockReturnValue("https://example.com/dashboard"),
  title: vi.fn().mockResolvedValue("Dashboard"),
  screenshot: vi.fn().mockResolvedValue(Buffer.from("mock-screenshot-bytes")),
  addInitScript: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn().mockResolvedValue([]),
  keyPress: vi.fn().mockResolvedValue(undefined),
  waitForSelector: vi.fn().mockResolvedValue(true),
};

// Mock Stagehand
vi.mock("@browserbasehq/stagehand", () => {
  class MockStagehand {
    init = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    context = {
      activePage: vi.fn().mockImplementation(() => mockPage),
      pages: vi.fn().mockImplementation(() => [mockPage]),
      newPage: vi.fn().mockImplementation(() => Promise.resolve(mockPage)),
      setActivePage: vi.fn(),
      addInitScript: vi.fn().mockResolvedValue(undefined),
    };
  }

  return {
    Stagehand: vi.fn().mockImplementation(function () {
      return new MockStagehand();
    }),
  };
});

// Mock DNS lookup so validateUrl doesn't trigger network call
vi.mock("dns", () => ({
  default: {
    promises: {
      lookup: vi.fn().mockResolvedValue({ address: "104.244.42.1", family: 4 }),
    },
  },
}));

describe("Steel Stagehand execution adapter tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.MOCK_BROWSER;
    delete process.env.STEEL_API_KEY;
    delete process.env.GEMINI_API_KEY;
    
    // Mock global fetch
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/sessions") && !url.includes("/release")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "steel_session_123", websocketUrl: "wss://connect.steel.dev?sessionId=steel_session_123" }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve("OK"),
        json: () => Promise.resolve({ status: "released" }),
      } as Response);
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should fail validation if STEEL_API_KEY is missing", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    
    const plan = generatePlanDeterministic("Test", "https://example.com", "desktop", "Click the button");
    const result = await runTestPlan(plan);
    
    expect(result.status).toBe("blocked");
    expect(result.pageErrors[0].message).toContain("STEEL_API_KEY is not configured");
  });

  it("should fail validation if GEMINI_API_KEY is missing", async () => {
    process.env.STEEL_API_KEY = "test-steel-key";
    
    const plan = generatePlanDeterministic("Test", "https://example.com", "desktop", "Click the button");
    const result = await runTestPlan(plan);
    
    expect(result.status).toBe("blocked");
    expect(result.pageErrors[0].message).toContain("GEMINI_API_KEY is not configured");
  });

  it("should execute successfully and cleanly when both keys are provided", async () => {
    process.env.STEEL_API_KEY = "test-steel-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    
    const plan = generatePlanDeterministic("Test", "https://example.com", "desktop", "Click the button");
    const result = await runTestPlan(plan);
    
    // Verify results
    expect(result.status).toBe("passed");
    expect(result.pageErrors).toHaveLength(0);
    
    // Check that fetch was called to create Steel session
    expect(globalThis.fetch).toHaveBeenCalledWith("https://api.steel.dev/v1/sessions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "steel-api-key": "test-steel-key",
      }),
    }));

    // Check Stagehand instantiation parameters
    const stagehandConstructorArgs = (Stagehand as unknown as Mock).mock.calls[0][0];
    expect(stagehandConstructorArgs.env).toBe("LOCAL");
    expect(stagehandConstructorArgs.localBrowserLaunchOptions.cdpUrl).toContain("wss://connect.steel.dev");
    expect(stagehandConstructorArgs.localBrowserLaunchOptions.cdpUrl).toContain("apiKey=test-steel-key");
    expect(stagehandConstructorArgs.model.modelName).toBe("google/gemini-2.5-flash");
    expect(stagehandConstructorArgs.model.apiKey).toBe("test-gemini-key");

    // Check that Stagehand's close was called
    const stagehandInstance = (Stagehand as unknown as Mock).mock.results[0].value;
    expect(stagehandInstance.close).toHaveBeenCalled();

    // Check that Steel's release session API was called
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.steel.dev/v1/sessions/steel_session_123/release",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "steel-api-key": "test-steel-key",
        }),
      })
    );
  });

  it("should ensure cleanup release and close are called even if execution throws an error", async () => {
    process.env.STEEL_API_KEY = "test-steel-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";

    // Setup stagehand to fail on init
    class MockStagehandFailure {
      init = vi.fn().mockRejectedValue(new Error("Stagehand connection timed out"));
      close = vi.fn().mockResolvedValue(undefined);
      context = {
        activePage: vi.fn().mockReturnValue({}),
        pages: vi.fn().mockReturnValue([]),
        newPage: vi.fn().mockResolvedValue({}),
        setActivePage: vi.fn(),
        addInitScript: vi.fn().mockResolvedValue(undefined),
      };
    }

    vi.mocked(Stagehand).mockImplementationOnce(function () {
      return new MockStagehandFailure() as unknown as Stagehand;
    });

    const plan = generatePlanDeterministic("Test", "https://example.com", "desktop", "Click the button");
    const result = await runTestPlan(plan);

    expect(result.status).toBe("blocked");
    
    // Verify cleanup was still executed
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.steel.dev/v1/sessions/steel_session_123/release",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("should not leak credentials or cdpUrl in response payloads", async () => {
    process.env.STEEL_API_KEY = "test-steel-key-super-secret";
    process.env.GEMINI_API_KEY = "test-gemini-key-super-secret";

    const plan = generatePlanDeterministic("Test", "https://example.com", "desktop", "Click the button");
    const result = await runTestPlan(plan);

    const payloadStr = JSON.stringify(result);
    expect(payloadStr).not.toContain("test-steel-key-super-secret");
    expect(payloadStr).not.toContain("test-gemini-key-super-secret");
    expect(payloadStr).not.toContain("wss://connect.steel.dev");
    expect(payloadStr).not.toContain("steel_session_123");
  });

  it("should never register pageerror, requestfailed, or page.route listeners, and only register console on page", async () => {
    process.env.STEEL_API_KEY = "test-steel-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const plan = generatePlanDeterministic("Test", "https://example.com", "desktop", "Click the button");
    await runTestPlan(plan);

    const onMock = mockPage.on;
    const events = onMock.mock.calls.map((call) => call[0]);
    expect(events).toContain("console");
    expect(events).not.toContain("pageerror");
    expect(events).not.toContain("requestfailed");
    expect(mockPage.route).not.toHaveBeenCalled();
  });

  it("should stop execution and return blocked status when navigating to cross-origin", async () => {
    process.env.STEEL_API_KEY = "test-steel-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";

    mockPage.url.mockReturnValueOnce("https://example.com") // Initial page.goto
               .mockReturnValueOnce("https://example.com") // Initial validation
               .mockReturnValueOnce("https://example.com") // step 1 start check
               .mockReturnValueOnce("https://malicious-external-site.com"); // step 1 action complete check

    const plan = {
      title: "Test Blocked Navigation",
      startUrl: "https://example.com",
      viewport: "desktop" as const,
      steps: [
        { id: "step_1", instruction: "Click the link", kind: "click" as const },
        { id: "step_2", instruction: "Fill the form", kind: "fill" as const }
      ]
    };

    const result = await runTestPlan(plan);
    expect(result.status).toBe("blocked");
    expect(result.steps[0].message).toContain("The test was stopped because the browser attempted to leave the approved website.");
    expect(result.steps[1].status).toBe("skipped");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.steel.dev/v1/sessions/steel_session_123/release",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("should block execution when multiple pages/tabs are detected in the context", async () => {
    process.env.STEEL_API_KEY = "test-steel-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";

    vi.mocked(Stagehand).mockImplementationOnce(function () {
      class MockStagehandMultiPage {
        init = vi.fn().mockResolvedValue(undefined);
        close = vi.fn().mockResolvedValue(undefined);
        context = {
          activePage: vi.fn().mockImplementation(() => mockPage),
          pages: vi.fn().mockImplementation(() => [mockPage, mockPage]),
          newPage: vi.fn().mockImplementation(() => Promise.resolve(mockPage)),
          setActivePage: vi.fn(),
          addInitScript: vi.fn().mockResolvedValue(undefined),
        };
      }
      return new MockStagehandMultiPage() as unknown as Stagehand;
    });

    const plan = generatePlanDeterministic("Test", "https://example.com", "desktop", "Click the button");
    const result = await runTestPlan(plan);
    expect(result.status).toBe("blocked");
    expect(result.pageErrors[0].message).toContain("The test was stopped because the browser attempted to leave the approved website.");
  });
});
