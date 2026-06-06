'use client';

import { Button } from '@/components/ui/button';
import { buildAttachmentProxyUrl } from '@/lib/attachment-url';
import { cacheAttachmentPreview } from '@/lib/attachment-preview-cache';
import { ImagePlusIcon, Loader2Icon, XIcon } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { toast } from 'sonner';
import { ChatAttachmentImage } from './chat-attachment-image';

export type UploadedChatAttachment = {
  id: string;
  publicUrl: string;
  fileName: string;
  mimeType: string;
  /** Local blob URL for instant preview (revoked on remove) */
  previewUrl?: string;
};

type LocalPreview = {
  key: string;
  previewUrl: string;
  fileName: string;
};

interface Props {
  projectId: string;
  attachments: UploadedChatAttachment[];
  onAttachmentsChange: Dispatch<SetStateAction<UploadedChatAttachment[]>>;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  maxFiles?: number;
}

function revokePreviewUrl(url: string | undefined) {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

function normalizePastedImageFile(file: File): File {
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const name =
    file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)
      ? file.name
      : `pasted-${Date.now()}.${ext}`;
  return file.name === name ? file : new File([file], name, { type: file.type });
}

/** One pasted image — browsers often duplicate the same file on items + files. */
export function getImageFilesFromClipboard(
  clipboardData: DataTransfer | null
): File[] {
  if (!clipboardData) return [];

  const candidates: File[] = [];

  for (const file of Array.from(clipboardData.files)) {
    if (file.type.startsWith('image/')) candidates.push(file);
  }

  if (candidates.length === 0) {
    for (const item of Array.from(clipboardData.items)) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (file) candidates.push(file);
    }
  }

  const seen = new Set<string>();
  for (const file of candidates) {
    const key = `${file.type}:${file.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    return [normalizePastedImageFile(file)];
  }

  return [];
}

export type ChatImageAttachmentsHandle = {
  uploadFiles: (files: File[]) => Promise<void>;
};

export const ChatImageAttachments = forwardRef<
  ChatImageAttachmentsHandle,
  Props
>(function ChatImageAttachments(
  {
    projectId,
    attachments,
    onAttachmentsChange,
    onUploadingChange,
    disabled,
    maxFiles = 4,
  },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localPreviews, setLocalPreviews] = useState<LocalPreview[]>([]);

  useEffect(() => {
    onUploadingChange?.(uploading);
  }, [uploading, onUploadingChange]);

  const totalCount = attachments.length + localPreviews.length;

  const uploadFiles = useCallback(
    async (incoming: File[]) => {
      if (!incoming.length || disabled || uploading) return;

      const imageFiles = incoming.filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        toast.error('Only image files can be attached.');
        return;
      }

      const remaining = maxFiles - totalCount;
      if (remaining <= 0) {
        toast.error(`You can attach up to ${maxFiles} images.`);
        return;
      }

      const files = imageFiles.slice(0, remaining);
      const newPreviews: LocalPreview[] = files.map((file) => ({
        key: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
        fileName: file.name || 'image.jpg',
      }));

      setLocalPreviews((prev) => [...prev, ...newPreviews]);

      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }

      setUploading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/attachments`, {
          method: 'POST',
          body: formData,
        });

        const data = (await res.json()) as {
          attachments?: UploadedChatAttachment[];
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || 'Upload failed');
        }

        const uploaded = data.attachments ?? [];
        if (uploaded.length !== newPreviews.length) {
          throw new Error('Upload returned unexpected number of files');
        }

        onAttachmentsChange((prev) => [
          ...prev,
          ...uploaded.map((row, i) => {
            const preview = newPreviews[i]?.previewUrl;
            if (preview) cacheAttachmentPreview(row.id, preview);
            return {
              id: row.id,
              publicUrl: buildAttachmentProxyUrl(projectId, row.id),
              fileName: row.fileName,
              mimeType: row.mimeType,
              previewUrl: preview,
            };
          }),
        ]);

        setLocalPreviews((prev) =>
          prev.filter((p) => !newPreviews.some((n) => n.key === p.key))
        );
      } catch (error) {
        for (const p of newPreviews) revokePreviewUrl(p.previewUrl);
        setLocalPreviews((prev) =>
          prev.filter((p) => !newPreviews.some((n) => n.key === p.key))
        );
        toast.error(
          error instanceof Error ? error.message : 'Failed to upload image'
        );
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [
      disabled,
      uploading,
      totalCount,
      maxFiles,
      projectId,
      onAttachmentsChange,
    ]
  );

  useImperativeHandle(ref, () => ({ uploadFiles }), [uploadFiles]);

  const onPickFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    await uploadFiles(Array.from(fileList));
  };

  const removeAttachment = (id: string) => {
    const removed = attachments.find((a) => a.id === id);
    revokePreviewUrl(removed?.previewUrl);
    onAttachmentsChange((prev) => prev.filter((a) => a.id !== id));
  };

  const removeLocalPreview = (key: string) => {
    const removed = localPreviews.find((p) => p.key === key);
    revokePreviewUrl(removed?.previewUrl);
    setLocalPreviews((prev) => prev.filter((p) => p.key !== key));
  };

  useEffect(() => {
    return () => {
      for (const att of attachments) {
        revokePreviewUrl(att.previewUrl);
      }
      for (const p of localPreviews) {
        revokePreviewUrl(p.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup blob URLs on unmount
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          disabled={disabled || uploading || totalCount >= maxFiles}
          onChange={(e) => onPickFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={disabled || uploading || totalCount >= maxFiles}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <ImagePlusIcon className="size-4" />
          )}
          Attach image
        </Button>
        {totalCount > 0 && (
          <span className="text-muted-foreground text-xs">
            {totalCount}/{maxFiles} reference
            {totalCount === 1 ? '' : 's'}
            {uploading ? ' · uploading…' : ''}
          </span>
        )}
      </div>

      {totalCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="bg-muted relative size-16 shrink-0 overflow-hidden rounded-md border"
            >
              <ChatAttachmentImage
                projectId={projectId}
                attachmentId={att.id}
                fileName={att.fileName}
                imageUrl={att.publicUrl}
                previewUrl={att.previewUrl}
              />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute top-0.5 right-0.5 size-6 rounded-full shadow-sm"
                disabled={disabled || uploading}
                onClick={() => removeAttachment(att.id)}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          ))}
          {localPreviews.map((preview) => (
            <div
              key={preview.key}
              className="bg-muted relative size-16 shrink-0 overflow-hidden rounded-md border opacity-80"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.previewUrl}
                alt={preview.fileName}
                className="size-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <Loader2Icon className="size-4 animate-spin text-white" />
              </div>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute top-0.5 right-0.5 size-6 rounded-full shadow-sm"
                disabled={disabled || uploading}
                onClick={() => removeLocalPreview(preview.key)}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
ChatImageAttachments.displayName = 'ChatImageAttachments';
