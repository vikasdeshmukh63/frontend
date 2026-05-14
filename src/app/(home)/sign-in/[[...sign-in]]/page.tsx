'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSession, signIn, useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

const Page = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';
  const verify = searchParams.get('verify');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user) return;
    if (session.user.emailVerified) {
      router.replace(callbackUrl);
    } else {
      router.replace('/verify-email-pending');
    }
  }, [status, session, router, callbackUrl]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    const res = await signIn('credentials', {
      email: values.email,
      password: values.password,
      redirect: false,
    });
    if (res?.error) {
      setFormError('Invalid email or password');
      return;
    }
    const s = await getSession();
    if (s?.user?.emailVerified) {
      router.push(callbackUrl);
    } else {
      router.push('/verify-email-pending');
    }
    router.refresh();
  };

  const showGoogle =
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true';

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-[16vh] 2xl:pt-48">
      <section className="space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-muted-foreground text-sm">
            Welcome back to Fingerchip
          </p>
        </div>

        {verify === 'success' && (
          <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-center text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
            Your email is verified. Sign in to continue.
          </p>
        )}
        {(verify === 'expired' || verify === 'invalid') && (
          <p className="text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-center text-sm">
            {verify === 'expired'
              ? 'That verification link has expired. Sign in and resend a new one from the verification page.'
              : 'That verification link is invalid. Try signing in and resend a verification email.'}
          </p>
        )}

        {showGoogle && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => signIn('google', { callbackUrl })}
          >
            Continue with Google
          </Button>
        )}

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card text-muted-foreground px-2">Or</span>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="email"
                      type="email"
                      placeholder="you@example.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link href="/forgot-password" className="text-primary text-xs underline">
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <Input
                      autoComplete="current-password"
                      type="password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {formError && (
              <p className="text-destructive text-sm">{formError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              Sign in
            </Button>
          </form>
        </Form>

        <p className="text-muted-foreground text-center text-sm">
          No account?{' '}
          <Link href="/sign-up" className="text-primary underline">
            Sign up
          </Link>
        </p>
      </section>
    </div>
  );
};

export default Page;
