import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { lists, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { DEFAULT_TIMEZONE, canonicalTimezone } from './dates';
import { NotFoundError, ValidationError, isUniqueViolation, isUuid } from './errors';

export type User = typeof users.$inferSelect;
/** Usuario sin el hash de la contraseña: es lo único que sale de este módulo. */
export type PublicUser = Omit<User, 'passwordHash'>;

// Hash bcrypt (costo 10) de un valor aleatorio; permite igualar el tiempo de respuesta cuando el email no existe.
const DUMMY_HASH = '$2a$10$A/29KOVn48snZfqFFkYgMOBFGZXsbN0X563XghEa8ae7Z363xWSka';

function toPublic(user: User): PublicUser {
  const publicUser: Partial<User> = { ...user };
  delete publicUser.passwordHash;
  return publicUser as PublicUser;
}

export { DEFAULT_TIMEZONE };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  timezone?: string;
}

function checkTimezone(timezone: string): string {
  const canonical = canonicalTimezone(timezone);
  if (!canonical) throw new ValidationError(`Zona horaria inválida: ${timezone}`);
  return canonical;
}

/** Crea el usuario y su lista Bandeja. */
export async function createUser(db: DB, input: CreateUserInput): Promise<PublicUser> {
  if (typeof input.email !== 'string') throw new ValidationError('Email inválido');
  if (typeof input.password !== 'string') throw new ValidationError('La contraseña debe ser texto');
  if (input.name !== undefined && typeof input.name !== 'string') throw new ValidationError('El nombre debe ser texto');
  const name = input.name?.trim() ?? '';
  if (name.length > 100) throw new ValidationError('El nombre no puede superar los 100 caracteres');
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ValidationError('Email inválido');
  if (input.password.trim().length < 8) throw new ValidationError('La contraseña debe tener al menos 8 caracteres');
  if (Buffer.byteLength(input.password, 'utf8') > 72) throw new ValidationError('La contraseña no puede superar los 72 bytes');
  const timezone = checkTimezone(input.timezone ?? DEFAULT_TIMEZONE);

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) throw new ValidationError('Ya existe un usuario con ese email');

  const passwordHash = await bcrypt.hash(input.password, 10);
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email, passwordHash, name, timezone })
        .returning();
      await tx.insert(lists).values({ userId: user.id, name: 'Bandeja', isInbox: true });
      return toPublic(user);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError('Ya existe un usuario con ese email');
    throw err;
  }
}

export async function verifyCredentials(db: DB, email: string, password: string): Promise<PublicUser | null> {
  const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }
  return (await bcrypt.compare(password, user.passwordHash)) ? toPublic(user) : null;
}

export async function getUser(db: DB, userId: string): Promise<PublicUser> {
  if (!isUuid(userId)) throw new NotFoundError('El usuario');
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new NotFoundError('El usuario');
  return toPublic(user);
}

export async function updateUserTimezone(db: DB, userId: string, timezone: string): Promise<PublicUser> {
  const canonical = checkTimezone(timezone);
  await getUser(db, userId);
  const [user] = await db.update(users).set({ timezone: canonical }).where(eq(users.id, userId)).returning();
  return toPublic(user);
}
