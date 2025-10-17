# Enable LoopBack Explorer & Make Controllers Show Up

Follow these steps to ensure your new endpoints appear in `/explorer`:

---
## 1) Install the Explorer (if not already installed)

```bash
npm i @loopback/rest-explorer
```

---
## 2) Enable Explorer in `src/application.ts`

Add these imports:

```ts
import {RestExplorerBindings, RestExplorerComponent} from '@loopback/rest-explorer';
import {ControllerBooter} from '@loopback/boot';
```

Make sure your app class extends Boot mixins (typical scaffold):
```ts
export class MyApp extends BootMixin(ServiceMixin(RepositoryMixin(RestApplication))) {
  constructor(options: ApplicationConfig = {}) {
    super(options);
    // ...
```

Inside the constructor, add:
```ts
this.configure(RestExplorerBindings.COMPONENT).to({ path: '/explorer' });
this.component(RestExplorerComponent);

// Ensure the Booter will pick up controllers in src/controllers
this.booter(ControllerBooter);

// (Optional) Make the OpenAPI servers derive from the current request host
this.api({
  openapi: '3.0.0',
  info: {title: 'My API', version: '1.0.0'},
  paths: {},
});
```

If your project already sets `this.api(...)`, you don't need to add it again.

---
## 3) Re-export controllers from `src/controllers/index.ts`

Copy the included `src/controllers/index.ts` file into your project so Booter discovers the controllers.

It must export your controllers (including the new ones):
```ts
export * from './analytics.controller.chatgpt';
export * from './debug-openai.controller';
export * from './debug-openai-ping.controller';
export * from './debug-env.controller';
export * from './debug-routes.controller';
```
If you have an existing `index.ts`, just add the missing exports.

---
## 4) (Alternative) Manually register controllers

If you’re not using Booter, manually bind the controllers inside `application.ts`:

```ts
this.controller(require('./controllers/analytics.controller.chatgpt').AnalyticsChatGPTController);
this.controller(require('./controllers/debug-openai.controller').DebugOpenAIController);
this.controller(require('./controllers/debug-openai-ping.controller').DebugOpenAIPingController);
this.controller(require('./controllers/debug-env.controller').DebugEnvController);
this.controller(require('./controllers/debug-routes.controller').DebugRoutesController);
```

---
## 5) Restart and verify

- Restart the API server.
- Open the Explorer: `http://localhost:3000/explorer` (or your host/port).
- You should see:
  - **GET** `/analytics/ml-insights/v2`
  - **GET** `/analytics/ml-insights/chatgpt`
  - **GET** `/__debug/openai/ping`
  - **GET** `/__debug/openai`
  - **GET** `/__debug/env`
  - **GET** `/__debug/routes`

You can also check the raw OpenAPI spec:
```
curl http://localhost:3000/openapi.json
```

If endpoints still don’t show, you’re likely running a build that doesn’t include the new files (or the files are outside `src/controllers`). Ensure the files are under `src/controllers`, recompile (`npm run build`), and restart.
