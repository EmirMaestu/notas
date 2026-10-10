import type { APIRequestContext } from '@playwright/test';

/** Headers de un cliente MCP de la era 2025 (el fallback sin estado del servidor). */
export const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-06-18',
};

export interface RpcResponse {
  result?: {
    protocolVersion?: string;
    tools?: { name: string }[];
    content?: { type: string; text: string }[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

/** Cuerpo JSON-RPC, venga como JSON o como SSE (`data: …`). */
function parseRpc(text: string, contentType: string): RpcResponse {
  if (!contentType.includes('text/event-stream')) return JSON.parse(text) as RpcResponse;
  const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
  return JSON.parse(data[data.length - 1]) as RpcResponse;
}

export function rpcBody(id: number, method: string, params: Record<string, unknown> = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

/** POST a /mcp con el token; falla si la respuesta HTTP no es 200. */
export async function mcpCall(
  request: APIRequestContext, token: string, id: number, method: string, params: Record<string, unknown> = {},
): Promise<RpcResponse> {
  const res = await request.post('/mcp', {
    headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` }, data: rpcBody(id, method, params),
  });
  if (res.status() !== 200) throw new Error(`/mcp respondió ${res.status()}: ${await res.text()}`);
  return parseRpc(await res.text(), res.headers()['content-type'] ?? '');
}

/** Status HTTP de un tools/list con ese token (para comprobar revocaciones). */
export async function mcpStatus(request: APIRequestContext, token: string): Promise<number> {
  const res = await request.post('/mcp', {
    headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` }, data: rpcBody(99, 'tools/list'),
  });
  return res.status();
}

/** JSON devuelto por una herramienta (falla si fue un error). */
export function toolJson(response: RpcResponse): unknown {
  const text = response.result?.content?.[0]?.text;
  if (response.result?.isError || text === undefined) throw new Error(`La herramienta falló: ${JSON.stringify(response)}`);
  return JSON.parse(text);
}
