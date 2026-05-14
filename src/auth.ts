import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';

import { authConfig } from '@/auth.config';
import { sendEmailVerificationForAddress } from '@/lib/email-verification';
import { prisma } from '@/lib/db';
import { grantCredits, STARTER_CREDITS } from '@/lib/credit-service';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  adapter: PrismaAdapter(prisma),
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      try {
        await grantCredits({
          userId: user.id,
          amount: STARTER_CREDITS,
          reason: 'signup_bonus',
          metadata: { source: 'oauth_signup' },
        });
      } catch (err) {
        console.error(
          '[auth] createUser: grantCredits failed (user may exist but starter credits not applied)',
          { userId: user.id },
          err,
        );
        throw err;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: null },
      });

      if (user.email) {
        try {
          await sendEmailVerificationForAddress(user.email);
        } catch (err) {
          console.error(
            '[auth] createUser: verification email failed',
            { userId: user.id },
            err,
          );
        }
      }
    },
  },
});