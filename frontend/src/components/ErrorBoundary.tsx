import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Evita pantalla en blanco total si un render falla; muestra el error y permite reiniciar. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="h-full flex items-center justify-center bg-surface p-6">
        <div className="w-full max-w-md bg-white rounded-[2rem] border border-border p-6 space-y-4 text-center">
          <p className="text-xl font-semibold">Algo falló en la pantalla</p>
          <p className="text-sm text-muted break-words">
            {this.state.error.message || "Error inesperado"}
          </p>
          <Button
            className="w-full"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reiniciar app
          </Button>
        </div>
      </div>
    );
  }
}
