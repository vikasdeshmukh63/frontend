import 'dotenv/config';

/**
 * Add seed data via Prisma here when needed.
 */
export async function main(): Promise<void> {
  /* Intentionally empty — schema uses Clerk identities, not a local User table. */
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
