/**
 * CalibrationPanel — 校準模式右側面板:熱區清單。
 *
 * 點擊清單項 → 選取對應熱區(Surface 上會顯示把手)。
 * 顯示:label + id + 已修改標記。
 *
 * 依 group 分組顯示。
 */
import { useMemo } from 'react';
import { useCalibrationContext } from './CalibrationContext';
import styles from '../styles/calibration.module.css';

export function CalibrationPanel() {
  const { api } = useCalibrationContext();

  const grouped = useMemo(() => {
    const map = new Map<string, typeof api.hotspots>();
    for (const hs of api.hotspots) {
      const arr = map.get(hs.group) ?? [];
      arr.push(hs);
      map.set(hs.group, arr);
    }
    return Array.from(map.entries());
  }, [api.hotspots]);

  if (!api.isCalibrating) return null;

  return (
    <aside className={styles.panel} aria-label="熱區清單">
      <header className={styles.panelHeader}>
        <span>熱區清單</span>
        <small>{api.hotspots.length}</small>
      </header>
      <div className={styles.panelBody}>
        {grouped.map(([group, items]) => (
          <section key={group} className={styles.panelGroup}>
            <h4 className={styles.panelGroupTitle}>{group}</h4>
            <ul className={styles.panelList}>
              {items.map((hs) => {
                const isSel = api.selectedId === hs.id;
                const isMod = api.modifiedIds.has(hs.id);
                const cls = [
                  styles.panelItem,
                  isSel ? styles.panelItemSelected : '',
                  isMod ? styles.panelItemModified : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <li key={hs.id}>
                    <button
                      type="button"
                      className={cls}
                      onClick={() => api.selectHotspot(hs.id)}
                    >
                      <span className={styles.panelItemLabel}>{hs.label}</span>
                      <span className={styles.panelItemId}>{hs.id}</span>
                      {isMod && <span className={styles.panelItemDot}>●</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <footer className={styles.panelFooter}>
        <small>提示:點擊熱區可選取,拖曳把手調整形狀</small>
      </footer>
    </aside>
  );
}
