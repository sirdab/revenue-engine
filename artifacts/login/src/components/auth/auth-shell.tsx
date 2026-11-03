import React from "react";
import logo from "@/assets/brand/sirdab-logo.webp";

interface AuthShellProps {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Shared brand layout for the unauthenticated pages (login, forgot password,
 * reset password) so they stay visually consistent.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="min-h-[100dvh] w-full flex bg-background">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-surface-whisper items-center justify-center overflow-hidden border-e">
        <div className="absolute inset-0 z-0">
          <img
            src="/side-bg.png"
            alt="Logistics background"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-br from-brand-900/10 to-gray-900/20 mix-blend-multiply" />
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex flex-col justify-center px-6 py-12 lg:px-16 xl:px-24">
        <div className="w-full max-w-[400px] mx-auto flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="mb-10">
            <img
              src={logo}
              alt="Sirdab"
              className="h-8 w-auto mb-8 dark:invert dark:hue-rotate-180"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                const sibling = e.currentTarget.nextElementSibling;
                if (sibling) (sibling as HTMLElement).style.display = "block";
              }}
            />
            <div className="hidden text-heading-sm font-heading font-bold text-primary mb-8 tracking-tight">
              Sirdab
            </div>

            <h1 className="text-heading-sm text-foreground mb-2">
              {title}
            </h1>
            {subtitle && (
              <p className="text-muted-foreground text-body">{subtitle}</p>
            )}
          </div>

          {children}

          {footer && <div className="mt-8 text-body">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
