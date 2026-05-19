import { ClockIcon } from 'lucide-react';

type QueueItem = {
  id: string;
  position: number;
  preview: string;
  kind: string;
};

export function QueueBanner({ items }: { items: QueueItem[] }) {
  if (items.length === 0) return null;

  return (
    <div
      role="status"
      className="bg-muted/80 border-border mb-2 rounded-lg border px-3 py-2 text-sm"
    >
      <div className="text-foreground mb-1 flex items-center gap-2 font-medium">
        <ClockIcon className="size-4 shrink-0" />
        {items.length === 1
          ? '1 message queued'
          : `${items.length} messages queued`}
      </div>
      <p className="text-muted-foreground text-xs">
        Your request will run automatically when the current build finishes.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="text-muted-foreground truncate text-xs"
            title={item.preview}
          >
            <span className="text-foreground font-mono">#{item.position}</span>{' '}
            {item.preview}
          </li>
        ))}
      </ul>
    </div>
  );
}
