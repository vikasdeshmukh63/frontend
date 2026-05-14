import crypto from 'crypto';

import { prisma } from '@/lib/db';

import { sendEmailVerificationEmail } from '@/lib/email';

const VERIFY_PREFIX = 'email-verify:';

export function emailVerificationIdentifier(email: string) {
  return `${VERIFY_PREFIX}${email.toLowerCase().trim()}`;
}

const TOKEN_TTL_MS = 1000 * 60 * 60 * 48; // 48h

export async function sendEmailVerificationForAddress(email: string) {
  const normalized = email.toLowerCase().trim();
  const identifier = emailVerificationIdentifier(normalized);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.verificationToken.deleteMany({ where: { identifier } });

  await prisma.verificationToken.create({
    data: {
      identifier,
      token: tokenHash,
      expires,
    },
  });

  const baseUrl =
    process.env.NEXTAUTH_URL ??
    process.env.AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:3000';
  const verifyLink = `${baseUrl.replace(/\/$/, '')}/api/auth/verify-email?email=${encodeURIComponent(normalized)}&token=${encodeURIComponent(rawToken)}`;

  await sendEmailVerificationEmail({ to: normalized, verifyLink });
}
