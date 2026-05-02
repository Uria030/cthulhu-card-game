/**
 * CalibrationAdminPage — 後台「介面校準」Mod
 *
 * 系統管理員工具:在後台內嵌渲染遊戲畫面骨架,直接拖曳調整熱區位置/形狀,
 * 完成後下載 hotspots.json 蓋回 packages/client/public/surfaces/<id>/。
 *
 * 權限:只有 admin / owner 可進入。
 *   - 沒 admin_token   → 自動跳 /admin/login.html
 *   - role < admin     → 顯示「權限不足」訊息
 *
 * 未來新增遊戲畫面要校準,在 SURFACES 陣列追加一筆即可。
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
  /** live 場景必填:hotspots.json 與 viewBox */
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

  if (auth.kind === 'checking' || auth.kind === 'unauthenticated') {
    return (
      <main className="calib-admin-root">
        <h1 className="calib-admin-title">介面校準</h1>
        <p className="calib-admin-sub">驗證中⋯</p>
      </main>
    );
  }

  if (auth.kind === 'forbidden') {
    return (
      <main className="calib-admin-root">
        <h1 className="calib-admin-title">介面校準</h1>
        <p className="calib-admin-warn">
          權限不足。本 Mod 限 <strong>admin / owner</strong> 進入,
          目前角色:<code>{auth.user.role ?? 'unknown'}</code>。請聯絡管理員調整權限。
        </p>
        <p className="calib-admin-sub">
          <a href="/admin/index.html">← 回後台首頁</a>
        </p>
      </main>
    );
  }

  const selected = SURFACES.find((s) => s.id === selectedId);

  return (
    <main className="calib-admin-root calib-admin-root-wide">
      <header className="calib-admin-header">
        <h1 className="calib-admin-title">介面校準</h1>
        <p className="calib-admin-sub">
          選擇左側介面 → 進入校準 → 拖曳熱區 →「下載 JSON」覆蓋
          <code>packages/client/public/surfaces/&lt;id&gt;/hotspots.json</code>
        </p>
      </header>

      <div className="calib-admin-layout">
        <aside className="calib-admin-sidebar">
          <h3 className="calib-admin-sidebar-title">介面清單</h3>
          <ul className="calib-admin-list">
            {SURFACES.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`calib-admin-tab calib-admin-tab-${s.status} ${
                    s.id === selectedId ? 'is-selected' : ''
                  }`}
                  onClick={() => s.status === 'live' && setSelectedId(s.id)}
                  disabled={s.status !== 'live'}
                  title={s.status === 'planned' ? '尚未實作' : ''}
                >
                  <div className="calib-admin-tab-title">{s.label}</div>
                  <div className="calib-admin-tab-desc">{s.description}</div>
                  {s.status === 'planned' && (
                    <span className="calib-admin-item-badge">規劃中</span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <div className="calib-admin-help">
            <h3>操作</h3>
            <ul>
              <li>校準預設關閉,點 Toolbar「進入校準」啟動</li>
              <li>拖把手調形狀;拖熱區移動位置</li>
              <li>支援 <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd> 復原/重做</li>
              <li>「下載 JSON」匯出後覆蓋對應 surface 檔案</li>
            </ul>
          </div>
        </aside>

        <section className="calib-admin-stage">
          {selected && selected.status === 'live' ? (
            <CalibrationStage entry={selected} />
          ) : (
            <div className="calib-admin-empty">
              請從左側選擇一個 live 介面
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

interface CalibrationStageProps {
  entry: SurfaceEntry;
}

function CalibrationStage({ entry }: CalibrationStageProps) {
  const parsed = useMemo(() => {
    if (!entry.json || !entry.viewBox) return null;
    return parseHotspotsJson(entry.json, {
      fallbackSurface: entry.id,
      fallbackViewBox: entry.viewBox,
    });
  }, [entry]);

  if (!parsed || !entry.background) return null;

  const onSaveJson = (json: HotspotsJsonV2) => {
    // 走 SDK 預設下載行為(包裝後同樣會走 fallback);這裡只用來 console 提示
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
      `[calib-admin] 下載完成 → 請覆蓋至 packages/client/public/surfaces/${entry.id}/hotspots.json,然後 commit`,
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
      <CalibrationToolbar />
      <CalibrationPanel />
      <CalibrationSurface background={entry.background}>
        {parsed.hotspots.map((hs) => (
          <Hotspot key={hs.id} {...hs} />
        ))}
        <HandleLayer />
      </CalibrationSurface>
    </CalibrationProvider>
  );
}
