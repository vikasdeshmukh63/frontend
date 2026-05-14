import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';

import { authAuthorizedCallback } from '@/lib/auth-authorized-callback';
import { decorateSessionUserFromJwt } from '@/lib/auth-session-user';

const googleConfigured =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

const authDebug =
  process.env.AUTH_DEBUG === '1' || process.env.NODE_ENV !== 'production';

if (authDebug) {
  console.log('[auth] env flags', {
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
    AUTH_SECRET: !!process.env.AUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    AUTH_URL: process.env.AUTH_URL,
  });
}

export const authConfig = {
  trustHost: true,
  debug: authDebug,
  logger: {
    error(error) {
      console.error('[auth][error]', error.name, error.message);
      if ('cause' in error && error.cause != null) {
        console.error('[auth][error] cause:', error.cause);
      }
      if (error.stack) console.error(error.stack);
    },
    warn(code) {
      console.warn('[auth][warn]', code);
    },
    debug(message, metadata) {
      console.log('[auth][debug]', message, metadata ?? '');
    },
  },
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
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const [{ prisma }, bcrypt] = await Promise.all([
          import('@/lib/db'),
          import('bcryptjs'),
        ]);

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.default.compare(password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    authorized: authAuthorizedCallback,
    async jwt({ token, user, trigger, session }) {
      try {
        if (user?.id) {
          const { prisma } = await import('@/lib/db');
          const row = await prisma.user.findUnique({
            where: { id: user.id },
            select: { emailVerified: true },
          });
          token.emailVerified =
            row?.emailVerified instanceof Date
              ? row.emailVerified.toISOString()
              : '';
          token.sub = user.id;
          token.email = user.email;
          token.name = user.name;
          token.picture = user.image;
        } else if (
          token.sub &&
          (token.emailVerified === undefined || trigger === 'update')
        ) {
          const { prisma } = await import('@/lib/db');
          const row = await prisma.user.findUnique({
            where: { id: token.sub },
            select: { emailVerified: true },
          });
          token.emailVerified =
            row?.emailVerified instanceof Date
              ? row.emailVerified.toISOString()
              : '';
        }

        if (trigger === 'update' && session) {
          if (typeof session.name === 'string') {
            token.name = session.name;
          }
          if (typeof session.image === 'string' || session.image === null) {
            token.picture = session.image ?? null;
          }
        }
        return token;
      } catch (err) {
        console.error('[auth] jwt callback failed', err);
        throw err;
      }
    },
    async session({ session, token }) {
      try {
        return decorateSessionUserFromJwt(session, token);
      } catch (err) {
        console.error('[auth] session callback failed', err);
        throw err;
      }
    },
  },
} satisfies NextAuthConfig;
