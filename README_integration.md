# ChatGPT (OpenAI) Integration for /staff/ml-analytics

## Files
- `src/services/ai.service.ts`
- `src/services/ml.chatgpt.ts`
- `src/services/recommendations.chatgpt.ts`
- `src/controllers/analytics.controller.chatgpt.ts`
- `.env.example`

## Install
```bash
npm i axios
cp .env.example .env   # then set your OPENAI_API_KEY
```

## Register controller
Import and include `AnalyticsChatGPTController` in your application boot sequence or `application.controller.ts`.

## Notes
- Keep keys server-side only.
- Add caching/try-catch in production if desired.
