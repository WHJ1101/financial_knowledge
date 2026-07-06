import { Component } from "preact";

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Page render failed", error, info);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(props, state) {
    if (!state.error) return props.children;
    return (
      <div class="error-boundary">
        <strong>页面加载失败</strong>
        <p>{state.error?.message || "发生了未知错误"}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>重试</button>
      </div>
    );
  }
}
