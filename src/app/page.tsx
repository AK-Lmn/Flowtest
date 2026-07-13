"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Monitor,
  Smartphone,
  Download,
  Copy,
  RotateCcw,
  Plus,
  Lock,
  FileText,
} from "lucide-react";
import FlowTestMark from "@/components/FlowTestMark";
import {
  ViewportPreset,
  PlannedStep,
  TestRunResult,
  CONFIG_LIMITS,
} from "@/lib/schemas";

type AppPhase = "editing" | "running" | "report" | "error";

const EXAMPLES = [
  {
    name: "Homepage Smoke Test",
    url: "https://example.com",
    instructions: `Open the homepage
Verify that the page title contains "Example Domain"
Verify that "More information" is visible
Scroll to the footer`,
    viewport: "desktop" as const,
  },
  {
    name: "Navigation Link Test",
    url: "https://example.com",
    instructions: `Open the homepage
Click the "More information" link
Verify that the URL contains "iana.org"`,
    viewport: "desktop" as const,
  },
  {
    name: "Search Interaction",
    url: "https://example.com",
    instructions: `Open the homepage
Fill the search field with "testing tools"
Press Enter
Verify that "results" is visible`,
    viewport: "desktop" as const,
  },
  {
    name: "Form Validation",
    url: "https://example.com",
    instructions: `Open the homepage
Type "test@example.com" into the email field
Click the "Submit" button
Verify that the Continue button is visible`,
    viewport: "desktop" as const,
  },
  {
    name: "Missing-element Failure Example",
    url: "https://example.com",
    instructions: `Open the homepage
Verify that "Sign In" is visible
Click the missing "non-existent-button"`,
    viewport: "desktop" as const,
  },
];

