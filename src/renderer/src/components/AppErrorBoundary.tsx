import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AppErrorBoundaryState {
  error?: Error
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Sydekyks renderer failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <main className="fatal-renderer-error" role="alert">
        <section>
          <p>Display recovery</p>
          <h1>Sydekyks hit a screen error</h1>
          <span>Your local data is safe. Reload the window to restore the interface.</span>
          <button className="primary-button" onClick={() => window.location.reload()} type="button">
            Reload Sydekyks
          </button>
          {import.meta.env.DEV && <code>{this.state.error.message}</code>}
        </section>
      </main>
    )
  }
}
