# FlowTest

> Describe the flow. Watch it prove itself.

FlowTest is a natural-language browser flow tester for developers and students. It converts plain-English instructions into a bounded, structured test plan, executes it in an isolated cloud browser via Stagehand and Steel, and generates a detailed report complete with screenshots, console logs, and network diagnostics.

---

## The Problem & MVP Goal

Writing and maintaining browser automation tests (like Playwright or Cypress) is complex, time-consuming, and hard to teach. 

**FlowTest** solves this by letting users write tests in natural language.
- **Input:** A public website URL, a short test name, and step-by-step plain English instructions.
- **Output:** A structured, easy-to-read report proving if the flow succeeded, with visual and technical diagnostics.

This MVP is built to run autonomously on server infrastructure without storing credentials, accounts, or persistent histories.

---

## Key Features

- **Plain-English Flow Input:** Write instructions like *"Click the Sign in button"* or *"Verify that the Continue button is visible"*.
- **Structured Test Planning:** Pre-validates instructions and converts them into a strict, typed schema before execution.
- **Safe URL & SSRF Protection:** Enforces HTTP/HTTPS protocols, resolves hostnames server-side, blocks localhost, private network ranges (RFC 1918, RFC 4193), and limits browser execution strictly to the start origin.
- **Cloud-Native Execution:** Runs headlessly via Stagehand v3 on Steel cloud sessions.
- **Rich Diagnostics:** Captures console logs, unhandled page errors, failed network requests (with redacted sensitive parameters), and up to 4 high-resolution screenshots.
- **Zero-Storage Privacy:** Keeps all results, screenshots, and logs purely in-memory/in-session on the client side.
- **Export Formats:** Copy Markdown test reports or download structured JSON.

---

## Architecture & Test Planning Flow

FlowTest is built on the following stack:
1. **Next.js (App Router) & TypeScript:** Core React application framework.
2. **Tailwind CSS:** Modern styling using a slate/emerald theme.
3. **Zod:** Runtime validation for plans, requests, and extraction schemas.
4. **Stagehand v3:** AI-native browser automation library running on Chrome DevTools Protocol (CDP).
5. **Steel:** Headless cloud browser infrastructure.
6. **Google Gemini:** Inference engine for Stagehand's natural-language actions.
7. **Vitest & React Testing Library:** Fast, mocked test runner.

### Execution Flow:
```
[User Form Entry]
      │
      ▼
[API Route Safety Checks]  ──► (Validates Protocol, DNS, Public IP, Port, Origin)
      │
      ▼
[Plan Generator]           ──► (Translates text steps to JSON schemas via Rule-Engine / Gemini)
      │
      ▼
[Cloud Browser (Steel)]    ──► (Stagehand Page opens, binds routing to origin, executes steps)
      │
      ▼
[Diagnostics Collection]   ──► (Filters logs, exceptions, failed network requests, screenshots)
      │
      ▼
[Report Generation]        ──► (Normalized TestRunResult returned to client)
```

---

## Environment Variables

Create a `.env.local` file in the root directory:

```bash
# Required for live cloud browser execution
STEEL_API_KEY=your_steel_api_key
GEMINI_API_KEY=your_gemini_api_key

# Optional: Run local testing with simulated browser actions (requires no keys)
MOCK_BROWSER=false
```

---

## Local Setup & Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run dev server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

3. **Run unit & integration tests:**
   ```bash
   npm run test
   ```

4. **Verify typecheck & build:**
   ```bash
   npx tsc --noEmit
   npm run lint
   npm run build
   ```

---

## Live Smoke Test Instructions

To verify the integration with Steel and Stagehand:
1. Ensure your `.env.local` has a valid `STEEL_API_KEY` and `GEMINI_API_KEY`.
2. Ensure `MOCK_BROWSER` is set to `false`.
3. Start the application locally and run the "Homepage Smoke Test" template.
4. Verify that:
   - A cloud session starts inside your Steel dashboard.
   - Initial navigation screenshot compiles.
   - Assertions execute and report passed.
   - Browser logs are correctly collected.
   - The session closes cleanly in Steel log records.

---

## Security, Privacy, and URL Safety Rules

- **Protocol Restrictions:** Only accepts `http:` and `https:` URLs.
- **Local Network Blocks:** Rejects `localhost`, `.local` domains, and hostnames resolving to private IP ranges (e.g. `127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `::1`, `fc00::/7`).
- **Credential Protection:** Blocks URLs containing embedded credentials (`https://user:pass@domain`). Redacts parameters like `api_key`, `token`, `password`, `secret` in URLs, request errors, and console messages.
- **Origin Pinning:** Page routing interceptors abort any navigation attempts that leave the original start origin.

---

## Vercel Deployment

This application is ready for Vercel deployment:
1. Import the repository into Vercel.
2. Add `STEEL_API_KEY` and `GEMINI_API_KEY` as Environment Variables in project settings.
3. Deploy! Next.js will automatically configure the `/api/test-run` Node.js route handler to use a 60s timeout duration.

---

## Known MVP Limitations & Disclaimers

- **Provider Costs:** Cloud browser execution runs real instances on Steel and may incur provider costs or deduct quota credits depending on your plan.
- **Single Tab Limit:** The MVP is restricted to a single browser tab. Multi-tab workflows, file uploads, and downloads are not supported.
- **CAPTCHA Bypass:** FlowTest does not include CAPTCHA solving, destructive accounts actions, payment checkout steps, or arbitrary JS execution.
- **Rate Limiting:** Public deployments require platform-level rate limiting (e.g. Vercel KV rate limits or Cloudflare WAF) to protect against execution abuse.
- **Sandbox Boundary:** While cloud browsers run in isolated containers, they do not guarantee complete security if testing unauthorized, untrusted websites.
