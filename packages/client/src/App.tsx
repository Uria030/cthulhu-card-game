import { Routes, Route, Navigate } from 'react-router-dom';
import { SplashScreen } from './screens/SplashScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { DepartureBoardScreen } from './screens/DepartureBoardScreen';
import { TestScenarioScreen } from './screens/TestScenarioScreen';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<SplashScreen />} />
      <Route path="/lobby" element={<LobbyScreen />} />
      <Route path="/departure" element={<DepartureBoardScreen />} />
      <Route path="/scenario/test" element={<TestScenarioScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
