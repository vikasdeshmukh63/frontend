'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

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
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
    }
  }, [status, router]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setError(null);
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      setError('Could not process request. Please try again.');
      return;
    }

    setDone(true);
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-[16vh] 2xl:pt-48">
      <section className="space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Forgot password</h1>
          <p className="text-muted-foreground text-sm">
            Enter your email and we will send reset instructions.
          </p>
        </div>

        {done ? (
          <p className="text-sm">
            If an account exists for this email, a reset link has been generated.
            Check server logs in development.
          </p>
        ) : (
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
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                Send reset link
              </Button>
            </form>
          </Form>
        )}

        <p className="text-muted-foreground text-center text-sm">
          Back to{' '}
          <Link href="/sign-in" className="text-primary underline">
            sign in
          </Link>
        </p>
      </section>
    </div>
  );
}
