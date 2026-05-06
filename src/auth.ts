import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';

import { authConfig } from '@/auth.config';
import { prisma } from '@/lib/db';
import { grantCredits, STARTER_CREDITS } from '@/lib/credit-service';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      await grantCredits({
        userId: user.id,
        amount: STARTER_CREDITS,
        reason: 'signup_bonus',
        metadata: { source: 'oauth_signup' },
      });
    },
  },
});
