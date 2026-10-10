import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { getCurrentUser } from '@/lib/auth';
import { safeRedirect } from '@/lib/safe-redirect';
import { loginAction } from '../actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeRedirect(next));
  return <AuthForm mode="login" action={loginAction} next={next ? safeRedirect(next) : undefined} />;
}
