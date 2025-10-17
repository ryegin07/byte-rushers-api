import {get, response} from '@loopback/rest';
import {inject} from '@loopback/core';
import {RestServer} from '@loopback/rest';

export class DebugRoutesController {
  constructor(@inject('servers.RestServer') private restServer: RestServer) {}

  @get('/__debug/routes', {
    responses: {'200': {description: 'List all registered routes', content: {'application/json': {schema: {type: 'array', items: {type: 'object'}}}}}}
  })
  @response(200)
  async routes() {
    // getApiSpec returns a Promise<OpenAPIObject>, so we must await it.
    const spec = await this.restServer.getApiSpec();
    const paths = (spec && (spec as any).paths) ? (spec as any).paths : {};
    const out: Array<{method: string; path: string}> = [];
    for (const [path, methods] of Object.entries<any>(paths)) {
      for (const [method, _op] of Object.entries<any>(methods)) {
        out.push({method: method.toUpperCase(), path});
      }
    }
    out.sort((a,b)=> a.path===b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path));
    return out;
  }
}
