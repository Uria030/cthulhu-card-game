import { Routes, Route, Navigate } from 'react-router-dom';
import { SplashScreen } from './screens/SplashScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { SaveManagementScreen } from './screens/SaveManagementScreen';
import { DepartureBoardScreen } from './screens/DepartureBoardScreen';
import { ScenarioBriefingScreen } from './screens/ScenarioBriefingScreen';
import { TestScenarioScreen } from './screens/TestScenarioScreen';
import { MultiplayerRoomScreen } from './screens/MultiplayerRoomScreen';
import { MultiplayerScenarioScreen } from './screens/MultiplayerScenarioScreen';
import { CalibrationAdminPage } from './admin/CalibrationAdminPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<SplashScreen />} />
      <Route path="/lobby" element={<LobbyScreen />} />
      <Route path="/saves" element={<SaveManagementScreen />} />
      <Route path="/departure" element={<DepartureBoardScreen />} />
      {/* :stageId = 'test'(教學寫死)或 stage UUID(DB 開局包) */}
      <Route path="/scenario/:stageId/briefing" element={<ScenarioBriefingScreen />} />
      <Route path="/scenario/:stageId" element={<TestScenarioScreen />} />
      <Route path="/multiplayer" element={<MultiplayerRoomScreen />} />
      <Route path="/multiplayer/:roomCode" element={<MultiplayerRoomScreen />} />
      <Route path="/multiplayer/:roomCode/scenario" element={<MultiplayerScenarioScreen />} />
      <Route path="/admin/calibration" element={<CalibrationAdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
