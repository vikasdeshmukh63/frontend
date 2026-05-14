import NextAuth from 'next-auth';

import { authEdgeConfig } from '@/auth.edge.config';

const { auth } = NextAuth({
  ...authEdgeConfig,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});

export default auth;

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
