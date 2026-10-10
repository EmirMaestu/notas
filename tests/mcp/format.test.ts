import { describe, expect, it } from 'vitest';
import { formatLocalTimestamp } from '@/mcp/format';

describe('formatLocalTimestamp', () => {
  const instant = new Date('2026-10-10T02:30:00Z');

  it('convierte a la zona del usuario como YYYY-MM-DD HH:mm', () => {
    expect(formatLocalTimestamp(instant, 'America/Argentina/Buenos_Aires')).toBe('2026-10-09 23:30');
    expect(formatLocalTimestamp(instant, 'UTC')).toBe('2026-10-10 02:30');
    expect(formatLocalTimestamp(instant, 'Asia/Tokyo')).toBe('2026-10-10 11:30');
  });

  it('medianoche sale como 00:xx (no 24:xx)', () => {
    expect(formatLocalTimestamp(new Date('2026-10-10T00:05:00Z'), 'UTC')).toBe('2026-10-10 00:05');
  });

  it('null queda null', () => {
    expect(formatLocalTimestamp(null, 'UTC')).toBeNull();
  });
});
