import type { NextAuthConfig } from 'next-auth';
import { NextResponse } from 'next/server';

function sessionEmailIsVerified(
  emailVerified: string | null | undefined,
): boolean {
  return (
    emailVerified !== null &&
    emailVerified !== undefined &&
    emailVerified !== ''
  );
}

/** Shared by app `auth.config` and Edge middleware (must not import Prisma). */
export const authAuthorizedCallback: NonNullable<
  NextAuthConfig['callbacks']
>['authorized'] = ({ auth, request }) => {
  const path = request.nextUrl.pathname;
  if (path.startsWith('/api/auth')) return true;
  if (path.startsWith('/api/inngest')) return true;
  if (path.startsWith('/api/razorpay/webhook')) return true;

  const isEmailVerified = sessionEmailIsVerified(auth?.user?.emailVerified);

  if (path.startsWith('/api/trpc')) {
    if (auth?.user && !isEmailVerified) {
      return NextResponse.json(
        { error: { message: 'Email not verified' } },
        { status: 403 },
      );
    }
    return true;
  }

  if (auth?.user && !isEmailVerified) {
    const allowedWhileUnverified =
      path.startsWith('/sign-in') ||
      path.startsWith('/sign-up') ||
      path.startsWith('/pricing') ||
      path.startsWith('/forgot-password') ||
      path.startsWith('/reset-password') ||
      path.startsWith('/verify-email-pending');
    if (allowedWhileUnverified) return true;
    return NextResponse.redirect(
      new URL('/verify-email-pending', request.nextUrl),
    );
  }

  if (
    path === '/' ||
    path.startsWith('/sign-in') ||
    path.startsWith('/sign-up') ||
    path.startsWith('/pricing') ||
    path.startsWith('/forgot-password') ||
    path.startsWith('/reset-password')
  ) {
    return true;
  }
  return !!auth?.user;
};
