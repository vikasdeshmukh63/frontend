import { TRPCError } from '@trpc/server';

function getErrorBlob(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.toLowerCase();
  }
  try {
    return JSON.stringify(error).toLowerCase();
  } catch {
    return String(error).toLowerCase();
  }
}

export function isPrismaEndpointError(error: unknown): boolean {
  const blob = getErrorBlob(error);
  return (
    blob.includes('driveradaptererror') &&
    (blob.includes('requested endpoint could not be found') ||
      blob.includes("don't have access to it"))
  );
}

export function toAppTrpcError(error: unknown, fallback = 'Something went wrong'): TRPCError {
  if (isPrismaEndpointError(error)) {
    return new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message:
        'Database connection is temporarily unavailable. Please verify DATABASE_URL and retry.',
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (error instanceof TRPCError) {
    return error;
  }

  return new TRPCError({
    code: 'BAD_REQUEST',
    message: fallback,
    cause: error instanceof Error ? error : undefined,
  });
}
