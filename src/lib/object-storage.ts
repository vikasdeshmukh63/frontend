import 'server-only';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrlBase: string;
};

export function getObjectStorageConfig(): ObjectStorageConfig | null {
  const endpoint = process.env.EXCLOUD_S3_ENDPOINT?.trim();
  const bucket = process.env.EXCLOUD_S3_BUCKET?.trim();
  const accessKeyId = process.env.EXCLOUD_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.EXCLOUD_S3_SECRET_ACCESS_KEY?.trim();

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const region = process.env.EXCLOUD_S3_REGION?.trim() || 'default';
  const endpointBase = endpoint.startsWith('http')
    ? endpoint.replace(/\/$/, '')
    : `https://${endpoint.replace(/\/$/, '')}`;
  const publicUrlBase =
    process.env.EXCLOUD_S3_PUBLIC_URL_BASE?.trim() ||
    (bucket === 'vibe'
      ? 'https://1015.objects.excloud.dev/public/vibe'
      : `${endpointBase}/${bucket}`);

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicUrlBase: publicUrlBase.replace(/\/$/, ''),
  };
}

export function isObjectStorageConfigured(): boolean {
  return getObjectStorageConfig() !== null;
}

function getS3Client(config: ObjectStorageConfig): S3Client {
  const endpoint = config.endpoint.startsWith('http')
    ? config.endpoint
    : `https://${config.endpoint}`;

  return new S3Client({
    region: config.region,
    endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

export function buildAttachmentStorageKey(
  userId: string,
  projectId: string,
  attachmentId: string,
  fileName: string
): string {
  const ext = fileName.includes('.')
    ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
    : '';
  return `users/${userId}/projects/${projectId}/${attachmentId}${ext}`;
}

/** Permanent public URL prefix for sandbox img src (EXCLOUD_S3_PUBLIC_URL_BASE). */
export const EXCLOUD_PUBLIC_IMAGE_URL_PREFIX =
  'https://1015.objects.excloud.dev/public/vibe/';

export function getPublicObjectUrl(storageKey: string): string {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error('Object storage is not configured');
  }
  const key = storageKey.replace(/^\//, '');
  return `${config.publicUrlBase}/${key}`;
}

/**
 * Sandbox-ready URL for a user upload:
 * https://1015.objects.excloud.dev/public/vibe/users/{userId}/projects/{projectId}/{attachmentId}.png
 */
export function buildAttachmentPublicUrl(storageKey: string): string {
  return getPublicObjectUrl(storageKey);
}

/** Allow anonymous GET on this object (permanent public URL for sandbox <img src="https://...">). */
export async function ensureObjectPublicRead(storageKey: string): Promise<void> {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error('Object storage is not configured');
  }
  const client = getS3Client(config);
  const ok = await trySetObjectPublicRead(client, config.bucket, storageKey);
  if (!ok) {
    throw new Error(
      'Could not set public-read on the image. Ensure your excloud key has s3:PutObjectAcl and the bucket allows public objects.'
    );
  }
}

async function trySetObjectPublicRead(
  client: S3Client,
  bucket: string,
  storageKey: string
): Promise<boolean> {
  try {
    await client.send(
      new PutObjectAclCommand({
        Bucket: bucket,
        Key: storageKey,
        ACL: 'public-read',
      })
    );
    return true;
  } catch (error) {
    console.warn(
      '[object-storage] public-read ACL not applied:',
      storageKey,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

export async function isUrlPubliclyReadable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(12_000),
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

/**
 * Permanent public URL for sandbox <img src="..."> (EXCLOUD_S3_PUBLIC_URL_BASE + key).
 * Example: https://1015.objects.excloud.dev/public/vibe/users/.../image.png
 */
/** @deprecated Use buildAttachmentPublicUrl */
export function getSandboxAccessibleImageUrl(storageKey: string): string {
  return buildAttachmentPublicUrl(storageKey);
}

export function validateImageUpload(
  mimeType: string,
  sizeBytes: number
): { ok: true } | { ok: false; error: string } {
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return {
      ok: false,
      error: 'Only JPEG, PNG, WebP, and GIF images are allowed.',
    };
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `Image must be between 1 byte and ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB.`,
    };
  }
  return { ok: true };
}

export async function uploadProjectImage(params: {
  userId: string;
  projectId: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  body: Buffer;
}): Promise<{ storageKey: string; publicUrl: string }> {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error(
      'Image storage is not configured. Set EXCLOUD_S3_ENDPOINT, EXCLOUD_S3_BUCKET, EXCLOUD_S3_ACCESS_KEY_ID, and EXCLOUD_S3_SECRET_ACCESS_KEY.'
    );
  }

  const check = validateImageUpload(params.mimeType, params.body.byteLength);
  if (!check.ok) {
    throw new Error(check.error);
  }

  const storageKey = buildAttachmentStorageKey(
    params.userId,
    params.projectId,
    params.attachmentId,
    params.fileName
  );

  const client = getS3Client(config);
  const putParams: ConstructorParameters<typeof PutObjectCommand>[0] = {
    Bucket: config.bucket,
    Key: storageKey,
    Body: params.body,
    ContentType: params.mimeType,
    CacheControl: 'public, max-age=31536000, immutable',
  };

  try {
    await client.send(
      new PutObjectCommand({
        ...putParams,
        ACL: 'public-read',
      })
    );
  } catch (aclOnPutError) {
    console.warn(
      '[object-storage] PutObject with ACL failed, retrying without ACL:',
      aclOnPutError instanceof Error ? aclOnPutError.message : aclOnPutError
    );
    await client.send(new PutObjectCommand(putParams));
    await trySetObjectPublicRead(client, config.bucket, storageKey);
  }

  const publicUrl = getPublicObjectUrl(storageKey);
  if (!(await isUrlPubliclyReadable(publicUrl))) {
    await trySetObjectPublicRead(client, config.bucket, storageKey);
    if (!(await isUrlPubliclyReadable(publicUrl))) {
      console.warn(
        '[object-storage] uploaded but not yet publicly readable:',
        publicUrl
      );
    }
  }

  return {
    storageKey,
    publicUrl,
  };
}

export async function getStoredObject(
  storageKey: string
): Promise<{ body: Buffer; contentType: string }> {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error('Object storage is not configured');
  }

  const client = getS3Client(config);
  const result = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: storageKey,
    })
  );

  if (!result.Body) {
    throw new Error('Empty object body');
  }

  const bytes = Buffer.from(await result.Body.transformToByteArray());
  return {
    body: bytes,
    contentType: result.ContentType ?? 'application/octet-stream',
  };
}

export async function deleteStoredObject(storageKey: string): Promise<void> {
  const config = getObjectStorageConfig();
  if (!config) return;

  const client = getS3Client(config);
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: storageKey,
    })
  );
}

export { MAX_ATTACHMENT_BYTES, ALLOWED_IMAGE_TYPES };
