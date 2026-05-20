'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
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
  name: z.string().min(1, 'Name is required').max(120),
  email: z.string().email(),
  password: z.string().min(8, 'Use at least 8 characters'),
});

type FormValues = z.infer<typeof schema>;

const Page = () => {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.emailVerified) {
      router.replace('/');
    }
  }, [status, session, router]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const showGoogle =
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true';

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setFormError(data.error ?? 'Could not create account');
      return;
    }

    setRegistered(true);
  };

  if (registered) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-[16vh] 2xl:pt-48">
        <section className="space-y-6 rounded-xl border bg-card p-8 shadow-sm">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold">Check your email</h1>
            <p className="text-muted-foreground text-sm">
              We sent a verification link to your address. After you confirm,
              sign in with your email and password.
            </p>
          </div>
          <Button asChild className="w-full">
            <Link href="/sign-in">Go to sign in</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-[16vh] 2xl:pt-48">
      <section className="space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Create account</h1>
          <p className="text-muted-foreground text-sm">
            Start building with Build01
          </p>
        </div>

        {showGoogle && (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => signIn('google', { callbackUrl: '/' })}
            >
              Continue with Google
            </Button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card text-muted-foreground px-2">Or</span>
              </div>
            </div>
          </>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" placeholder="Full Name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                      placeholder="email"
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
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="new-password"
                      type="password"
                      placeholder="password"
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
              Sign up
            </Button>
          </form>
        </Form>

        <p className="text-muted-foreground text-center text-sm">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-primary underline">
            Sign in
          </Link>
        </p>
      </section>
    </div>
  );
};

export default Page;
