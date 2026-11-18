import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n";

interface Props {
  children: ReactNode;
  /** Heading shown in the fallback (e.g. "The map failed to load."). */
  title?: string;
}

interface State {
  error: Error | null;
}

/**
 * Contains render/effect errors from its subtree so a single broken feature
 * (e.g. one insights widget) degrades to an inline message instead of throwing
 * out to the root and blanking the whole app. The fallback surfaces the error
 * message to make such failures diagnosable in the field.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught an error:", error, info);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <ErrorFallback
          error={error}
          title={this.props.title}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

// A function component because the boundary itself is a class and cannot
// call the i18n hook.
function ErrorFallback({
  error,
  title,
  onRetry,
}: {
  error: Error;
  title?: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle className="h-8 w-8 text-warning-glyph" />
      <div>
        <p className="font-medium text-foreground">
          {title ?? t("common.somethingWentWrongDot")}
        </p>
        <p className="mx-auto mt-1 max-w-md break-words text-body-quiet text-muted-foreground">
          {error.message || String(error)}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-body font-medium text-muted-foreground transition-colors hover:bg-gray-alpha-50 hover:text-foreground"
      >
        {t("common.tryAgain")}
      </button>
    </div>
  );
}
