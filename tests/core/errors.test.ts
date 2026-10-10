import { describe, expect, it } from 'vitest';
import { isForeignKeyViolation, isUniqueViolation, isUuid } from '@/core/errors';

describe('isUuid', () => {
  it('acepta UUIDs y rechaza todo lo demás, incluso valores que no son string', () => {
    expect(isUuid('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    expect(isUuid('no-es-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid({ toString: () => '123e4567-e89b-42d3-a456-426614174000' })).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('detecta el código 23505 directo o en cause', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});

describe('isForeignKeyViolation', () => {
  it('detecta el código 23503 directo o en cause', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
    expect(isForeignKeyViolation({ cause: { code: '23503' } })).toBe(true);
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false);
    expect(isForeignKeyViolation({ cause: null })).toBe(false);
    expect(isForeignKeyViolation(new Error('x'))).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
    expect(isForeignKeyViolation('23503')).toBe(false);
  });
});
