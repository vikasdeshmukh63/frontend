import { NextResponse } from 'next/server';

// Route access is enforced by tRPC protected procedures + server session checks.
export default function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
