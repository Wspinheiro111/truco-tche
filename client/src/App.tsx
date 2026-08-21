import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
const GameApp = lazy(() => import("./game/GameApp"));

function App() {
  return <ErrorBoundary><Suspense fallback={<div aria-live="polite">Carregando Truco Tchê…</div>}><GameApp /></Suspense></ErrorBoundary>;
}

export default App;
