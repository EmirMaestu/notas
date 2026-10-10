import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from '@/app/mcp/route';
import { createApiToken } from '@/core/api-tokens';
import { createTask, listTasks } from '@/core/tasks';
import { setDbForTests } from '@/db';
import type { DB } from '@/db/types';
import { TOOLS } from '@/mcp/tools';
import { createTestDb, createTestUser } from '../helpers/db';
import { MCP_URL, fetchVia, readRpc, rpcRequest } from '../helpers/mcp';
import { issueTestTokens } from '../helpers/oauth';

const ALL_TOOLS = [
  'get_today_context', 'list_lists', 'create_list', 'update_list', 'delete_list', 'list_tasks', 'search_tasks',
  'get_task', 'create_task', 'update_task', 'complete_task', 'uncomplete_task', 'move_task', 'delete_task',
  'restore_task', 'add_subtask', 'update_subtask', 'delete_subtask', 'list_tags', 'create_tag', 'list_members',
  'share_list', 'unshare_list', 'leave_list',
];

let db: DB;
let userId: string;
let token: string;

beforeEach(async () => {
  vi.stubEnv('APP_URL', 'https://notas.test');
  db = await createTestDb();
  setDbForTests(db);
  userId = (await createTestUser(db)).id;
  token = (await createApiToken(db, userId, 'tests')).token;
});
afterEach(() => {
  setDbForTests(undefined);
  vi.unstubAllEnvs();
});

describe('/mcp: autenticación', () => {
  it('sin token → 401 con el puntero a la metadata del recurso', async () => {
    const res = await POST(rpcRequest(undefined, 1, 'tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://notas.test/.well-known/oauth-protected-resource/mcp", scope="tasks"',
    );
    expect(res.headers.get('www-authenticate')).not.toContain('error');
  });

  it('token inválido → 401 con error="invalid_token"', async () => {
    const res = await POST(rpcRequest('ntk_invalido', 1, 'tools/list'));
    expect(res.status).toBe(401);
    const header = res.headers.get('www-authenticate') ?? '';
    expect(header).toContain('error="invalid_token", error_description="The access token is invalid or expired"');
    expect(header).toMatch(/^[\x20-\x7e]*$/); // header solo ASCII
    expect(await res.json()).toMatchObject({ error: 'invalid_token' });
    expect((await GET(new Request(MCP_URL))).status).toBe(401);
  });

  it('más de 60 pedidos sin autenticar por minuto desde una IP → 429 con Retry-After', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.77' };
    for (let i = 0; i < 60; i++) {
      expect((await POST(rpcRequest('ntk_malo', i, 'tools/list', {}, ip))).status).toBe(401);
    }
    const blocked = await POST(rpcRequest('ntk_malo', 99, 'tools/list', {}, ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    // otra IP no se ve afectada, y un token válido desde la IP bloqueada tampoco
    expect((await POST(rpcRequest('ntk_malo', 1, 'tools/list', {}, { 'x-forwarded-for': '203.0.113.78' }))).status).toBe(401);
    expect((await POST(rpcRequest(token, 1, 'tools/list', {}, ip))).status).toBe(200);
  });

  it('Origin ajeno → 403; el propio se acepta', async () => {
    expect((await POST(rpcRequest(token, 1, 'tools/list', {}, { origin: 'https://evil.example.com' }))).status).toBe(403);
    expect((await POST(rpcRequest(token, 1, 'tools/list', {}, { origin: 'https://notas.test' }))).status).toBe(200);
  });
});

describe('/mcp: era 2025 (JSON-RPC a mano, como Claude o ChatGPT hoy)', () => {
  it('initialize, tools/list y tools/call', async () => {
    const init = await readRpc(await POST(rpcRequest(token, 1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' },
    })));
    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(init.result.serverInfo.name).toBe('notas');
    expect(init.result.instructions).toContain('YYYY-MM-DD');

    const list = await readRpc(await POST(rpcRequest(token, 2, 'tools/list')));
    expect(list.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([...ALL_TOOLS].sort());
    expect(TOOLS.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort());
    const createTool = list.result.tools.find((t: { name: string }) => t.name === 'create_task');
    expect(createTool.inputSchema.properties.priority.enum).toEqual([0, 1, 3, 5]);
    expect(createTool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    const byName = (n: string) => list.result.tools.find((t: { name: string }) => t.name === n).annotations;
    expect(byName('update_task')).toMatchObject({ destructiveHint: true, idempotentHint: true });
    for (const n of ['complete_task', 'uncomplete_task', 'delete_task', 'restore_task', 'move_task', 'update_list', 'update_subtask', 'create_tag']) {
      expect(byName(n).idempotentHint, n).toBe(true);
    }
    expect(createTool.inputSchema.properties.list_id.format).toBe('uuid');

    const call = await readRpc(await POST(rpcRequest(token, 3, 'tools/call', {
      name: 'create_task', arguments: { title: 'Desde MCP', priority: 3 },
    })));
    expect(call.result.isError).toBeFalsy();
    expect(JSON.parse(call.result.content[0].text)).toMatchObject({ title: 'Desde MCP', list_name: 'Bandeja', priority: 3 });
    expect((await listTasks(db, userId, { view: 'inbox' })).map((t) => t.title)).toEqual(['Desde MCP']);
  });

  it('errores de herramienta vuelven como isError y GET/DELETE → 405', async () => {
    const res = await readRpc(await POST(rpcRequest(token, 1, 'tools/call', {
      name: 'get_task', arguments: { task_id: '00000000-0000-0000-0000-000000000000' },
    })));
    expect(res.result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'La tarea no existe; usá list_tasks o search_tasks para obtener ids válidos' }] });
    const auth = { authorization: `Bearer ${token}`, accept: 'text/event-stream' };
    expect((await GET(new Request(MCP_URL, { headers: auth }))).status).toBe(405);
    expect((await DELETE(new Request(MCP_URL, { method: 'DELETE', headers: auth }))).status).toBe(405);
  });
});