export default function Home() {
  const [phase, setPhase] = useState<AppPhase>("editing");
  
  // Inputs state
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [viewport, setViewport] = useState<ViewportPreset>("desktop");

  // Running state
  const [stage, setStage] = useState("Validating URL");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [livePlan, setLivePlan] = useState<PlannedStep[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Result / Error state
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  
  // Report Filter state
  const [reportFilter, setReportFilter] = useState<"all" | "passed" | "failed" | "actions" | "assertions">("all");
  
  // Modals / Clipboard
  const [activeScreenshot, setActiveScreenshot] = useState<string | null>(null);
  const [copyingMarkdown, setCopyingMarkdown] = useState(false);
  const [copyingJson, setCopyingJson] = useState(false);

  // Timer Effect for Running Phase
  useEffect(() => {
    if (phase !== "running") return;
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleApplyExample = (ex: typeof EXAMPLES[0]) => {
    setUrl(ex.url);
    setName(ex.name);
    setInstructions(ex.instructions);
    setViewport(ex.viewport);
  };

  const handleRunTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !name || !instructions) return;

    setPhase("running");
    setStage("Validating URL");
    setErrorMessage("");
    setResult(null);

    // Initial plan preview before browser triggers
    const lines = instructions
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
      
    const initialPlan: PlannedStep[] = lines.slice(0, CONFIG_LIMITS.maxPlannedSteps).map((line, idx) => ({
      id: `step_${idx + 1}`,
      instruction: line,
      kind: line.toLowerCase().startsWith("verify") || line.toLowerCase().startsWith("assert")
        ? "assert-visible"
        : line.toLowerCase().startsWith("open") || line.toLowerCase().startsWith("navigate")
        ? "navigate"
        : "click",
    }));
    setLivePlan(initialPlan);

    abortControllerRef.current = new AbortController();

    try {
      setStage("Planning flow");
      
      const response = await fetch("/api/test-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name, instructions, viewport }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.error === "INVALID_REQUEST" || errorData.status === "blocked") {
          setErrorMessage(errorData.message || "Request was blocked by security filters.");
          setPhase("error");
          return;
        }
        throw new Error(errorData.message || "Failed to execute test run on cloud browser.");
      }

      const runResult: TestRunResult = await response.json();
      setResult(runResult);
      
      if (runResult.status === "blocked" || runResult.status === "error") {
        setErrorMessage(
          runResult.pageErrors?.[0]?.message || 
          "The run was blocked by environment limits or security checks."
        );
        setPhase("error");
      } else {
        setPhase("report");
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === "AbortError") {
        setErrorMessage("Test run was cancelled by user.");
      } else {
        setErrorMessage(error.message || "Internal network error communicating with server.");
      }
      setPhase("error");
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleCancelRun = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleCopyMarkdown = async () => {
    if (!result) return;
    setCopyingMarkdown(true);
    const md = generateMarkdownReport(result);
    await navigator.clipboard.writeText(md).catch(() => {});
    setTimeout(() => setCopyingMarkdown(false), 2000);
  };

  const handleDownloadJson = () => {
    if (!result) return;
    setCopyingJson(true);
    const jsonStr = JSON.stringify(result, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `${result.title.toLowerCase().replace(/\s+/g, "_")}_report.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
    setTimeout(() => setCopyingJson(false), 2000);
  };

  // Filtered Step Results
  const filteredSteps = result
    ? result.steps.filter((step) => {
        if (reportFilter === "all") return true;
        if (reportFilter === "passed") return step.status === "passed";
        if (reportFilter === "failed") return step.status === "failed";
        const isAssert = step.kind.startsWith("assert-");
        if (reportFilter === "actions") return !isAssert;
        if (reportFilter === "assertions") return isAssert;
        return true;
      })
    : [];

  return (
    <div className="flex-1 flex flex-col max-w-full overflow-x-hidden">
      {/* Header */}
      <header className="border-b border-[#232d42] bg-[#111622] py-4 px-4 sm:px-6">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <FlowTestMark size={32} />
            <div>
              <div className="flex items-baseline space-x-2">
                <span className="text-xl font-bold tracking-tight text-white">Flow<span className="text-emerald-500">Test</span></span>
                <span className="hidden sm:inline text-xs text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700">MVP</span>
              </div>
              <p className="text-xs text-slate-400">Natural-language browser testing</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-400 bg-[#161b26] border border-[#232d42] px-3 py-1.5 rounded-lg">
            <Lock className="h-3 w-3 text-emerald-500" />
            <span>Temporary Cloud Browser</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 flex flex-col justify-center">
        {/* ==================================================== */}
        {/* PHASE 1: EDITING STATE */}
        {/* ==================================================== */}
        {phase === "editing" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Form Input */}
            <section className="lg:col-span-8 bg-[#161b26] border border-[#232d42] rounded-xl p-6 shadow-xl">
              <h1 className="text-2xl font-bold text-white mb-2">Create New Flow Test</h1>
              <p className="text-sm text-slate-400 mb-6">
                “Describe the flow. Watch it prove itself.”
              </p>

              <form onSubmit={handleRunTest} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Name field */}
                  <div>
                    <label htmlFor="test-name" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Test Name
                    </label>
                    <input
                      id="test-name"
                      type="text"
                      required
                      placeholder="e.g. Authentication Validation"
                      value={name}
                      onChange={(e) => setName(e.target.value.slice(0, 100))}
                      className="w-full bg-[#0b0f19] border border-[#232d42] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  {/* URL field */}
                  <div>
                    <label htmlFor="url" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Target Website URL
                    </label>
                    <input
                      id="url"
                      type="url"
                      required
                      placeholder="https://example.com"
                      value={url}
                      onChange={(e) => setUrl(e.target.value.slice(0, CONFIG_LIMITS.maxUrlLength))}
                      className="w-full bg-[#0b0f19] border border-[#232d42] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                {/* Viewport Preset */}
                <div>
                  <span className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Viewport Dimension
                  </span>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setViewport("desktop")}
                      className={`flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${
                        viewport === "desktop"
                          ? "bg-emerald-950/45 border-emerald-500 text-emerald-400"
                          : "bg-[#0b0f19] border-[#232d42] text-slate-400 hover:text-white"
                      }`}
                    >
                      <Monitor className="h-4 w-4" />
                      <span>Desktop (1280×720)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewport("mobile")}
                      className={`flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${
                        viewport === "mobile"
                          ? "bg-emerald-950/45 border-emerald-500 text-emerald-400"
                          : "bg-[#0b0f19] border-[#232d42] text-slate-400 hover:text-white"
                      }`}
                    >
                      <Smartphone className="h-4 w-4" />
                      <span>Mobile (390×844)</span>
                    </button>
                  </div>
                </div>

                {/* Instructions Textarea */}
                <div>
                  <label htmlFor="instructions" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Flow Instructions (one step per line)
                  </label>
                  <textarea
                    id="instructions"
                    required
                    rows={6}
                    placeholder={`e.g.\nOpen the homepage\nClick the Sign in button\nVerify that the login form appears\nType test@example.com into the email field`}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value.slice(0, 2000))}
                    className="w-full bg-[#0b0f19] border border-[#232d42] rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="flex justify-between items-center mt-2 text-xs text-slate-500">
                    <span>Supports navigations, clicks, text entries, and assertions.</span>
                    <span>Max 10 steps</span>
                  </div>
                </div>

                {/* Submit Action */}
                <button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-lg flex items-center justify-center space-x-2 cursor-pointer transition-all shadow-lg hover:shadow-emerald-900/30"
                >
                  <Play className="h-4 w-4 fill-current" />
                  <span>Run Flow Test</span>
                </button>
              </form>

              {/* Safety limitations note */}
              <div className="mt-6 border-t border-[#232d42] pt-4 flex items-start space-x-3 text-xs text-slate-400">
                <Lock className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <p>
                  <strong>Privacy Note:</strong> FlowTest runs tests in a temporary cloud browser. Do not enter passwords, private tokens, or personal account data. Only test public websites you own or are authorized to test.
                </p>
              </div>
            </section>

            {/* Right Column: Examples */}
            <aside className="lg:col-span-4 space-y-6">
              <div className="bg-[#161b26] border border-[#232d42] rounded-xl p-6 shadow-xl">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center space-x-2">
                  <FileText className="h-4 w-4 text-emerald-500" />
                  <span>Quick Templates</span>
                </h2>
                <div className="space-y-3">
                  {EXAMPLES.map((ex, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleApplyExample(ex)}
                      className="w-full text-left bg-[#0b0f19] hover:bg-[#1a2130] border border-[#232d42] hover:border-emerald-500/50 rounded-lg p-3 transition-all group"
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-semibold text-white group-hover:text-emerald-400 transition-colors">
                          {ex.name}
                        </span>
                        <Plus className="h-3.5 w-3.5 text-slate-500 group-hover:text-emerald-400" />
                      </div>
                      <span className="text-[11px] text-slate-500 truncate block">
                        Target: {ex.url}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* ==================================================== */}
        {/* PHASE 2: RUNNING STATE */}
        {/* ==================================================== */}
        {phase === "running" && (
          <div className="mx-auto max-w-2xl w-full bg-[#161b26] border border-[#232d42] rounded-xl p-8 shadow-xl text-center space-y-8">
            <div className="space-y-3">
              <div className="relative inline-flex justify-center items-center">
                <div className="animate-ping absolute inline-flex h-12 w-12 rounded-full bg-emerald-500 opacity-20"></div>
                <div className="h-10 w-10 rounded-full bg-emerald-950 border border-emerald-500 flex items-center justify-center text-emerald-400 font-bold">
                  FT
                </div>
              </div>
              <h2 className="text-xl font-bold text-white">Browser Testing In Progress</h2>
              <div className="text-xs text-slate-400 flex items-center justify-center space-x-2">
                <span>Viewport:</span>
                <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700 font-mono capitalize">
                  {viewport}
                </span>
                <span>•</span>
                <span>Elapsed:</span>
                <span className="text-emerald-400 font-mono font-semibold">{elapsedTime}s</span>
              </div>
              <p className="text-sm text-slate-300 font-mono bg-[#0b0f19] border border-[#232d42] px-4 py-2.5 rounded-lg inline-block break-all max-w-full">
                Target: {url}
              </p>
            </div>

            {/* Bounded progress step list */}
            <div className="border-t border-b border-[#232d42] py-4 text-left space-y-2.5">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Running Stage: <span className="text-emerald-400 normal-case">{stage}...</span>
              </span>
              <div className="space-y-1.5 font-mono text-xs max-h-48 overflow-y-auto pr-2">
                {livePlan.map((step, idx) => (
                  <div key={idx} className="flex items-center justify-between text-slate-400 py-1">
                    <span className="truncate max-w-[80%]">
                      {idx + 1}. {step.instruction}
                    </span>
                    <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded uppercase">
                      Planned
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center space-y-3">
              <span className="text-xs text-slate-500">
                FlowTest is running this test in a temporary Steel cloud browser.
              </span>
              <button
                type="button"
                onClick={handleCancelRun}
                className="bg-red-950/40 hover:bg-red-900/60 border border-red-900/80 text-red-300 hover:text-red-200 text-xs px-5 py-2.5 rounded-lg transition-colors cursor-pointer"
              >
                Cancel Test Run
              </button>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* PHASE 3: ERROR STATE */}
        {/* ==================================================== */}
        {phase === "error" && (
          <div className="mx-auto max-w-xl w-full bg-[#161b26] border border-[#232d42] rounded-xl p-8 shadow-xl text-center space-y-6">
            <div className="mx-auto h-12 w-12 rounded-full bg-red-950/50 border border-red-500/80 flex items-center justify-center text-red-500">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">Execution Encountered An Issue</h2>
              <p className="text-sm text-slate-400">
                The flow execution could not be completed successfully.
              </p>
            </div>

            <div className="bg-red-950/20 border border-red-900/60 rounded-lg p-4 text-left font-mono text-xs text-red-300 break-words whitespace-pre-wrap max-w-full">
              {errorMessage}
            </div>

            {/* Check for missing environment credentials to offer a friendly help state */}
            {(errorMessage.includes("STEEL_API_KEY") || errorMessage.includes("GEMINI_API_KEY")) && (
              <div className="border border-slate-800 bg-slate-900/60 rounded-lg p-4 text-left space-y-2 text-xs text-slate-400">
                <span className="font-bold text-slate-200 uppercase tracking-wide">Developer Setup Help</span>
                <p>To run real cloud tests, create a file named <code className="bg-slate-800 px-1 py-0.5 rounded text-white">.env.local</code> in the root folder and add:</p>
                <pre className="bg-slate-950 p-2.5 rounded font-mono text-emerald-400">STEEL_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here</pre>
              </div>
            )}

            <div className="flex gap-4">
              <button
                onClick={() => setPhase("editing")}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors cursor-pointer"
              >
                Modify Settings
              </button>
              <button
                onClick={handleRunTest}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg text-sm transition-colors cursor-pointer"
              >
                Retry Execution
              </button>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* PHASE 4: REPORT STATE */}
        {/* ==================================================== */}
        {phase === "report" && result && (
          <div className="space-y-8 animate-fadeIn">
            {/* Banner Result Summary */}
            <section
              className={`border rounded-xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6 ${
                result.status === "passed"
                  ? "bg-emerald-950/20 border-emerald-500/40"
                  : result.status === "failed"
                  ? "bg-red-950/20 border-red-500/40"
                  : "bg-amber-950/20 border-amber-500/40"
              }`}
            >
              <div className="flex items-center space-x-4">
                {result.status === "passed" ? (
                  <CheckCircle2 className="h-12 w-12 text-emerald-500 shrink-0" />
                ) : result.status === "failed" ? (
                  <XCircle className="h-12 w-12 text-red-500 shrink-0" />
                ) : (
                  <AlertTriangle className="h-12 w-12 text-amber-500 shrink-0" />
                )}
                <div>
                  <h1 className="text-xl font-bold text-white capitalize">
                    Test run {result.status}
                  </h1>
                  <p className="text-sm text-slate-300 font-mono truncate max-w-lg break-all">
                    URL: {result.startUrl}
                  </p>
                </div>
              </div>
              
              {/* Counts */}
              <div className="flex items-center space-x-6">
                <div className="text-center">
                  <span className="block text-2xl font-bold text-white">{result.summary.passed}</span>
                  <span className="text-[10px] uppercase font-bold tracking-wide text-slate-400">Passed</span>
                </div>
                <div className="h-8 w-px bg-[#232d42]"></div>
                <div className="text-center">
                  <span className="block text-2xl font-bold text-white">{result.summary.failed}</span>
                  <span className="text-[10px] uppercase font-bold tracking-wide text-slate-400">Failed</span>
                </div>
                <div className="h-8 w-px bg-[#232d42]"></div>
                <div className="text-center">
                  <span className="block text-2xl font-bold text-white">{result.summary.skipped}</span>
                  <span className="text-[10px] uppercase font-bold tracking-wide text-slate-400">Skipped</span>
                </div>
              </div>
            </section>

            {/* Run details cards grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-[#161b26] border border-[#232d42] p-4 rounded-xl">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Viewport</span>
                <span className="text-sm font-semibold text-white capitalize mt-1 block">{result.viewport} preset</span>
              </div>
              <div className="bg-[#161b26] border border-[#232d42] p-4 rounded-xl">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Duration</span>
                <span className="text-sm font-semibold text-white mt-1 block">{(result.durationMs / 1000).toFixed(2)}s</span>
              </div>
              <div className="bg-[#161b26] border border-[#232d42] p-4 rounded-xl md:col-span-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Final Location</span>
                <span className="text-sm font-semibold text-white mt-1 block truncate max-w-full font-mono text-emerald-400" title={result.finalUrl}>
                  {result.finalUrl}
                </span>
              </div>
            </div>

            {/* Detailed results tabs */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left Side: Step results */}
              <section className="lg:col-span-8 space-y-6">
                <div className="bg-[#161b26] border border-[#232d42] rounded-xl p-6 shadow-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#232d42] pb-4 mb-6 gap-4">
                    <h2 className="text-base font-bold text-white uppercase tracking-wider">Step Results</h2>
                    
                    {/* Filters */}
                    <div className="flex flex-wrap gap-1.5">
                      {(["all", "passed", "failed", "actions", "assertions"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setReportFilter(f)}
                          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
                            reportFilter === f
                              ? "bg-emerald-600 text-white"
                              : "bg-[#0b0f19] border border-[#232d42] text-slate-400 hover:text-white"
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Steps execution flow */}
                  <div className="space-y-4">
                    {filteredSteps.length === 0 ? (
                      <p className="text-sm text-slate-500 py-6 text-center">No steps matched the selected filter.</p>
                    ) : (
                      filteredSteps.map((step, idx) => (
                        <div
                          key={step.id}
                          className="bg-[#0b0f19] border border-[#232d42] rounded-lg p-4 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start space-x-3">
                              <span className="text-xs font-mono font-bold text-slate-500 mt-0.5">
                                #{idx + 1}
                              </span>
                              <div>
                                <p className="text-sm font-semibold text-white">{step.instruction}</p>
                                <div className="flex items-center space-x-2 mt-1">
                                  <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded uppercase font-mono">
                                    {step.kind}
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-mono">
                                    {step.durationMs}ms
                                  </span>
                                </div>
                              </div>
                            </div>
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                                step.status === "passed"
                                  ? "bg-emerald-950/80 border border-emerald-500/50 text-emerald-400"
                                  : step.status === "failed"
                                  ? "bg-red-950/80 border border-red-500/50 text-red-400"
                                  : "bg-slate-800 border border-slate-700 text-slate-400"
                              }`}
                            >
                              {step.status}
                            </span>
                          </div>

                          {/* Message / Expected & Actual values */}
                          <div className="text-xs space-y-1 bg-slate-900/60 p-2.5 rounded border border-slate-800 font-mono">
                            {step.expected && (
                              <p className="text-slate-400">
                                <span className="font-bold text-slate-500">Expected:</span> {step.expected}
                              </p>
                            )}
                            {step.actual && (
                              <p className="text-slate-400">
                                <span className="font-bold text-slate-500">Actual:</span> {step.actual}
                              </p>
                            )}
                            <p className={step.status === "failed" ? "text-red-300" : "text-slate-300"}>
                              <span className="font-bold text-slate-500">Details:</span> {step.message}
                            </p>
                            {step.screenshotId && (
                              <button
                                onClick={() => setActiveScreenshot(step.screenshotId!)}
                                className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold underline block mt-2 cursor-pointer"
                              >
                                View Step Screenshot
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Screenshots collection */}
                {result.screenshots.length > 0 && (
                  <div className="bg-[#161b26] border border-[#232d42] rounded-xl p-6 shadow-xl space-y-4">
                    <h2 className="text-base font-bold text-white uppercase tracking-wider">Captured Screenshots</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {result.screenshots.map((s) => (
                        <div
                          key={s.id}
                          onClick={() => setActiveScreenshot(s.id)}
                          className="bg-[#0b0f19] border border-[#232d42] rounded-lg overflow-hidden cursor-pointer hover:border-emerald-500 transition-all relative group"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={s.base64Data}
                            alt={`Step screenshot ${s.id}`}
                            className="w-full h-24 object-cover object-top opacity-80 group-hover:opacity-100 transition-opacity"
                          />
                          <div className="absolute bottom-0 inset-x-0 bg-slate-950/80 p-1.5 text-[9px] text-slate-400 font-mono text-center truncate">
                            {s.stepId ? `Step ${s.stepId.replace("step_", "")}` : "Init"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Right Side: Diagnostics & Export */}
              <aside className="lg:col-span-4 space-y-6">
                {/* Actions Panel */}
                <div className="bg-[#161b26] border border-[#232d42] rounded-xl p-6 shadow-xl space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Report Actions</h2>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={handleCopyMarkdown}
                      className="w-full bg-[#0b0f19] hover:bg-[#1f2636] border border-[#232d42] hover:border-emerald-500 text-slate-300 hover:text-white py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span>{copyingMarkdown ? "Copied!" : "Copy Markdown Report"}</span>
                    </button>
                    <button
                      onClick={handleDownloadJson}
                      className="w-full bg-[#0b0f19] hover:bg-[#1f2636] border border-[#232d42] hover:border-emerald-500 text-slate-300 hover:text-white py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>{copyingJson ? "Downloaded!" : "Download JSON"}</span>
                    </button>
                    <div className="h-px bg-[#232d42] my-1"></div>
                    <button
                      onClick={handleRunTest}
                      className="w-full bg-[#1e293b] hover:bg-[#334155] border border-slate-700 text-slate-300 hover:text-white py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Retry Test</span>
                    </button>
                    <button
                      onClick={() => {
                        setResult(null);
                        setPhase("editing");
                      }}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Start New Test</span>
                    </button>
                  </div>
                </div>

                {/* Diagnostics Panel */}
                <div className="bg-[#161b26] border border-[#232d42] rounded-xl p-6 shadow-xl space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Browser Diagnostics</h2>
                  
                  {/* Console Messages */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      Console Messages ({result.consoleMessages.length})
                    </span>
                    <div className="bg-[#0b0f19] border border-[#232d42] rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-[10px] space-y-1.5">
                      {result.consoleMessages.length === 0 ? (
                        <p className="text-slate-500">No console logs captured.</p>
                      ) : (
                        result.consoleMessages.map((msg, i) => (
                          <p key={i} className="text-slate-400 break-words whitespace-pre-wrap">
                            <span className={`font-bold uppercase mr-1 ${
                              msg.type === "error" ? "text-red-400" : msg.type === "warning" ? "text-amber-400" : "text-sky-400"
                            }`}>
                              [{msg.type}]
                            </span>
                            {msg.text}
                          </p>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Page Errors */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      Page Errors ({result.pageErrors.length})
                    </span>
                    <div className="bg-[#0b0f19] border border-[#232d42] rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-[10px] space-y-1.5">
                      {result.pageErrors.length === 0 ? (
                        <p className="text-slate-500">0 page errors detected.</p>
                      ) : (
                        result.pageErrors.map((err, i) => (
                          <div key={i} className="text-red-300 break-words">
                            <p className="font-semibold">{err.message}</p>
                            {err.stack && <p className="text-slate-500 mt-1 text-[9px] truncate">{err.stack}</p>}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Failed Network Requests */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      Failed Network Requests ({result.failedRequests.length})
                    </span>
                    <div className="bg-[#0b0f19] border border-[#232d42] rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-[10px] space-y-1.5">
                      {result.failedRequests.length === 0 ? (
                        <p className="text-slate-500">0 network requests failed.</p>
                      ) : (
                        result.failedRequests.map((req, i) => (
                          <div key={i} className="text-slate-400 border-b border-[#232d42] pb-1.5 last:border-0">
                            <div className="flex justify-between items-baseline text-[9px] text-red-400 font-bold uppercase">
                              <span>{req.method} ({req.resourceType})</span>
                            </div>
                            <p className="text-[10px] text-slate-300 truncate font-mono mt-0.5" title={req.url}>
                              {req.url}
                            </p>
                            <span className="text-[9px] text-slate-500">Reason: {req.failureReason}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>

      {/* Footer Disclaimer */}
      <footer className="border-t border-[#232d42] bg-[#0b0f19] py-6 px-4 text-center text-xs text-slate-500">
        <p>© {new Date().getFullYear()} FlowTest. Bounded cloud browser testing. All rights reserved.</p>
        <p className="mt-1">
          Temporary cloud sessions are released after each run.
        </p>
      </footer>

      {/* Screenshot Full Screen Modal */}
      {activeScreenshot && result && (
        <div
          onClick={() => setActiveScreenshot(null)}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-[#161b26] border border-[#232d42] rounded-xl max-w-4xl w-full p-4 relative flex flex-col items-center">
            <button
              onClick={() => setActiveScreenshot(null)}
              className="absolute top-3 right-3 text-slate-400 hover:text-white text-xs bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer"
            >
              Close
            </button>
            <div className="w-full text-center mb-2">
              <span className="text-xs font-mono font-bold text-emerald-400">
                {activeScreenshot.startsWith("screenshot_")
                  ? `Screenshot ${activeScreenshot.replace("screenshot_", "")}`
                  : "Screenshot"}
              </span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.screenshots.find((s) => s.id === activeScreenshot)?.base64Data || ""}
              alt="Screenshot Zoom"
              className="max-h-[75vh] object-contain rounded-lg border border-slate-800"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Markdown export generator helper function
function generateMarkdownReport(result: TestRunResult): string {
  const stepsMd = result.steps
    .map(
      (s, idx) =>
        `| ${idx + 1} | ${s.instruction} | ${s.kind} | **${s.status.toUpperCase()}** | ${s.durationMs}ms | ${s.message} |`
    )
    .join("\n");

  const consoleMd = result.consoleMessages
    .slice(0, 10)
    .map((c) => `- [${c.type.toUpperCase()}] ${c.text}`)
    .join("\n") || "No console messages.";

  const errorsMd = result.pageErrors
    .slice(0, 10)
    .map((e) => `- ${e.message}`)
    .join("\n") || "0 page errors.";

  const failedNetMd = result.failedRequests
    .slice(0, 10)
    .map((f) => `- [${f.method}] (${f.resourceType}) ${f.url} -> ${f.failureReason}`)
    .join("\n") || "0 failed requests.";

  return `# FlowTest Report: ${result.title}

## Summary
- **Target URL:** ${result.startUrl}
- **Final URL:** ${result.finalUrl}
- **Status:** **${result.status.toUpperCase()}**
- **Viewport:** ${result.viewport}
- **Total Duration:** ${(result.durationMs / 1000).toFixed(2)}s
- **Pass Rate:** ${result.summary.passed} / ${result.summary.total} steps passed

### Step Results
| # | Step | Kind | Status | Duration | Details |
|---|------|------|--------|----------|---------|
${stepsMd}

### Browser Console Logs (Top 10)
${consoleMd}

### Uncaught Page Errors
${errorsMd}

### Failed Network Requests
${failedNetMd}

---
*Report generated securely by FlowTest (Describe the flow. Watch it prove itself).*
`;
}
