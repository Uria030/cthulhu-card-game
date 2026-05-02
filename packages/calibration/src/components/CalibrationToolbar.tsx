/**
 * CalibrationToolbar — 校準模式上方工具列。
 *
 * 內容:
 *  - 「玩家模式」「校準模式」切換
 *  - Undo / Redo
 *  - 載入 JSON / 下載 JSON / Reset
 *  - 已修改數量徽章
 *
 * 自動隱藏:isCalibrating === false 時不渲染。
 */
import { useRef } from 'react';
import { useCalibrationContext } from './CalibrationContext';
import styles from '../styles/calibration.module.css';

export function CalibrationToolbar() {
  const { api } = useCalibrationContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!api.isCalibrating) return null;

  const handleLoadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await api.loadJson(file);
    } catch (err) {
      window.alert(`載入失敗:${(err as Error).message}`);
    } finally {
      // 允許重複載入同一檔案
      e.target.value = '';
    }
  };

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="校準工具列">
      <div className={styles.toolbarGroup}>
        <span className={styles.toolbarBadge}>校準模式</span>
        {api.modifiedIds.size > 0 && (
          <span className={styles.toolbarModifiedBadge}>
            已修改 {api.modifiedIds.size}
          </span>
        )}
      </div>

      <div className={styles.toolbarGroup}>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={api.undo}
          disabled={!api.canUndo}
          title="Undo (Cmd/Ctrl+Z)"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={api.redo}
          disabled={!api.canRedo}
          title="Redo (Cmd/Ctrl+Shift+Z)"
        >
          ↷ Redo
        </button>
      </div>

      <div className={styles.toolbarGroup}>
        <button type="button" className={styles.toolbarBtn} onClick={handleLoadClick}>
          載入 JSON
        </button>
        <button
          type="button"
          className={styles.toolbarBtnPrimary}
          onClick={api.downloadJson}
        >
          下載 JSON
        </button>
        <button
          type="button"
          className={styles.toolbarBtnDanger}
          onClick={() => {
            if (window.confirm('確定要重設為出廠預設嗎?未下載的修改會遺失。')) {
              api.resetToDefault();
            }
          }}
        >
          Reset
        </button>
      </div>

      <div className={styles.toolbarGroup}>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={api.exitCalibration}
          title="Esc"
        >
          退出
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        hidden
        onChange={handleFileChange}
      />
    </div>
  );
}
