import { PlannedStep, PlannedStepKind, TestPlan, CONFIG_LIMITS } from "./schemas";

/**
 * Deterministically parses natural-language instructions into a structured TestPlan.
 * This ensures high speed, 0 inference cost, and works without credentials.
 */
export function generatePlanDeterministic(
  title: string,
  startUrl: string,
  viewport: "desktop" | "mobile",
  instructionsText: string
): TestPlan {
  const lines = instructionsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const steps: PlannedStep[] = [];

  for (let i = 0; i < Math.min(lines.length, CONFIG_LIMITS.maxPlannedSteps); i++) {
    const line = lines[i];
    const id = `step_${i + 1}`;
    let kind: PlannedStepKind = "click";
    let target = "";
    let value = "";

    const lowerLine = line.toLowerCase();

    if (
      lowerLine.startsWith("open") ||
      lowerLine.startsWith("navigate") ||
      lowerLine.startsWith("go to")
    ) {
      kind = "navigate";
      target = line.replace(/^(open|navigate to|go to)\s+/i, "");
    } else if (lowerLine.startsWith("click")) {
      kind = "click";
      target = line.replace(/^click\s+(on\s+)?(the\s+)?/i, "");
    } else if (lowerLine.startsWith("type") || lowerLine.startsWith("fill")) {
      kind = "fill";
      // E.g., Type "hello@example.com" into the email field
      const typeIntoMatch = line.match(/^(type|fill)\s+["']?([^"']+)["']?\s+into\s+(the\s+)?(.+)/i);
      // E.g., Fill the search field with "wireless headphones"
      const fillWithMatch = line.match(/^(type|fill)\s+(the\s+)?(.+)\s+with\s+["']?([^"']+)["']?/i);

      if (typeIntoMatch) {
        value = typeIntoMatch[2];
        target = typeIntoMatch[4];
      } else if (fillWithMatch) {
        target = fillWithMatch[3];
        value = fillWithMatch[4];
      } else {
        target = line.replace(/^(type|fill)\s+/i, "");
      }
    } else if (lowerLine.startsWith("press")) {
      kind = "press";
      value = line.replace(/^press\s+/i, "");
    } else if (lowerLine.startsWith("select")) {
      kind = "select";
      // E.g., Select "Philippines" from the country field
      const selectMatch = line.match(/^select\s+["']?([^"']+)["']?\s+from\s+(the\s+)?(.+)/i);
      if (selectMatch) {
        value = selectMatch[1];
        target = selectMatch[3];
      } else {
        target = line.replace(/^select\s+/i, "");
      }
    } else if (lowerLine.startsWith("scroll")) {
      kind = "scroll";
      target = line.replace(/^scroll\s+(to\s+)?/i, "");
    } else if (lowerLine.startsWith("wait")) {
      kind = "wait";
      target = line.replace(/^wait\s+(for\s+)?/i, "");
    } else if (lowerLine.startsWith("verify") || lowerLine.startsWith("assert")) {
      if (lowerLine.includes("url contains")) {
        kind = "assert-url";
        const match = line.match(/contains\s+["']?([^"']+)["']?/i);
        value = match ? match[1] : "";
      } else if (lowerLine.includes("title contains")) {
        kind = "assert-title";
        const match = line.match(/contains\s+["']?([^"']+)["']?/i);
        value = match ? match[1] : "";
      } else if (lowerLine.includes("enabled") || lowerLine.includes("is enabled")) {
        kind = "assert-enabled";
        target = line
          .replace(/^(verify|assert)\s+(that\s+)?(the\s+)?/i, "")
          .replace(/\s+(is\s+)?enabled$/i, "");
      } else if (
        lowerLine.includes("visible") ||
        lowerLine.includes("is visible") ||
        lowerLine.includes("appears")
      ) {
        kind = "assert-visible";
        target = line
          .replace(/^(verify|assert)\s+(that\s+)?(the\s+)?/i, "")
          .replace(/\s+(is\s+)?(visible|appears)$/i, "");
      } else {
        // check for quoted text in verify
        const textMatch = line.match(/["']([^"']+)["']/);
        if (textMatch) {
          kind = "assert-text";
          value = textMatch[1];
        } else {
          kind = "assert-visible";
          target = line.replace(/^(verify|assert)\s+(that\s+)?(the\s+)?/i, "");
        }
      }
    } else {
      kind = "click";
      target = line;
    }

    let cleanTarget = target ? target.trim() : undefined;
    let cleanValue = value ? value.trim() : undefined;

    if (cleanTarget) {
      if (
        (cleanTarget.startsWith('"') && cleanTarget.endsWith('"')) ||
        (cleanTarget.startsWith("'") && cleanTarget.endsWith("'"))
      ) {
        cleanTarget = cleanTarget.substring(1, cleanTarget.length - 1).trim();
      }
    }

    if (cleanValue) {
      if (
        (cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
        (cleanValue.startsWith("'") && cleanValue.endsWith("'"))
      ) {
        cleanValue = cleanValue.substring(1, cleanValue.length - 1).trim();
      }
    }

    steps.push({
      id,
      instruction: line,
      kind,
      target: cleanTarget || undefined,
      value: cleanValue || undefined,
    });
  }

  return {
    title,
    startUrl,
    viewport,
    steps,
  };
}

/**
 * Attempts to generate a structured test plan using Google Gemini API if credentials are present.
 * Otherwise, falls back to the deterministic parser.
 */
export async function generatePlan(
  title: string,
  startUrl: string,
  viewport: "desktop" | "mobile",
  instructionsText: string
): Promise<TestPlan> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return generatePlanDeterministic(title, startUrl, viewport, instructionsText);
  }

  try {
    const prompt = `You are a test planning assistant for FlowTest.
Convert the user's natural-language test instructions into a structured TestPlan.

Title: ${title}
Start URL: ${startUrl}
Viewport: ${viewport}

Instructions:
${instructionsText}

Constraints:
- Maximum ${CONFIG_LIMITS.maxPlannedSteps} steps.
- Set step "kind" to one of: "navigate", "click", "fill", "press", "select", "scroll", "wait", "assert-visible", "assert-text", "assert-url", "assert-title", "assert-enabled".
- Populate "target" for elements or selectors to target.
- Populate "value" for input values (like typing text, keys to press, options to select).
- Keep targets and values concise.

Respond only with the structured JSON output adhering to the schema.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                steps: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      id: { type: "STRING" },
                      instruction: { type: "STRING" },
                      kind: {
                        type: "STRING",
                        enum: [
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
                        ],
                      },
                      target: { type: "STRING" },
                      value: { type: "STRING" },
                    },
                    required: ["id", "instruction", "kind"],
                  },
                },
              },
              required: ["title", "steps"],
            },
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API returned status ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("No structured text response returned from Gemini API.");
    }

    const parsed = JSON.parse(text);
    return {
      title: parsed.title || title,
      startUrl,
      viewport,
      steps: (parsed.steps || []).slice(0, CONFIG_LIMITS.maxPlannedSteps).map((step: {
        id?: string;
        instruction?: string;
        kind?: string;
        target?: string;
        value?: string;
      }) => ({
        id: step.id || `step_${Math.random()}`,
        instruction: step.instruction || "",
        kind: (step.kind || "click") as PlannedStepKind,
        target: step.target || undefined,
        value: step.value || undefined,
      })),
    };
  } catch (error: unknown) {
    console.error("Failed to generate plan using Gemini API, falling back to deterministic parser:", (error as Error).message || error);
    return generatePlanDeterministic(title, startUrl, viewport, instructionsText);
  }
}
