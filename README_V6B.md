# OpenAI Integration v6b (retry/backoff/cache + version endpoint)

Files:
- src/services/ai.service.ts  (rate limit, retries with Retry-After, cache, coalescing) — VERSION: openai_rl_v6b
- src/utils/rateLimiter.ts
- src/controllers/analytics.controller.chatgpt.ts (graceful fallback)
- src/controllers/debug-version.controller.ts (GET /__debug/version)
- src/controllers/index.ts (exports to help Booter pick up controllers)

## Verify you're on v6b
1) Restart the API (rebuild if using TS out dir).
2) Hit:
   GET /__debug/version
   -> { "version": "openai_rl_v6b", "recentOpenAICalls": [...] }

3) Exercise the pipeline:
   GET /analytics/ml-insights/v2?force=1&debug=1

## Env knobs
OPENAI_MODEL=gpt-4o-mini
OPENAI_FALLBACK_CHAT_MODEL=gpt-4o-mini
OPENAI_USE_CHAT_FALLBACK=1
OPENAI_MAX_ATTEMPTS=4
OPENAI_BASE_DELAY_MS=250
OPENAI_RATE_CAPACITY=3
OPENAI_RATE_REFILL=3
OPENAI_CACHE_TTL_MS=300000
OPENAI_DEBUG=1
