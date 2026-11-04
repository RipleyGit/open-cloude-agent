import type { ReactNode } from 'react';

type QuickSettingsSectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

/** Rendered by QuickSettingsContent to group related preference rows under a heading. */
export default function QuickSettingsSection({
  title,
  children,
  className = '',
}: QuickSettingsSectionProps) {
  return (
    <section className={`flex min-h-0 flex-col gap-2 rounded-xl border border-border/70 bg-card p-3 shadow-sm ${className}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}
