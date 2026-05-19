import { NavLink, Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import Area from "./pages/Area";
import Compare from "./pages/Compare";
import Dashboard from "./pages/Dashboard";
import FlightDetail from "./pages/FlightDetail";
import FlightPhase from "./pages/FlightPhase";
import PilotAnalysis from "./pages/PilotAnalysis";
import Statistics from "./pages/Statistics";
import Weather from "./pages/Weather";

export default function App() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}

function AppShell() {
  return (
    <div className="app">
      <nav className="nav">
        <span className="nav-brand">🛩 Glider Flight Analyzer</span>
        <NavLink to="/" end>ダッシュボード</NavLink>
        <NavLink to="/compare">比較</NavLink>
        <NavLink to="/statistics">統計</NavLink>
        <NavLink to="/pilot-analysis">パイロット分析</NavLink>
        <NavLink to="/area">エリア分析</NavLink>
        <NavLink to="/weather">気象分析</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/flights/:id" element={<FlightDetail />} />
          <Route path="/flights/:id/phase" element={<FlightPhase />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/statistics" element={<Statistics />} />
          <Route path="/pilot-analysis" element={<PilotAnalysis />} />
          <Route path="/area" element={<Area />} />
          <Route path="/weather" element={<Weather />} />
        </Routes>
      </main>
    </div>
  );
}
