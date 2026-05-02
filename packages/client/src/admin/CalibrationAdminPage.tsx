/**
 * CalibrationAdminPage — 後台「介面校準」入口
 *
 * 列出所有可校準的遊戲畫面,點擊後跳轉到該畫面 ?calibrate=1。
 * SDK 在目標畫面掛載時,permissionCheck 通過會自動進入校準模式。
 *
 * 未來新增遊戲畫面要校準,在 SURFACES 陣列追加一筆即可。
 */
import { useNavigate } from 'react-router-dom';
import { useCalibrationPermission } from './useCalibrationPermission';
import './CalibrationAdminPage.css';

interface SurfaceEntry {
  id: string;
  label: string;
  route: string;
  description: string;
  status: 'live' | 'planned';
}

const SURFACES: SurfaceEntry[] = [
  {
    id: 'study-room',
    label: '書房(大廳)',
    route: '/lobby',
    description: '12 個熱區:整備七物件(帳本/天平/香爐/砧板/藥瓶/厚書/文件)+ 地圖紙 + 四椅子',
    status: 'live',
  },
  {
    id: 'departure-board',
    label: '出發板',
    route: '/departure',
    description: '(規劃中)任務選擇/章節分支',
    status: 'planned',
  },
  {
    id: 'combat',
    label: '戰鬥畫面',
    route: '/combat',
    description: '(規劃中)行動/卡牌區/敵方區',
    status: 'planned',
  },
];

export function CalibrationAdminPage() {
  const navigate = useNavigate();
  const canCalibrate = useCalibrationPermission();

  if (!canCalibrate) {
    return (
      <main className="calib-admin-root">
        <h1 className="calib-admin-title">介面校準</h1>
        <p className="calib-admin-warn">
          需要管理員權限。請先到既有 admin 後台登入,或在 URL 加 <code>?admin=1</code> 模擬。
        </p>
      </main>
    );
  }

  const enter = (surface: SurfaceEntry) => {
    if (surface.status === 'planned') {
      alert(`「${surface.label}」尚未實作,無法進入校準`);
      return;
    }
    navigate(`${surface.route}?calibrate=1`);
  };

  return (
    <main className="calib-admin-root">
      <header className="calib-admin-header">
        <h1 className="calib-admin-title">介面校準</h1>
        <p className="calib-admin-sub">
          選擇一個介面進入校準模式 — 拖曳熱區位置/形狀,完成後下載 JSON 蓋回
          <code>packages/client/public/surfaces/&lt;id&gt;/hotspots.json</code>。
        </p>
      </header>

      <ul className="calib-admin-list">
        {SURFACES.map((s) => (
          <li key={s.id} className={`calib-admin-item calib-admin-item-${s.status}`}>
            <div className="calib-admin-item-info">
              <div className="calib-admin-item-title">
                {s.label} <code className="calib-admin-item-id">{s.id}</code>
                {s.status === 'planned' && <span className="calib-admin-item-badge">規劃中</span>}
              </div>
              <div className="calib-admin-item-desc">{s.description}</div>
            </div>
            <button
              type="button"
              className="calib-admin-enter"
              onClick={() => enter(s)}
              disabled={s.status !== 'live'}
            >
              進入校準 →
            </button>
          </li>
        ))}
      </ul>

      <section className="calib-admin-help">
        <h3>觸發方式</h3>
        <ul>
          <li>後台本頁「進入校準」按鈕(主流程)</li>
          <li>URL 參數 <code>?calibrate=1</code>(可分享連結直接進)</li>
          <li>在校準介面內按 <kbd>Shift</kbd> + <kbd>C</kbd>(鍵盤快捷)</li>
        </ul>
      </section>
    </main>
  );
}
