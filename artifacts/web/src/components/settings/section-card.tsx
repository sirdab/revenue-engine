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
    <section className="overflow-hidden rounded-2xl bg-card shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-heading-xs text-foreground">{title}</h2>
          <p className="mt-1 max-w-prose text-body-quiet text-muted-foreground">
            {description}
          </p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
