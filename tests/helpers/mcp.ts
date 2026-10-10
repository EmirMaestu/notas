import { callTool, type ToolContext } from '@/mcp/tools';

/** Llama una herramienta y devuelve su JSON; falla si la herramienta devolvió error. */
export async function callOk(ctx: ToolContext, name: string, args: Record<string, unknown> = {}) {
  const result = await callTool(ctx, name, args);
  if (result.isError) throw new Error(`${name} devolvió error: ${result.content[0].text}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return JSON.parse(result.content[0].text) as any;
}

/** Llama una herramienta que debe fallar y devuelve el mensaje de error. */
export async function callError(ctx: ToolContext, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await callTool(ctx, name, args);
  if (!result.isError) throw new Error(`${name} debía fallar y devolvió: ${result.content[0].text}`);
  return result.content[0].text;
}

export const MCP_URL = 'https://notas.test/mcp';

/** POST JSON-RPC a /mcp como lo hace un cliente de la era 2025. */
export function rpcRequest(
  token: string | undefined, id: number, method: string, params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Request {
  const all: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
    ...headers,
  };
  if (token) all.authorization = `Bearer ${token}`;
  return new Request(MCP_URL, { method: 'POST', headers: all, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
}

/** Cuerpo JSON-RPC de una respuesta, venga como JSON o como SSE (`event: message` / `data: …`). */
export async function readRpc(response: Response) {
  const text = await response.text();
  let payload = text;
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
    if (data.length === 0) throw new Error(`Respuesta SSE sin datos: ${text}`);
    payload = data[data.length - 1];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return JSON.parse(payload) as any;
}

/** `fetch` para el cliente oficial del SDK que llama directo al route handler, con el token. */
export function fetchVia(handler: (request: Request) => Promise<Response>, token: string) {
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    request.headers.set('authorization', `Bearer ${token}`);
    return handler(request);
  };
}
