import {get, param, response} from '@loopback/rest';
import {getRecentOpenAICalls} from '../services/ai.service';

export class DebugOpenAIController {
  @get('/__debug/openai', {
    responses: {
      '200': {
        description: 'Recent OpenAI calls (server-side)',
        content: {'application/json': {schema: {type: 'array', items: {type: 'object'}}}},
      },
    },
  })
  @response(200)
  list(@param.query.number('n') n?: number) {
    return getRecentOpenAICalls(n ?? 10);
  }
}
