/**
 * CalibrationAdminPage — 後台「介面校準」Mod
 *
 * 設計:
 *  - 整個視窗(position: fixed inset:0)讓給選中的 surface 全螢幕渲染
 *  - 左上角 hamburger 按鈕展開「介面清單」抽屜
 *  - 進頁自動進校準模式 → SDK Toolbar(頂部居中)+ Panel(右側)自動浮現
 *
 * 權限:admin / owner 才能進入,否則自動跳 /admin/login.html。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CalibrationProvider,
  CalibrationSurface,
  CalibrationToolbar,
  CalibrationPanel,
  HandleLayer,
  Hotspot,
  parseHotspotsJson,
  useCalibrationContext,
  type HotspotsJsonV2,
  type ViewBox,
} from '@cthulhu/calibration';
import '@cthulhu/calibration/styles';

import studyRoomJson from '../data/surfaces/study-room/hotspots.json';
import './CalibrationAdminPage.css';

interface SurfaceEntry {
  id: string;
  label: string;
  description: string;
  status: 'live' | 'planned';
  json?: unknown;
  viewBox?: ViewBox;
  background?: { src: string; alt: string };
}

const SURFACES: SurfaceEntry[] = [
  {
    id: 'study-room',
    label: '書房(大廳)',
    description: '12 個熱區:整備七物件 + 地圖紙 + 四椅子',
    status: 'live',
    json: studyRoomJson,
    viewBox: { width: 1408, height: 800 },
    background: { src: '/surfaces/study-room/bg.webp', alt: '書房俯瞰場景' },
  },
  {
    id: 'departure-board',
    label: '出發板',
    description: '(規劃中)任務選擇 / 章節分支',
    status: 'planned',
  },
  {
    id: 'combat',
    label: '戰鬥畫面',
    description: '(規劃中)行動 / 卡牌區 / 敵方區',
    status: 'planned',
  },
];

interface AdminUser {
  role?: string;
  username?: string;
  displayName?: string;
}

type AuthState =
  | { kind: 'checking' }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden'; user: AdminUser }
  | { kind: 'ok'; user: AdminUser };

function readAdminUser(): AdminUser | null {
  try {
    const raw = localStorage.getItem('admin_user');
    if (!raw) return null;
    return JSON.parse(raw) as AdminUser;
  } catch {
    return null;
  }
}

export function CalibrationAdminPage() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'checking' });
  const [selectedId, setSelectedId] = useState<string>(
    SURFACES.find((s) => s.status === 'live')?.id ?? '',
  );
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [panelHidden, setPanelHidden] = useState<boolean>(false);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      window.location.href = '/admin/login.html';
      setAuth({ kind: 'unauthenticated' });
      return;
    }
    const user = readAdminUser();
    if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
      setAuth({ kind: 'forbidden', user: user ?? {} });
      return;
    }
    setAuth({ kind: 'ok', user });
  }, []);

  useEffect(() => {
    if (panelHidden) document.body.setAttribute('data-calib-panel', 'closed');
    else document.body.removeAttribute('data-calib-panel');
    return () => document.body.removeAttribute('data-calib-panel');
  }, [panelHidden]);

  if (auth.kind === 'checking' || auth.kind === 'unauthenticated') {
    return (
      <main className="calib-admin-loading">
        <p>驗證中⋯</p>
      </main>
    );
  }

  if (auth.kind === 'forbidden') {
    return (
      <main className="calib-admin-loading">
        <h1>權限不足</h1>
        <p>
          本 Mod 限 admin / owner 進入,目前角色:
          <code>{auth.user.role ?? 'unknown'}</code>
        </p>
        <a href="/admin/index.html">← 回後台首頁</a>
      </main>
    );
  }

  const selected = SURFACES.find((s) => s.id === selectedId);

  return (
    <div className="calib-admin-shell">
      {selected && selected.status === 'live' ? (
        <CalibrationStage entry={selected} />
      ) : (
        <div className="calib-admin-empty">請從清單選擇一個 live 介面</div>
      )}

      <button
        type="button"
        className="calib-admin-hamburger"
        onClick={() => setDrawerOpen((v) => !v)}
        aria-label="切換介面清單"
      >
        ☰ 介面清單
      </button>

      <button
        type="button"
        className="calib-admin-panel-toggle"
        onClick={() => setPanelHidden((v) => !v)}
        aria-label="切換熱區清單"
      >
        {panelHidden ? '☷ 熱區清單' : '✕ 收起清單'}
      </button>

      {drawerOpen && (
        <div
          className="calib-admin-drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside
        className={`calib-admin-drawer ${drawerOpen ? 'is-open' : ''}`}
        aria-hidden={!drawerOpen}
      >
        <header className="calib-admin-drawer-head">
          <h2>介面校準</h2>
          <button
            type="button"
            className="calib-admin-drawer-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="關閉抽屜"
          >
            ✕
          </button>
        </header>

        <ul className="calib-admin-list">
          {SURFACES.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`calib-admin-tab calib-admin-tab-${s.status} ${
                  s.id === selectedId ? 'is-selected' : ''
                }`}
                onClick={() => {
                  if (s.status !== 'live') return;
                  setSelectedId(s.id);
                  setDrawerOpen(false);
                }}
                disabled={s.status !== 'live'}
              >
                <div className="calib-admin-tab-title">{s.label}</div>
                <div className="calib-admin-tab-desc">{s.description}</div>
                {s.status === 'planned' && (
                  <span className="calib-admin-tab-badge">規劃中</span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="calib-admin-help">
          <h3>操作</h3>
          <ul>
            <li>進頁自動進校準模式</li>
            <li>頂部 Toolbar:Undo / Redo / 載入 / 下載 JSON / Reset</li>
            <li>右側 Panel:熱區清單(點擊選取)</li>
            <li>拖把手調形狀,拖熱區移位置</li>
            <li>「下載 JSON」匯出後覆蓋 <code>packages/client/public/surfaces/&lt;id&gt;/hotspots.json</code></li>
          </ul>
          <a className="calib-admin-back" href="/admin/index.html">
            ← 回後台首頁
          </a>
        </div>
      </aside>
    </div>
  );
}

interface CalibrationStageProps {
  entry: SurfaceEntry;
}

function CalibrationStage({ entry }: CalibrationStageProps) {
  const parsed: HotspotsJsonV2 | null = useMemo(() => {
    if (!entry.json || !entry.viewBox) return null;
    return parseHotspotsJson(entry.json, {
      fallbackSurface: entry.id,
      fallbackViewBox: entry.viewBox,
    });
  }, [entry]);

  if (!parsed || !entry.background) return null;

  const onSaveJson = (json: HotspotsJsonV2) => {
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${entry.id}.hotspots.${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.info(
      `[calib-admin] 下載完成 → 請覆蓋至 packages/client/public/surfaces/${entry.id}/hotspots.json`,
    );
  };

  return (
    <CalibrationProvider
      key={entry.id}
      surface={entry.id}
      hotspots={parsed.hotspots}
      viewBox={parsed.viewBox}
      onSaveJson={onSaveJson}
      permissionCheck={() => true}
    >
      <AutoEnterCalibration />
      <CalibrationToolbar />
      <CalibrationPanel />
      <div className="calib-admin-stage">
        <CalibrationSurface background={entry.background}>
          <HotspotsLive />
          <HandleLayer />
        </CalibrationSurface>
      </div>
    </CalibrationProvider>
  );
}

/**
 * 用 context 的 live api.hotspots 渲染熱區,確保拖頂點時反應區域立即跟隨。
 * 不可改用 props.hotspots(初始值)— 那是初始 snapshot,拖了不會更新。
 */
function HotspotsLive() {
  const { api } = useCalibrationContext();
  return (
    <>
      {api.hotspots.map((hs) => (
        <Hotspot key={hs.id} {...hs} />
      ))}
    </>
  );
}

function AutoEnterCalibration() {
  const { api } = useCalibrationContext();
  useEffect(() => {
    if (!api.isCalibrating) api.enterCalibration();
  }, [api]);
  return null;
}
