import type { DB } from '@/db/types';
import { PERSONAL_TOKEN_PREFIX, authenticateApiToken } from './api-tokens';
import { ACCESS_TOKEN_PREFIX, authenticateAccessToken } from './oauth';

/** Quién llama al MCP y con qué credencial. */
export type BearerAuth =
  | { userId: string; via: 'personal'; tokenId: string }
  | { userId: string; via: 'oauth'; clientId: string };

/** Los tokens reales miden menos de 50 caracteres: lo demás se descarta sin consultar la base. */
const MAX_TOKEN_LENGTH = 200;

/** Resuelve el token de un header `Authorization: Bearer …` (personal `ntk_` u OAuth `nat_`). */
export async function authenticateBearer(
  db: DB, token: string, opts: { resource: string; now?: Date },
): Promise<BearerAuth | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  if (token.startsWith(PERSONAL_TOKEN_PREFIX)) {
    const found = await authenticateApiToken(db, token, opts.now);
    return found && { userId: found.userId, via: 'personal', tokenId: found.tokenId };
  }
  if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
    const found = await authenticateAccessToken(db, token, opts);
    return found && { userId: found.userId, via: 'oauth', clientId: found.clientId };
  }
  return null;
}
