import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

import { authAuthorizedCallback } from '@/lib/auth-authorized-callback';
import { decorateSessionUserFromJwt } from '@/lib/auth-session-user';

const googleConfigured =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

/**
 * Edge-safe subset: no Prisma, no Credentials `authorize`.
 * Must stay aligned with `auth.config.ts` for session/pages/trustHost.
 */
export const authEdgeConfig = {
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: '/sign-in',
  },
  providers: [
    ...(googleConfigured
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  callbacks: {
    authorized: authAuthorizedCallback,
    /** Keep JWT as stored in the cookie; DB refresh runs in `auth.config` on the Node handler only. */
    jwt: async ({ token }) => token,
    async session({ session, token }) {
      return decorateSessionUserFromJwt(session, token);
    },
  },
} satisfies NextAuthConfig;
