# @cthulhu/calibration

不可名狀遊戲 — 通用熱區校準 SDK。

把任何介面的「點擊熱區」變成可被管理員即時校準的 SVG 圖層,並把座標序列化為 v2 schema 的 JSON。

## 快速開始

```tsx
import {
  CalibrationProvider,
  CalibrationSurface,
  CalibrationToolbar,
  CalibrationPanel,
  HandleLayer,
  Hotspot,
} from '@cthulhu/calibration';
import '@cthulhu/calibration/styles';
import hotspots from './study-room.hotspots.json';

export function StudyRoomScene() {
  return (
    <CalibrationProvider
      surface="study-room"
      hotspots={hotspots.hotspots}
      viewBox={hotspots.viewBox}
      permissionCheck={() => isAdmin()}
    >
      <CalibrationToolbar />
      <CalibrationPanel />
      <CalibrationSurface
        background={{
          src: '/surfaces/study-room/bg-1920.webp',
          alt: '書房',
        }}
      >
        {hotspots.hotspots.map((hs) => (
          <Hotspot key={hs.id} {...hs} />
        ))}
        <HandleLayer />
      </CalibrationSurface>
    </CalibrationProvider>
  );
}
```

## 觸發校準模式

| 觸發方式 | 條件 |
|---|---|
| 鍵盤 `Shift + C` | 通過 `permissionCheck` |
| URL `?calibrate=1` | 通過 `permissionCheck` |
| 程式呼叫 `useCalibration().enterCalibration()` | 通過 `permissionCheck` |

## 業務層接收熱區點擊

```tsx
useEffect(() => {
  const handler = (e: CustomEvent) => {
    if (e.detail.surface !== 'study-room') return;
    if (e.detail.hotspotId === 'prep.deck') openDeckEditor();
  };
  window.addEventListener('hotspot-click', handler as EventListener);
  return () => window.removeEventListener('hotspot-click', handler as EventListener);
}, []);
```

詳見 `HANDOFF.md`。
