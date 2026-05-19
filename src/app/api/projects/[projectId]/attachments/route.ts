import { randomUUID } from 'crypto';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { buildAttachmentProxyUrl } from '@/lib/attachment-url';
import {
  isObjectStorageConfigured,
  uploadProjectImage,
} from '@/lib/object-storage';

const MAX_FILES_PER_REQUEST = 4;

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isObjectStorageConfigured()) {
    return Response.json(
      {
        error:
          'Image storage is not configured. Add EXCLOUD_S3_* environment variables.',
      },
      { status: 503 }
    );
  }

  const { projectId } = await context.params;

  const project = await prisma.project.findUnique({
    where: { id: projectId, userId },
    select: { id: true },
  });

  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const files = formData.getAll('files').filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return Response.json({ error: 'No files provided' }, { status: 400 });
  }

  if (files.length > MAX_FILES_PER_REQUEST) {
    return Response.json(
      { error: `At most ${MAX_FILES_PER_REQUEST} images per upload` },
      { status: 400 }
    );
  }

  const uploaded: Array<{
    id: string;
    publicUrl: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }> = [];

  for (const file of files) {
    const attachmentId = randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';
    const fileName = file.name || 'reference.jpg';

    try {
      const { storageKey, publicUrl: s3PublicUrl } = await uploadProjectImage({
        userId,
        projectId,
        attachmentId,
        fileName,
        mimeType,
        body: buffer,
      });

      const row = await prisma.messageAttachment.create({
        data: {
          id: attachmentId,
          projectId,
          userId,
          storageKey,
          publicUrl: s3PublicUrl,
          fileName,
          mimeType,
          sizeBytes: buffer.byteLength,
        },
      });

      uploaded.push({
        id: row.id,
        publicUrl: buildAttachmentProxyUrl(projectId, row.id),
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Upload failed';
      return Response.json({ error: message }, { status: 400 });
    }
  }

  return Response.json({ attachments: uploaded });
}
