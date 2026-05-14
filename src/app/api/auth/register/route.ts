import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import { grantCredits, STARTER_CREDITS } from '@/lib/credit-service';
import { sendEmailVerificationForAddress } from '@/lib/email-verification';
import { prisma } from '@/lib/db';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).max(120).optional(),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = registerSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { email, password, name } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        name: name ?? email.split('@')[0],
        passwordHash,
      },
    });

    await grantCredits({
      userId: user.id,
      amount: STARTER_CREDITS,
      reason: 'signup_bonus',
      metadata: { source: 'credentials_signup' },
    });

    try {
      await sendEmailVerificationForAddress(email);
    } catch (err) {
      console.error('[api/auth/register] verification email failed', err);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/auth/register]', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error('[api/auth/register] prisma', error.code, error.meta);
      if (error.code === 'P2002') {
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 }
        );
      }
    }
    if (error instanceof Error) {
      console.error('[api/auth/register]', error.message);
    }
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
