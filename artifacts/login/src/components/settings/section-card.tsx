// A titled settings card: a header band (title + description, optional actions)
// over a body. Shared across the settings panels (labels, lost reasons, teams)
// so they stay visually identical.
export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-heading text-sm font-bold text-foreground">
            {title}
          </h2>
          <p className="mt-0.5 max-w-lg text-xs text-muted-foreground">{description}</p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
