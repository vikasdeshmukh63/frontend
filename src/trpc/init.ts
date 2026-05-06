import { initTRPC, TRPCError } from '@trpc/server';
import { cache } from 'react';
import superjson from 'superjson';

import { auth } from '@/auth';

export const createTRPCContext = cache(async () => {
  const session = await auth();
  const userId = session?.user?.id;
  return {
    auth: { userId },
  };
});

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const isAuthed = t.middleware(({ next, ctx }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Not Authenticated',
    });
  }

  return next({
    ctx: {
      auth: {
        userId: ctx.auth.userId,
      },
    },
  });
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthed);
