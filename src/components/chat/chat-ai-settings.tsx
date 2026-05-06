'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, KeyRound, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  AI_MODELS_BY_PROVIDER,
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  DEFAULT_AI_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  type AiProviderId,
} from '@/lib/ai-catalog';
import { cn } from '@/lib/utils';
import { useTRPC } from '@/trpc/client';

const unsignedSummary = {
  providerLabel: AI_PROVIDER_LABELS[DEFAULT_AI_PROVIDER].short,
  modelLabel:
    AI_MODELS_BY_PROVIDER[DEFAULT_AI_PROVIDER].find(
      (m) => m.apiModel === DEFAULT_MODEL_BY_PROVIDER[DEFAULT_AI_PROVIDER]
    )?.label ?? 'GPT-4.1',
};

function hasKeyForProvider(
  data:
    | {
        provider: AiProviderId;
        hasOpenaiKey: boolean;
        hasAnthropicKey: boolean;
        hasGeminiKey: boolean;
      }
    | undefined,
  p: AiProviderId
) {
  if (!data) return false;
  if (p === 'OPENAI') return data.hasOpenaiKey;
  if (p === 'ANTHROPIC') return data.hasAnthropicKey;
  return data.hasGeminiKey;
}

export function ChatAiSettingsButton() {
  const { status } = useSession();
  const isSignedIn = status === 'authenticated';
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isPending } = useQuery({
    ...trpc.aiSettings.get.queryOptions(),
    enabled: !!isSignedIn,
  });

  const summary = useMemo(() => {
    if (!isSignedIn) return unsignedSummary;
    if (!data) {
      return unsignedSummary;
    }
    return {
      providerLabel: data.providerLabel,
      modelLabel: data.modelLabel,
    };
  }, [isSignedIn, data]);

  const [draftProvider, setDraftProvider] = useState<AiProviderId>(
    DEFAULT_AI_PROVIDER
  );
  const [draftModel, setDraftModel] = useState(
    DEFAULT_MODEL_BY_PROVIDER[DEFAULT_AI_PROVIDER]
  );
  const [replacementKey, setReplacementKey] = useState('');
  const [clearKeyForProvider, setClearKeyForProvider] =
    useState<AiProviderId | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!data) {
      setDraftProvider(DEFAULT_AI_PROVIDER);
      setDraftModel(DEFAULT_MODEL_BY_PROVIDER[DEFAULT_AI_PROVIDER]);
    } else {
      setDraftProvider(data.provider);
      setDraftModel(data.model);
    }
    setReplacementKey('');
    setClearKeyForProvider(null);
  }, [open, data]);

  const update = useMutation(
    trpc.aiSettings.update.mutationOptions({
      onSuccess: () => {
        toast.success('AI preferences saved');
        queryClient.invalidateQueries(trpc.aiSettings.get.queryOptions());
        setOpen(false);
      },
      onError: (e) => toast.error(e.message || 'Could not save preferences'),
    })
  );

  const onProviderChange = (p: AiProviderId) => {
    setDraftProvider(p);
    setDraftModel(DEFAULT_MODEL_BY_PROVIDER[p]);
    setReplacementKey('');
    setClearKeyForProvider(null);
  };

  const buildKeyPatch = () => {
    const patch: {
      openaiApiKey?: string;
      anthropicApiKey?: string;
      geminiApiKey?: string;
    } = {};

    if (clearKeyForProvider === draftProvider) {
      if (draftProvider === 'OPENAI') patch.openaiApiKey = '';
      if (draftProvider === 'ANTHROPIC') patch.anthropicApiKey = '';
      if (draftProvider === 'GOOGLE_GEMINI') patch.geminiApiKey = '';
      return patch;
    }

    const next = replacementKey.trim();
    if (!next) return patch;

    if (draftProvider === 'OPENAI') patch.openaiApiKey = next;
    if (draftProvider === 'ANTHROPIC') patch.anthropicApiKey = next;
    if (draftProvider === 'GOOGLE_GEMINI') patch.geminiApiKey = next;
    return patch;
  };

  const onSave = () => {
    if (!isSignedIn) {
      router.push('/sign-in');
      return;
    }
    update.mutate({
      provider: draftProvider,
      model: draftModel,
      ...buildKeyPatch(),
    });
  };

  const customKeyActive = hasKeyForProvider(data, draftProvider);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-8 max-w-[min(200px,46vw)] shrink-0 gap-1.5 px-2 font-normal"
        >
          <Settings2 className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate text-left text-xs leading-tight">
            <span className="text-foreground font-medium">
              {summary.modelLabel}
            </span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-muted-foreground">{summary.providerLabel}</span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(420px,calc(100vw-1.5rem))] p-0"
        sideOffset={8}
      >
        <PopoverHeader className="border-b p-4 pb-3">
          <PopoverTitle className="text-base">AI model</PopoverTitle>
          <PopoverDescription>
            Choose a provider and model. Optionally add your own API key for
            that provider.
          </PopoverDescription>
        </PopoverHeader>

        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <Label className="text-xs font-medium tracking-wide uppercase">
              Provider
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {AI_PROVIDER_IDS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={draftProvider === p ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'h-auto flex-col gap-0.5 py-2 text-xs whitespace-normal',
                    draftProvider === p && 'ring-ring ring-2'
                  )}
                  onClick={() => onProviderChange(p)}
                >
                  <span className="font-medium">{AI_PROVIDER_LABELS[p].short}</span>
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs leading-snug">
              {AI_PROVIDER_LABELS[draftProvider].description}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium tracking-wide uppercase">
              Model
            </Label>
            <ScrollArea className="h-[220px] rounded-md border">
              <RadioGroup
                value={draftModel}
                onValueChange={setDraftModel}
                className="gap-0 p-1"
              >
                {AI_MODELS_BY_PROVIDER[draftProvider].map((m) => (
                  <label
                    key={m.apiModel}
                    className={cn(
                      'hover:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-md p-3 transition-colors',
                      draftModel === m.apiModel && 'bg-accent/70'
                    )}
                  >
                    <RadioGroupItem
                      value={m.apiModel}
                      id={m.apiModel}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="text-sm font-medium leading-none">
                        {m.label}
                      </div>
                      <p className="text-muted-foreground text-xs leading-snug">
                        {m.description}
                      </p>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </ScrollArea>
          </div>

          <Collapsible open={keysOpen} onOpenChange={setKeysOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2">
                  <KeyRound className="size-4" />
                  API key (optional)
                  {customKeyActive && (
                    <Badge variant="secondary" className="text-[10px]">
                      Custom key saved
                    </Badge>
                  )}
                </span>
                <ChevronDown
                  className={cn(
                    'size-4 transition-transform',
                    keysOpen && 'rotate-180'
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  Leave empty to use the app&apos;s default credentials. Your key
                  is stored for your account only.
                </p>
                <Label htmlFor="ai-api-key" className="text-xs">
                  {AI_PROVIDER_LABELS[draftProvider].short} API key
                </Label>
                <Input
                  id="ai-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    customKeyActive
                      ? 'Enter a new key to replace the saved one'
                      : 'sk-… or your provider key'
                  }
                  value={replacementKey}
                  onChange={(e) => {
                    setReplacementKey(e.target.value);
                    setClearKeyForProvider(null);
                  }}
                />
                {customKeyActive && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive h-8 px-2 text-xs"
                    onClick={() => {
                      setClearKeyForProvider(draftProvider);
                      setReplacementKey('');
                    }}
                  >
                    Remove saved key
                  </Button>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center justify-end gap-2 p-3">
          {!isSignedIn && (
            <p className="text-muted-foreground mr-auto text-xs">
              Sign in to save your choices.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={
              update.isPending ||
              (isSignedIn && isPending && data === undefined)
            }
          >
            {isSignedIn ? 'Save' : 'Sign in to save'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
