import {get, response} from '@loopback/rest';
import {INTEGRATION_VERSION, getRecentOpenAICalls} from '../services/ai.service';

export class DebugVersionController {
  @get('/__debug/version')
  @response(200, {description: 'Returns the integration version and recent OpenAI calls'})
  version() {
    return {
      version: INTEGRATION_VERSION,
      recentOpenAICalls: getRecentOpenAICalls(5)
    };
  }
}
