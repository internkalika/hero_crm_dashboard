# Ask the data: Groq + Vercel setup

Free tools only: Vercel Hobby and a Groq free API key. Nothing is paid.

## What is in this folder
| Path | Purpose |
|---|---|
| `public/index.html` | The dashboard (same file as `CRM_Tracker_Dashboard.html`). Vercel serves it at `/`, so `/api/ask` is on the same address. |
| `api/ask.js` | Serverless function: forwards the conversation to Groq. The key, model, system prompt and tool list live here, not in the browser. |
| `api/tools.js` | The 10 tools the model may call (schemas only). The tools themselves run in the browser, on the dashboard's data. |
| `vercel.json`, `.env.example` | Function timeout and the environment variables. |
| `tests/` | 30 test questions and a live test runner. |

## 1. Get a Groq key (free)
1. Sign in at console.groq.com and create an API key.
2. Check the free-tier limits and data terms shown in your console. Limits and model names change; the default here is `llama-3.3-70b-versatile`. If it is retired, set `GROQ_MODEL` to another tool-capable model from Groq's model list.

## 2. Deploy on Vercel
1. Put this folder in a Git repository (or use `vercel` CLI from this folder).
2. Create a Vercel project from it. Framework preset: **Other**. No build command. Output directory: `public`.
3. In Project Settings > Environment Variables add `GROQ_API_KEY` (and optionally `GROQ_MODEL`, `ALLOWED_ORIGINS`, `RATE_PER_MIN`). Redeploy.
4. Open the Vercel address, click **Ask the data**, ask "How do Dealer App and DataSense compare?".

If you host the dashboard somewhere else (or open the HTML from your computer), set the function address once in that browser's console:
`localStorage.setItem('askApiUrl','https://YOUR-PROJECT.vercel.app/api/ask')`
and set `ALLOWED_ORIGINS` to the dashboard's address (or leave `*` while testing). A file opened from disk with no address set uses the offline rule-based assistant only.

## How a question is answered
1. The browser sends the question to `/api/ask`. The function adds the fixed instructions and the tool list and calls Groq (temperature 0).
2. Groq replies with a tool call, for example `get_issues`. The **browser** runs it on the imported data and sends back only a small summary (counts, a few rows).
3. Up to 3 tool calls per question. The model writes a short answer from the results.
4. The dashboard checks that **every number in the reply appears in a tool result**. If not, it asks once for a rewrite; if that fails it shows "Currently no such data is present in the dashboard." instead.
5. The answer shows its period, scope, source and the figures it used.

If no tool can answer (profit, DataSense SKUs, Dealer App before September, an unknown dealer), the reply is: **"Currently no such data is present in the dashboard."** If Groq is down, rate-limited or the address is not set, the offline rule-based assistant answers instead (a "busy, try again in a minute" message appears for rate limits).

## What leaves the browser
Only the question and the summaries the tools return (aggregates, top rows, dealer names when asked about a dealer). Raw orders, complaints and usage rows are never sent. The function stores and logs nothing. Read Groq's current data terms before use.

## Testing
`tests/questions.json` has 30 questions with expected facts (values verified on the 29 Oct 2026 data). Run:
```
npm i playwright   # once
node tests/live_test.mjs https://YOUR-PROJECT.vercel.app
```
It asks each question through the real assistant and prints PASS/FAIL. Failures on "expect" mean the model chose the wrong tool or arguments; failures on "no_data" mean it answered something it should have refused. Re-run after any change to the prompt, model or data. Free-tier limits: the runner waits between questions; if it hits a limit it stops and says so.

## Limits to know
- Free tiers have request and token caps; heavy use shows the "busy" message.
- Open models sometimes pick the wrong tool; the number check and the "no data" rule catch wrong answers, not every poorly chosen question. The "Evidence" figures under each answer are the real tool results.
- The 10 tools cover: data coverage, Dealer App vs DataSense (overall or one dealer), dealer table, trends, models/SKUs/MBD, issues, Usage Report, Bizom vs DataSense, DataSense orders (all dealers), complaints. Other questions get the "no data" reply or the offline assistant's answer.
