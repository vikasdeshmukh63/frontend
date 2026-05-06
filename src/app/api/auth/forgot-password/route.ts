import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/email';

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });

    // Don't reveal whether the user exists.
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 min

    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token: tokenHash,
        expires,
      },
    });

    const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const resetLink = `${baseUrl.replace(/\/$/, '')}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(rawToken)}`;

    await sendPasswordResetEmail({ to: email, resetLink });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not process request' }, { status: 500 });
  }
}
