import { NavLink, Route, Routes } from "react-router-dom";
import Compare from "./pages/Compare";
import Dashboard from "./pages/Dashboard";
import FlightDetail from "./pages/FlightDetail";
import Statistics from "./pages/Statistics";

export default function App() {
  return (
    <div className="app">
      <nav className="nav">
        <span className="nav-brand">🛩 Glider Flight Analyzer</span>
        <NavLink to="/" end>ダッシュボード</NavLink>
        <NavLink to="/compare">比較</NavLink>
        <NavLink to="/statistics">統計</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/flights/:id" element={<FlightDetail />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/statistics" element={<Statistics />} />
        </Routes>
      </main>
    </div>
  );
}
