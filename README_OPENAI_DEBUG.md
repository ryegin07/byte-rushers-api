# OpenAI Integration v4 — Responses API (`text.format`) + robust parsing

**Fixes your 400**: `response_format` moved to `text.format` in the Responses API.
This bundle:
- Sends structured outputs via `text.format: { type: "json_schema", ... }`
- Parses both `output_json` and `output_text` content items
- Keeps optional fallback to Chat Completions (set `OPENAI_USE_CHAT_FALLBACK=1`)
- Debug endpoints keep showing request IDs and error bodies

## Env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_USE_CHAT_FALLBACK=1
OPENAI_FALLBACK_CHAT_MODEL=gpt-4o-mini
OPENAI_DEBUG=1

## Verify
curl http://localhost:3000/__debug/env
curl http://localhost:3000/__debug/openai/ping
curl "http://localhost:3000/analytics/ml-insights?force=1&debug=1"
