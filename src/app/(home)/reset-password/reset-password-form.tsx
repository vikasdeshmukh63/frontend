'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
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

const schema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters'),
    confirmPassword: z.string().min(8, 'Use at least 8 characters'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordForm({
  email,
  token,
}: {
  email: string;
  token: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setError(null);

    if (!email || !token) {
      setError('Invalid reset link. Please request a new one.');
      return;
    }

    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        token,
        password: values.password,
      }),
    });

    const data = (await res.json()) as { error?: string };

    if (!res.ok) {
      setError(data.error ?? 'Could not reset password');
      return;
    }

    await signIn('credentials', {
      email,
      password: values.password,
      redirect: false,
    });

    router.push('/');
    router.refresh();
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-[16vh] 2xl:pt-48">
      <section className="space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Reset password</h1>
          <p className="text-muted-foreground text-sm">
            Choose a new password for your account.
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {error && <p className="text-destructive text-sm">{error}</p>}

            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              Update password
            </Button>
          </form>
        </Form>

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
