import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { sendEmailVerificationForAddress } from '@/lib/email-verification';
import { prisma } from '@/lib/db';

export async function POST() {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { emailVerified: true },
    });
    if (user?.emailVerified) {
      return NextResponse.json({ ok: true });
    }

    await sendEmailVerificationForAddress(email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/auth/resend-verification]', err);
    return NextResponse.json({ error: 'Could not send email' }, { status: 500 });
  }
}
