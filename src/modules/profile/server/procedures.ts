import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { createTRPCRouter, protectedProcedure } from '@/trpc/init';

export const profileRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.auth.userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
    });

    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    return user;
  }),

  update: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        image: z.string().trim().url().or(z.literal('')).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await prisma.user.update({
        where: { id: ctx.auth.userId },
        data: {
          name: input.name,
          ...(input.image !== undefined && { image: input.image || null }),
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      });

      return updated;
    }),
});
