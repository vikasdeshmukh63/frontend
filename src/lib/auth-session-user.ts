import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

/** Maps JWT claims onto `session.user` (Edge middleware + Node session). */
export function decorateSessionUserFromJwt(session: Session, token: JWT): Session {
  if (session.user && token.sub) {
    const user = session.user as {
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
      emailVerified: string | null;
    };
    user.id = token.sub;
    user.name = typeof token.name === 'string' ? token.name : null;
    user.email = typeof token.email === 'string' ? token.email : null;
    user.image = typeof token.picture === 'string' ? token.picture : null;
    user.emailVerified =
      typeof token.emailVerified === 'string' && token.emailVerified !== ''
        ? token.emailVerified
        : null;
  }
  return session;
}
