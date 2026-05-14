'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

const Page = () => {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/sign-in');
    }
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.emailVerified) {
      router.replace('/');
      router.refresh();
    }
  }, [status, session, router]);

  const resend = useCallback(async () => {
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(data.error ?? 'Could not send email');
        return;
      }
      setMessage('Verification email sent. Check your inbox.');
      await update();
    } catch {
      setMessage('Could not send email');
    } finally {
      setBusy(false);
    }
  }, [update]);

  if (status === 'loading') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-[16vh] 2xl:pt-48">
        <p className="text-muted-foreground text-center text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-[16vh] 2xl:pt-48">
      <section className="space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Verify your email</h1>
          <p className="text-muted-foreground text-sm">
            We sent a link to{' '}
            <span className="text-foreground font-medium">
              {session?.user?.email ?? 'your address'}
            </span>
            . Open it to finish setup.
          </p>
        </div>
        {message && (
          <p
            className={
              message.startsWith('Verification email sent')
                ? 'text-sm text-green-600 dark:text-green-500'
                : 'text-destructive text-sm'
            }
          >
            {message}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button type="button" className="w-full" disabled={busy} onClick={() => void resend()}>
            Resend verification email
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => void signOut({ callbackUrl: '/sign-in' })}
          >
            Sign out
          </Button>
        </div>
        <p className="text-muted-foreground text-center text-sm">
          Wrong account?{' '}
          <Link href="/sign-in" className="text-primary underline">
            Sign in
          </Link>
        </p>
      </section>
    </div>
  );
};

export default Page;
