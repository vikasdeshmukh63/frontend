'use client';

import { convertFilesToTreeItems } from '@/lib/utils';
import {
  CheckIcon,
  CopyCheckIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
} from 'lucide-react';
import JSZip from 'jszip';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import Editor from '@monaco-editor/react';
import { Hint } from './hint';
import { Button } from './ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from './ui/resizable';
import { TreeView } from './tree-view';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb';

export type FileCollection = { [path: string]: string };

const EXT_TO_MONACO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  py: 'python',
  sh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  prisma: 'graphql',
  graphql: 'graphql',
  sql: 'sql',
  env: 'plaintext',
};

function getMonacoLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MONACO_LANG[ext] ?? 'plaintext';
}

interface FileBreadCrumbProps {
  filePath: string;
}

const FileBreadCrumb = ({ filePath }: FileBreadCrumbProps) => {
  const pathSegments = filePath.split('/');
  const maxSegments = 3;

  const renderBreadCrumbItems = () => {
    if (pathSegments.length <= maxSegments) {
      return pathSegments.map((segment, index) => {
        const isLast = index === pathSegments.length - 1;
        return (
          <Fragment key={index}>
            <BreadcrumbItem>
              {isLast ? (
                <BreadcrumbPage className="font-medium">{segment}</BreadcrumbPage>
              ) : (
                <span className="text-muted-foreground">{segment}</span>
              )}
            </BreadcrumbItem>
            {!isLast && <BreadcrumbSeparator />}
          </Fragment>
        );
      });
    }

    const firstSegment = pathSegments[0];
    const lastSegment = pathSegments[pathSegments.length - 1];
    return (
      <>
        <BreadcrumbItem>
          <span className="text-muted-foreground">{firstSegment}</span>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbEllipsis />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="font-medium">
            <BreadcrumbPage>{lastSegment}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbItem>
      </>
    );
  };

  return (
    <Breadcrumb>
      <BreadcrumbList>{renderBreadCrumbItems()}</BreadcrumbList>
    </Breadcrumb>
  );
};

interface FileExplorerProps {
  files: FileCollection;
  fragmentId: string;
  onPreviewSync?: (files: FileCollection) => void;
  onSave?: (files: FileCollection) => void;
  isSaving?: boolean;
  isSyncingPreview?: boolean;
  /** Stream live files during generation without resetting on every parent render. */
  liveGeneration?: boolean;
}

/** Push to sandbox only after user pauses typing (reduces costly E2B syncs). */
const PREVIEW_DEBOUNCE_MS = 2500;

export const FileExplorer = ({
  files: initialFiles,
  fragmentId,
  onPreviewSync,
  onSave,
  isSaving = false,
  isSyncingPreview = false,
  liveGeneration = false,
}: FileExplorerProps) => {
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'light';

  const [files, setFiles] = useState<FileCollection>(initialFiles);
  const [copied, setCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(() => {
    const fileKeys = Object.keys(initialFiles);
    return fileKeys.length > 0 ? fileKeys[0] : null;
  });

  const skipPreviewSyncRef = useRef(true);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Stable refs so the debounce effect does not re-run when parent re-renders (avoids sync loops). */
  const onPreviewSyncRef = useRef(onPreviewSync);
  const onSaveRef = useRef(onSave);
  onPreviewSyncRef.current = onPreviewSync;
  onSaveRef.current = onSave;

  // Reset editor when switching fragments; during live generation merge incoming files.
  useEffect(() => {
    if (liveGeneration) {
      setFiles(initialFiles);
      const ordered =
        Object.keys(initialFiles).length > 0
          ? Object.keys(initialFiles)
          : [];
      if (ordered.length === 0) return;
      setSelectedFile((current) => {
        if (current && initialFiles[current]) return current;
        return ordered[ordered.length - 1] ?? null;
      });
      return;
    }

    setFiles(initialFiles);
    const fileKeys = Object.keys(initialFiles);
    setSelectedFile(fileKeys.length > 0 ? fileKeys[0] : null);
    skipPreviewSyncRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reset only on fragment change
  }, [fragmentId, liveGeneration, initialFiles]);

  useEffect(() => {
    if (liveGeneration || !onPreviewSyncRef.current) return;

    if (skipPreviewSyncRef.current) {
      skipPreviewSyncRef.current = false;
      return;
    }

    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
    }

    previewTimerRef.current = setTimeout(() => {
      onPreviewSyncRef.current?.(files);
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
    };
  }, [files]);

  const treeData = useMemo(() => convertFilesToTreeItems(files), [files]);

  const handleFileSelect = useCallback(
    (filePath: string) => {
      if (files[filePath] !== undefined) {
        setSelectedFile(filePath);
      }
    },
    [files]
  );

  const handleCopy = useCallback(() => {
    if (selectedFile) {
      navigator.clipboard.writeText(files[selectedFile]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [selectedFile, files]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!selectedFile) return;
      setFiles((prev) => ({ ...prev, [selectedFile]: value ?? '' }));
    },
    [selectedFile]
  );

  const handleSave = useCallback(() => {
    onSaveRef.current?.(files);
  }, [files]);

  const handleDownload = useCallback(async () => {
    const zip = new JSZip();
    Object.entries(files).forEach(([path, content]) => {
      zip.file(path, content);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project-code.zip';
    a.click();
    URL.revokeObjectURL(url);
  }, [files]);

  const monacoOptions = {
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'off' as const,
    lineNumbers: 'on' as const,
    renderLineHighlight: 'all' as const,
    readOnly: liveGeneration,
    padding: { top: 8, bottom: 8 },
    fontFamily:
      "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', 'Droid Sans Mono', 'Source Code Pro', monospace",
    tabSize: 2,
    automaticLayout: true,
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
    },
  };

  return (
    <ResizablePanelGroup>
      <ResizablePanel defaultSize={30} minSize={30} className="bg-sidebar">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {liveGeneration ? 'Live generation' : 'Files'}
          </span>
          <Hint text="Download all as ZIP" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleDownload}
            >
              <DownloadIcon className="size-4" />
            </Button>
          </Hint>
        </div>
        <TreeView
          data={treeData}
          value={selectedFile}
          onSelect={handleFileSelect}
        />
      </ResizablePanel>
      <ResizableHandle className="hover:bg-primary transition-colors" />
      <ResizablePanel defaultSize={70} minSize={50}>
        {selectedFile && files[selectedFile] !== undefined ? (
          <div className="flex h-full w-full flex-col">
            <div className="bg-sidebar flex items-center justify-between gap-x-2 border-b px-4 py-2">
              <FileBreadCrumb filePath={selectedFile} />
              <div className="ml-auto flex items-center gap-2">
                {isSyncingPreview && (
                  <span className="text-muted-foreground flex items-center gap-1 text-xs">
                    <Loader2Icon className="size-3 animate-spin" />
                    Updating preview…
                  </span>
                )}
                {onSave && (
                  <Hint text="Save to project (persists on reload)" side="bottom">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={handleSave}
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : (
                        <CheckIcon className="size-3.5" />
                      )}
                      Save
                    </Button>
                  </Hint>
                )}
                <Hint text="Copy to clipboard" side="bottom">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleCopy}
                    disabled={copied}
                  >
                    {copied ? (
                      <CopyCheckIcon className="size-4" />
                    ) : (
                      <CopyIcon className="size-4" />
                    )}
                  </Button>
                </Hint>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <Editor
                height="100%"
                language={getMonacoLanguage(selectedFile)}
                value={files[selectedFile]}
                theme={monacoTheme}
                options={monacoOptions}
                onChange={handleEditorChange}
              />
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            Select a file to view its content
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
