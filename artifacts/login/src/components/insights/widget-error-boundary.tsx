import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tStatic } from "@/lib/i18n/i18n";

// One widget rendering a pathological stored spec/viz (or a recharts edge
// case) must degrade to a broken CARD, never a white-screened board. Class
// component because error boundaries have no hook equivalent.

interface Props {
  /** Names the widget in the console log, so a user report ("chart X is
   *  broken") maps straight to a stack trace. */
  label?: string;
  /** Remounts children when it changes (e.g. after the widget is edited). */
  resetKey?: string | number;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(
      `[insights] widget "${this.props.label ?? "unknown"}" failed to render`,
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-sm text-muted-foreground">{tStatic("insights.widget.renderFailed")}</p>
          <p className="max-w-full truncate text-xs text-subtle" title={this.state.error.message}>
            {this.state.error.message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ error: null })}
          >
            <RefreshCw className="me-1.5 h-3.5 w-3.5" /> {tStatic("common.tryAgain")}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
