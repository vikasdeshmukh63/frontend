import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';

const googleConfigured =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

console.log({
  GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
  NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
});

export const authConfig = {
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
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      if (path.startsWith('/api/auth')) return true;
      if (path.startsWith('/api/inngest')) return true;
      if (path.startsWith('/api/trpc')) return true;
      if (path.startsWith('/api/razorpay/webhook')) return true;
      if (
        path === '/' ||
        path.startsWith('/sign-in') ||
        path.startsWith('/sign-up') ||
        path.startsWith('/pricing') ||
        path.startsWith('/forgot-password')
      ) {
        return true;
      }
      return !!auth?.user;
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
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
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        const user = session.user as {
          id: string;
          name: string | null;
          email: string | null;
          image: string | null;
        };
        user.id = token.sub;
        user.name = typeof token.name === 'string' ? token.name : null;
        user.email = typeof token.email === 'string' ? token.email : null;
        user.image = typeof token.picture === 'string' ? token.picture : null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
