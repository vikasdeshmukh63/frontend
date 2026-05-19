import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getStoredObject } from '@/lib/object-storage';

function imageResponse(body: Buffer, contentType: string) {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ projectId: string; attachmentId: string }>;
  }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { projectId, attachmentId } = await context.params;

  const attachment = await prisma.messageAttachment.findFirst({
    where: {
      id: attachmentId,
      projectId,
      project: { userId },
    },
  });

  if (!attachment) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const { body, contentType } = await getStoredObject(attachment.storageKey);
    return imageResponse(body, contentType || attachment.mimeType);
  } catch (s3Error) {
    console.error(
      '[attachments] S3 read failed:',
      attachment.storageKey,
      s3Error instanceof Error ? s3Error.message : s3Error
    );

    const remote = attachment.publicUrl?.trim();
    if (remote.startsWith('http')) {
      try {
        const res = await fetch(remote, {
          signal: AbortSignal.timeout(30_000),
        });
        if (res.ok) {
          const body = Buffer.from(await res.arrayBuffer());
          const contentType =
            res.headers.get('content-type') || attachment.mimeType;
          return imageResponse(body, contentType);
        }
      } catch (fetchError) {
        console.error(
          '[attachments] publicUrl fetch failed:',
          fetchError instanceof Error ? fetchError.message : fetchError
        );
      }
    }

    return new Response('Failed to load image', { status: 502 });
  }
}
