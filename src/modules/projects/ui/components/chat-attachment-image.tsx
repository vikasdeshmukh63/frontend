'use client';

import { buildAttachmentProxyUrl } from '@/lib/attachment-url';
import { getCachedAttachmentPreview } from '@/lib/attachment-preview-cache';
import { cn } from '@/lib/utils';
import { ImagePlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

type Props = {
  projectId: string;
  attachmentId: string;
  fileName: string;
  /** Server-provided proxy URL (preferred when available). */
  imageUrl?: string;
  previewUrl?: string;
  isPending?: boolean;
  className?: string;
};

export function ChatAttachmentImage({
  projectId,
  attachmentId,
  fileName,
  imageUrl,
  previewUrl,
  isPending,
  className,
}: Props) {
  const proxySrc = isPending
    ? ''
    : (imageUrl ?? buildAttachmentProxyUrl(projectId, attachmentId));
  const cachedBlob = getCachedAttachmentPreview(attachmentId);

  const [src, setSrc] = useState(
    previewUrl || cachedBlob || proxySrc
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(previewUrl || cachedBlob || proxySrc);
    setFailed(false);
  }, [previewUrl, cachedBlob, proxySrc]);

  if (failed && !previewUrl && !cachedBlob) {
    return (
      <div
        className={cn(
          'text-muted-foreground flex flex-col items-center justify-center gap-0.5 bg-muted px-1 text-center text-[9px] leading-tight',
          className
        )}
      >
        <ImagePlusIcon className="size-4 opacity-50" />
        <span className="line-clamp-2">{fileName}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={fileName}
      className={cn('size-full object-cover', className)}
      onError={() => {
        if (previewUrl && src === previewUrl) {
          setSrc(cachedBlob || proxySrc);
          return;
        }
        if (cachedBlob && src === cachedBlob) {
          setSrc(proxySrc);
          return;
        }
        setFailed(true);
      }}
    />
  );
}
