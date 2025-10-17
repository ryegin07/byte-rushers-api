import {get, response} from '@loopback/rest';

export class DebugEnvController {
  @get('/__debug/env', {
    responses: {
      '200': {
        description: 'Environment visibility (safe/masked)',
        content: {'application/json': {schema: {type: 'object'}}},
      },
    },
  })
  @response(200)
  env() {
    const key = process.env.OPENAI_API_KEY || '';
    const masked = key ? `${key.slice(0,8)}...${key.slice(-4)}` : '(missing)';
    return {
      openaiKeyPresent: !!key,
      openaiKeyMasked: masked,
      openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      openaiFallbackChatModel: process.env.OPENAI_FALLBACK_CHAT_MODEL || 'gpt-4o-mini',
      useChatFallback: process.env.OPENAI_USE_CHAT_FALLBACK === '1',
      openaiDebug: process.env.OPENAI_DEBUG === '1',
      nodeEnv: process.env.NODE_ENV || '(unset)',
    };
  }
}
