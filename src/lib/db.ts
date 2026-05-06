import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = global as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/** True when the singleton matches the current generated schema (delegates wired). */
function schemaDelegateOk(client: PrismaClient | undefined): boolean {
  if (!client) return false;
  return (
    typeof (
      client as unknown as {
        user?: { findUnique: (...args: unknown[]) => Promise<unknown> };
      }
    ).user?.findUnique === 'function'
  );
}

function getSingletonPrismaClient(): PrismaClient {
  const current = globalForPrisma.prisma;
  if (current && schemaDelegateOk(current)) {
    return current;
  }

  const stale = current;
  if (stale) {
    void stale.$disconnect();
    globalForPrisma.prisma = undefined;
  }

  const created = createPrismaClient();
  if (!schemaDelegateOk(created)) {
    throw new Error(
      'Prisma Client is outdated (missing User model). Run `npx prisma generate` and restart the dev server.'
    );
  }

  globalForPrisma.prisma = created;
  return created;
}

export const prisma = getSingletonPrismaClient();
