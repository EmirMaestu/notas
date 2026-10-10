import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '@/lib/rate-limit';

describe('createRateLimiter', () => {
  it('permite hasta max intentos por ventana y luego bloquea', () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 1000 });
    expect([1, 2, 3].map(() => limiter.check('a', 0))).toEqual([true, true, true]);
    expect(limiter.check('a', 500)).toBe(false);
    expect(limiter.check('b', 500)).toBe(true);
  });

  it('se reinicia al terminar la ventana y con reset()', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.check('a', 0)).toBe(true);
    expect(limiter.check('a', 999)).toBe(false);
    expect(limiter.check('a', 1000)).toBe(true);
    limiter.reset('a');
    expect(limiter.check('a', 1001)).toBe(true);
  });

  it('acota la memoria: purga vencidas y descarta las más viejas', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, maxEntries: 3 });
    for (let i = 0; i < 10; i++) limiter.check(`k${i}`, 0);
    expect(limiter.size()).toBeLessThanOrEqual(4);
    // las anteriores ya vencieron: al llegar una nueva solo queda esa
    for (let i = 0; i < 3; i++) limiter.check(`n${i}`, 5000);
    limiter.check('last', 5000);
    expect(limiter.size()).toBeLessThanOrEqual(4);
    expect(limiter.check('k9', 5000)).toBe(true); // k9 fue purgada, empieza de cero
  });

  it('no pierde conteos vigentes mientras no se supera maxEntries', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, maxEntries: 3 });
    limiter.check('a', 0);
    expect(limiter.check('a', 10)).toBe(false);
  });
});
