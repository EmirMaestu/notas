import 'server-only';
import { cache } from 'react';
import { listLists } from '@/core/lists';
import { getDb } from '@/db';

/** Listas del usuario (propias y compartidas con él, con su rol), memoizadas por request: el layout y la página las piden y solo se consulta una vez. */
export const getLists = cache(async (userId: string) => listLists(await getDb(), userId));