describe('/mcp: era 2026-07-28 con el cliente oficial del SDK', () => {
  it('lista herramientas y las llama', async () => {
    const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: fetchVia(POST, token) }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort());
    expect(tools.find((t) => t.name === 'create_task')?.description).toContain('YYYY-MM-DD');

    const created = await client.callTool({ name: 'create_task', arguments: { title: 'Moderna' } });
    expect(created.isError).toBeFalsy();
    const [first] = created.content;
    expect(first.type === 'text' ? JSON.parse(first.text).title : null).toBe('Moderna');

    const failed = await client.callTool({ name: 'complete_task', arguments: { task_id: 'no-existe' } });
    expect(failed.isError).toBe(true);
    await client.close();
  });
});

describe('/mcp: límites', () => {
  it('rechaza subscriptions/listen con un error JSON-RPC (el servidor no emite eventos)', async () => {
    const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: fetchVia(POST, token) }));
    await expect(client.listen({ toolsListChanged: true })).rejects.toThrow(/Subscription limit reached/);
    await client.close();
  });

  it('cuerpos de más de 256 KB → 413', async () => {
    const big = 'x'.repeat(300 * 1024);
    const res = await POST(rpcRequest(token, 1, 'tools/call', { name: 'create_task', arguments: { title: big } }));
    expect(res.status).toBe(413);
  });
});

describe('/mcp: tokens OAuth y aislamiento', () => {
  it('un access token OAuth funciona y no ve datos de otro usuario', async () => {
    const other = await createTestUser(db, 'otra@example.com');
    const secret = await createTask(db, other.id, { title: 'Secreta' });
    const { tokens } = await issueTestTokens(db, userId);
    const res = await readRpc(await POST(rpcRequest(tokens.access_token, 1, 'tools/call', {
      name: 'get_task', arguments: { task_id: secret.id },
    })));
    expect(res.result).toMatchObject({ isError: true, content: [{ text: 'La tarea no existe; usá list_tasks o search_tasks para obtener ids válidos' }] });
    const search = await readRpc(await POST(rpcRequest(tokens.access_token, 2, 'tools/call', {
      name: 'search_tasks', arguments: { query: 'Secreta' },
    })));
    expect(JSON.parse(search.result.content[0].text)).toEqual({ tasks: [], has_more: false });
  });

  it('un refresh token no sirve como Bearer', async () => {
    const { tokens } = await issueTestTokens(db, userId);
    expect((await POST(rpcRequest(tokens.refresh_token, 1, 'tools/list'))).status).toBe(401);
  });
});
