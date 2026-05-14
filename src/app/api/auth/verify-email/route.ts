import crypto from 'crypto';
import { NextResponse } from 'next/server';

import { emailVerificationIdentifier } from '@/lib/email-verification';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = url.searchParams.get('email')?.toLowerCase().trim();
  const rawToken = url.searchParams.get('token');
  if (!email || !rawToken) {
    return NextResponse.redirect(new URL('/sign-in?verify=invalid', req.url));
  }

  const identifier = emailVerificationIdentifier(email);
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const record = await prisma.verificationToken.findUnique({
    where: {
      identifier_token: { identifier, token: tokenHash },
    },
  });

  if (!record || record.expires < new Date()) {
    return NextResponse.redirect(new URL('/sign-in?verify=expired', req.url));
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.redirect(new URL('/sign-in?verify=invalid', req.url));
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({
      where: {
        identifier_token: { identifier, token: tokenHash },
      },
    }),
  ]);

  const signOutUrl = new URL('/api/auth/signout', req.url);
  signOutUrl.searchParams.set(
    'callbackUrl',
    new URL('/sign-in?verify=success', req.url).toString(),
  );
  return NextResponse.redirect(signOutUrl);
}
