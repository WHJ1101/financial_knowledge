/** 错误边界（移植旧 app.jsx ErrorBoundary，方案 §11.F）：捕获渲染异常，避免整页白屏。 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { GlassButton, GlassPanel } from "@/components/LiquidGlass";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("页面渲染异常:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <GlassPanel className="error-boundary" role="alert">
          <h2>页面出错了</h2>
          <p className="muted">{this.state.error.message}</p>
          <GlassButton tone="secondary" onClick={() => this.setState({ error: null })}>
            重试
          </GlassButton>
        </GlassPanel>
      );
    }
    return this.props.children;
  }
}
