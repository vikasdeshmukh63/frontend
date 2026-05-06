import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';

const bodySchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(req: Request) {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const email = parsed.data.email.toLowerCase().trim();
    const tokenHash = crypto
      .createHash('sha256')
      .update(parsed.data.token)
      .digest('hex');

    const record = await prisma.verificationToken.findUnique({
      where: {
        identifier_token: {
          identifier: email,
          token: tokenHash,
        },
      },
    });

    if (!record || record.expires < new Date()) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { email },
        data: { passwordHash },
      }),
      prisma.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: email,
            token: tokenHash,
          },
        },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not reset password' }, { status: 500 });
  }
}
