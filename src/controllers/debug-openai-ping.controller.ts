import {get, response} from '@loopback/rest';
import {openAIJson, getRecentOpenAICalls} from '../services/ai.service';

export class DebugOpenAIPingController {
  @get('/__debug/openai/ping', {
    responses: {
      '200': {
        description: 'Forces a minimal OpenAI call to verify connectivity',
        content: {'application/json': {schema: {type: 'object'}}},
      },
    },
  })
  @response(200)
  async ping() {
    const schema = {
      type: 'object',
      properties: {
        pong: {type: 'string'},
        model_used: {type: 'string'}
      },
      required: ['pong','model_used'],
      additionalProperties: false
    };

    try {
      const out = await openAIJson<{pong: string; model_used: string}>(
        'Return JSON only per schema. Say "pong" and echo the model.',
        { hint: 'connectivity test' },
        schema
      );
      return { ok: true, result: out, recentOpenAICalls: getRecentOpenAICalls(5) };
    } catch (err: any) {
      const status = err?.response?.status;
      const rid = err?.response?.headers?.['x-request-id'];
      const body = err?.response?.data || { message: err?.message || String(err) };
      return {
        ok: false,
        status,
        requestId: rid,
        error: body,
        recentOpenAICalls: getRecentOpenAICalls(5)
      };
    }
  }
}
