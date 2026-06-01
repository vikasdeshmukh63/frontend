'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, KeyRound, Settings2, Trash2, X } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
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
  const [draftUseOwnApiKey, setDraftUseOwnApiKey] = useState(false);
  const [replacementKey, setReplacementKey] = useState('');
  const [keysOpen, setKeysOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!data) {
      setDraftProvider(DEFAULT_AI_PROVIDER);
      setDraftModel(DEFAULT_MODEL_BY_PROVIDER[DEFAULT_AI_PROVIDER]);
      setDraftUseOwnApiKey(false);
    } else {
      setDraftProvider(data.provider);
      setDraftModel(data.model);
      setDraftUseOwnApiKey(data.useOwnApiKey);
    }
    setReplacementKey('');
  }, [open, data]);

  const invalidateAiQueries = () => {
    queryClient.invalidateQueries(trpc.aiSettings.get.queryOptions());
    queryClient.invalidateQueries(trpc.usage.status.queryOptions());
  };

  const update = useMutation(
    trpc.aiSettings.update.mutationOptions({
      onSuccess: () => {
        toast.success('AI preferences saved');
        invalidateAiQueries();
        setOpen(false);
      },
      onError: (e) => toast.error(e.message || 'Could not save preferences'),
    })
  );

  const aiSettingsQueryKey = trpc.aiSettings.get.queryOptions().queryKey;

  const applyKeyFlagsToCache = (flags: {
    hasOpenaiKey: boolean;
    hasAnthropicKey: boolean;
    hasGeminiKey: boolean;
    useOwnApiKey: boolean;
  }) => {
    queryClient.setQueryData(
      aiSettingsQueryKey,
      (old: typeof data | undefined) =>
        old
          ? {
              ...old,
              hasOpenaiKey: flags.hasOpenaiKey,
              hasAnthropicKey: flags.hasAnthropicKey,
              hasGeminiKey: flags.hasGeminiKey,
              useOwnApiKey: flags.useOwnApiKey,
            }
          : old
    );
  };

  const clearSavedKey = useMutation(
    trpc.aiSettings.clearProviderKey.mutationOptions({
      onSuccess: (result) => {
        toast.success('Saved API key removed');
        setReplacementKey('');
        setDraftUseOwnApiKey(false);
        applyKeyFlagsToCache(result);
        queryClient.invalidateQueries(trpc.usage.status.queryOptions());
      },
      onError: (e) => toast.error(e.message || 'Could not remove saved key'),
    })
  );

  const onProviderChange = (p: AiProviderId) => {
    setDraftProvider(p);
    setDraftModel(DEFAULT_MODEL_BY_PROVIDER[p]);
    setReplacementKey('');
  };

  const buildKeyPatch = () => {
    const patch: {
      openaiApiKey?: string;
      anthropicApiKey?: string;
      geminiApiKey?: string;
    } = {};

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

    const savingNewKey = replacementKey.trim().length > 0;
    const useOwnApiKey = savingNewKey ? true : draftUseOwnApiKey;

    if (useOwnApiKey && !savingNewKey && !hasKeyForProvider(data, draftProvider)) {
      toast.error(
        `Add a ${AI_PROVIDER_LABELS[draftProvider].short} API key or switch to the application key.`
      );
      return;
    }

    update.mutate({
      provider: draftProvider,
      model: draftModel,
      useOwnApiKey,
      ...buildKeyPatch(),
    });
  };

  const savedKeyForProvider = hasKeyForProvider(data, draftProvider);
  const usingOwnKeyActive = draftUseOwnApiKey && savedKeyForProvider;

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
            Choose a provider and model. Use your own API key or the
            application&apos;s key (credits apply only for the application key).
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

          <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="use-own-api-key" className="text-sm font-medium">
                {draftUseOwnApiKey ? 'My API key' : 'Application API key'}
              </Label>
              <p className="text-muted-foreground text-xs leading-snug">
                {draftUseOwnApiKey
                  ? 'Generations use your saved key. App credits are not used.'
                  : 'Generations use the app key. Credits are consumed per generation.'}
              </p>
            </div>
            <Switch
              id="use-own-api-key"
              checked={draftUseOwnApiKey}
              onCheckedChange={setDraftUseOwnApiKey}
              disabled={!isSignedIn}
              aria-label="Use my API key instead of application API key"
            />
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
                  API key
                  {savedKeyForProvider && (
                    <Badge variant="secondary" className="text-[10px]">
                      {usingOwnKeyActive ? 'In use' : 'Saved (app key active)'}
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
              <div className="space-y-3">
                <p className="text-muted-foreground text-xs">
                  Save a provider key to use with &quot;My API key&quot; above.
                  Removing the saved key switches you back to the application key.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="ai-api-key" className="text-xs">
                    {AI_PROVIDER_LABELS[draftProvider].short} API key
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="ai-api-key"
                      type="password"
                      autoComplete="off"
                      className="flex-1"
                      placeholder={
                        savedKeyForProvider
                          ? 'Enter a new key to replace the saved one'
                          : 'sk-… or your provider key'
                      }
                      value={replacementKey}
                      onChange={(e) => setReplacementKey(e.target.value)}
                    />
                    {replacementKey.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        title="Clear input"
                        onClick={() => setReplacementKey('')}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {savedKeyForProvider ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive w-full gap-2"
                    disabled={clearSavedKey.isPending || !isSignedIn}
                    onClick={() => {
                      clearSavedKey.mutate({ provider: draftProvider });
                    }}
                  >
                    <Trash2 className="size-4" />
                    Delete saved key
                  </Button>
                ) : null}
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
