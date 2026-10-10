import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { getCurrentUser } from '@/lib/auth';
import { safeRedirect } from '@/lib/safe-redirect';
import { registerAction } from '../actions';

export default async function RegistroPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeRedirect(next));
  return <AuthForm mode="registro" action={registerAction} next={next ? safeRedirect(next) : undefined} />;
}
