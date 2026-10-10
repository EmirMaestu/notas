import { describe, expect, it } from 'vitest';
import { OAuthError } from '@/core/oauth';
import { formParam, oauthErrorResponse, readBody, readForm, tooManyRequests } from '@/lib/oauth-http';

const formRequest = (body: string, type = 'application/x-www-form-urlencoded') =>
  new Request('https://notas.test/oauth/token', { method: 'POST', headers: { 'content-type': type }, body });

describe('oauth-http', () => {
  it('readForm acepta solo application/x-www-form-urlencoded de hasta 10 KB', async () => {
    expect((await readForm(formRequest('a=1&b=2')))?.get('b')).toBe('2');
    expect(await readForm(formRequest('{"a":1}', 'application/json'))).toBeNull();
    expect(await readForm(formRequest(`a=${'x'.repeat(10_001)}`))).toBeNull();
  });

  it('readBody aborta un stream chunked sin Content-Length al pasar el límite', async () => {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode('x'.repeat(4000)));
        if (pulled > 1000) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('https://notas.test/oauth/register', {
      method: 'POST', body, duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();
    expect(await readBody(request)).toBeNull();
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(20);
  });

  it('readBody no se fía de un Content-Length que miente', async () => {
    const big = 'x'.repeat(20_000);
    const lying = new Request('https://notas.test/x', {
      method: 'POST', body: big, headers: { 'content-length': '5' },
    });
    expect(await readBody(lying)).toBeNull();
    const honest = new Request('https://notas.test/x', { method: 'POST', body: 'hola' });
    expect(await readBody(honest)).toBe('hola');
    const declaredBig = new Request('https://notas.test/x', {
      method: 'POST', body: 'a', headers: { 'content-length': '99999' },
    });
    expect(await readBody(declaredBig)).toBeNull();
  });

  it('readBody cuenta bytes (UTF-8) y decodifica caracteres partidos entre chunks', async () => {
    expect(await readBody(new Request('https://notas.test/x', { method: 'POST', body: 'ñ'.repeat(6000) }))).toBeNull();
    const bytes = new TextEncoder().encode('añb');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    const split = new Request('https://notas.test/x', { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(await readBody(split)).toBe('añb');
  });

  it('tooManyRequests: 429 invalid_request con Retry-After redondeado hacia arriba', async () => {
    const res = tooManyRequests('esperá', 59.2);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await res.json()).toEqual({ error: 'invalid_request', error_description: 'esperá' });
  });

  it('formParam: repetido o vacío cuenta como ausente', () => {
    const form = new URLSearchParams('a=1&b=&c=1&c=2');
    expect(formParam(form, 'a')).toBe('1');
    expect(formParam(form, 'b')).toBeUndefined();
    expect(formParam(form, 'c')).toBeUndefined();
    expect(formParam(form, 'd')).toBeUndefined();
  });

  it('oauthErrorResponse: JSON RFC 6749, sin caché y con CORS; invalid_client → 401', async () => {
    const res = oauthErrorResponse(new OAuthError('invalid_grant', 'El código venció'));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ error: 'invalid_grant', error_description: 'El código venció' });
    expect(oauthErrorResponse(new OAuthError('invalid_client', 'x')).status).toBe(401);
  });
});
