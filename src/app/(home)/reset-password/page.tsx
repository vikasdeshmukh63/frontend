import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ResetPasswordForm } from './reset-password-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) {
    redirect('/');
  }

  const params = await searchParams;
  return (
    <ResetPasswordForm email={params.email ?? ''} token={params.token ?? ''} />
  );
}
