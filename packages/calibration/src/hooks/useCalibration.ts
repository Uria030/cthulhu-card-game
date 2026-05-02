/**
 * useCalibration — 主 Hook
 *
 * 內部:狀態機(校準開關 + 選取 + Undo/Redo 歷程 + 草稿)
 * 對外:CalibrationApi(由 Provider 包成 Context)
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type {
  CalibrationApi,
  HotspotData,
  HotspotsJsonV2,
  PermissionCheck,
  SaveJsonHandler,
  ViewBox,
} from '../types';
import { clone } from '../utils/shapes';
import {
  packHotspotsJson,
  parseHotspotsJson,
  JsonSchemaError,
} from '../utils/jsonSchema';
import { saveDraft, loadDraft, clearDraft } from '../utils/storage';

// ─── State / Action ─────────────────────────────────────

interface State {
  isCalibrating: boolean;
  hotspots: HotspotData[];
  selectedId: string | null;
  history: HotspotData[][]; // 過去快照(不含當前)
  future: HotspotData[][]; // 已 undo 的快照
  modifiedIds: Set<string>;
  defaults: HotspotData[]; // 出廠預設(reset 用)
}

type Action =
  | { type: 'enter' }
  | { type: 'exit' }
  | { type: 'select'; id: string | null }
  | { type: 'commit'; next: HotspotData[]; modifiedId?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }
  | { type: 'load'; hotspots: HotspotData[]; resetHistory?: boolean };

const HISTORY_LIMIT = 50;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'enter':
      return { ...state, isCalibrating: true };
    case 'exit':
      return { ...state, isCalibrating: false, selectedId: null };
    case 'select':
      return { ...state, selectedId: action.id };
    case 'commit': {
      const history = [...state.history, state.hotspots];
      while (history.length > HISTORY_LIMIT) history.shift();
      const modified = new Set(state.modifiedIds);
      if (action.modifiedId) modified.add(action.modifiedId);
      return {
        ...state,
        hotspots: action.next,
        history,
        future: [],
        modifiedIds: modified,
      };
    }
    case 'undo': {
      if (state.history.length === 0) return state;
      const prev = state.history[state.history.length - 1];
      return {
        ...state,
        hotspots: prev,
        history: state.history.slice(0, -1),
        future: [state.hotspots, ...state.future],
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [nextHs, ...rest] = state.future;
      return {
        ...state,
        hotspots: nextHs,
        history: [...state.history, state.hotspots],
        future: rest,
      };
    }
    case 'reset': {
      return {
        ...state,
        hotspots: clone(state.defaults),
        history: [...state.history, state.hotspots],
        future: [],
        modifiedIds: new Set(),
        selectedId: null,
      };
    }
    case 'load': {
      return action.resetHistory
        ? {
            ...state,
            hotspots: action.hotspots,
            history: [],
            future: [],
            modifiedIds: new Set(),
            selectedId: null,
          }
        : {
            ...state,
            hotspots: action.hotspots,
            history: [...state.history, state.hotspots],
            future: [],
            modifiedIds: new Set(action.hotspots.map((h) => h.id)),
          };
    }
    default:
      return state;
  }
}

// ─── Hook ───────────────────────────────────────────────

export interface UseCalibrationArgs {
  surface: string;
  initialHotspots: HotspotData[];
  viewBox: ViewBox;
  onSaveJson?: SaveJsonHandler;
  permissionCheck?: PermissionCheck;
  enableKeyboardShortcut?: boolean;
  enableUrlTrigger?: boolean;
}

/**
 * 由 CalibrationProvider 內部使用。
 * 業務元件想讀狀態請改用 useCalibrationContext()。
 */
export function useCalibrationCore(args: UseCalibrationArgs): {
  api: CalibrationApi;
  /** 內部:commit 函式,供 Hotspot 拖曳結束時呼叫 */
  commit: (next: HotspotData[], modifiedId?: string) => void;
} {
  const {
    surface,
    initialHotspots,
    viewBox,
    onSaveJson,
    permissionCheck,
    enableKeyboardShortcut = true,
    enableUrlTrigger = true,
  } = args;

  // 嘗試讀取草稿,若無則用初始值
  const startingHotspots = useMemo(() => {
    const draft = loadDraft(surface);
    return draft ? draft.hotspots : initialHotspots;
    // surface / initialHotspots 變動才重算
  }, [surface, initialHotspots]);

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    isCalibrating: false,
    hotspots: startingHotspots,
    selectedId: null,
    history: [],
    future: [],
    modifiedIds: new Set<string>(),
    defaults: clone(initialHotspots),
  }));

  // ─── 權限檢查 ──────────────────────────────────────
  const checkPermission = useCallback((): boolean => {
    if (!permissionCheck) return false;
    return permissionCheck();
  }, [permissionCheck]);

  // ─── 進入 / 退出 ───────────────────────────────────
  const enterCalibration = useCallback(() => {
    if (!checkPermission()) {
      console.warn('[ug-calibration] 權限不足,拒絕進入校準模式');
      return;
    }
    dispatch({ type: 'enter' });
  }, [checkPermission]);

  const exitCalibration = useCallback(() => {
    dispatch({ type: 'exit' });
  }, []);

  const toggleCalibration = useCallback(() => {
    if (state.isCalibrating) exitCalibration();
    else enterCalibration();
  }, [state.isCalibrating, enterCalibration, exitCalibration]);

  // ─── URL 參數觸發 ──────────────────────────────────
  const urlTriggeredRef = useRef(false);
  useEffect(() => {
    if (!enableUrlTrigger || urlTriggeredRef.current) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('calibrate') === '1') {
      urlTriggeredRef.current = true;
      // 延後一拍,確保 Provider 已掛載完成
      const t = window.setTimeout(() => enterCalibration(), 0);
      return () => window.clearTimeout(t);
    }
  }, [enableUrlTrigger, enterCalibration]);

  // ─── 鍵盤快捷鍵 ────────────────────────────────────
  useEffect(() => {
    if (!enableKeyboardShortcut) return;
    if (typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      // Shift + C 切換校準
      if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        toggleCalibration();
        return;
      }
      if (!state.isCalibrating) return;
      // Cmd/Ctrl + Z = Undo,Cmd/Ctrl + Shift + Z = Redo
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) dispatch({ type: 'redo' });
        else dispatch({ type: 'undo' });
      }
      if (e.key === 'Escape') {
        if (state.selectedId) dispatch({ type: 'select', id: null });
        else exitCalibration();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    enableKeyboardShortcut,
    state.isCalibrating,
    state.selectedId,
    toggleCalibration,
    exitCalibration,
  ]);

  // ─── 草稿自動儲存 ──────────────────────────────────
  useEffect(() => {
    if (state.modifiedIds.size === 0) return;
    saveDraft(surface, state.hotspots);
  }, [surface, state.hotspots, state.modifiedIds]);

  // ─── 操作:commit / undo / redo / reset ────────────
  const commit = useCallback(
    (next: HotspotData[], modifiedId?: string) => {
      dispatch({ type: 'commit', next, modifiedId });
    },
    [],
  );

  const selectHotspot = useCallback((id: string | null) => {
    dispatch({ type: 'select', id });
  }, []);

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  const resetToDefault = useCallback(() => {
    dispatch({ type: 'reset' });
    clearDraft(surface);
  }, [surface]);

  // ─── 下載 JSON ─────────────────────────────────────
  const downloadJson = useCallback(() => {
    const json = packHotspotsJson({
      surface,
      viewBox,
      hotspots: state.hotspots,
      metadata: {
        calibratedAt: new Date().toISOString(),
      },
    });
    if (onSaveJson) {
      void onSaveJson(json);
      return;
    }
    // fallback:瀏覽器下載
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${surface}.hotspots.${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [surface, viewBox, state.hotspots, onSaveJson]);

  // ─── 載入 JSON ─────────────────────────────────────
  const loadJson = useCallback(
    async (file: File): Promise<void> => {
      const text = await file.text();
      let parsed: HotspotsJsonV2;
      try {
        const raw = JSON.parse(text) as unknown;
        parsed = parseHotspotsJson(raw, {
          fallbackSurface: surface,
          fallbackViewBox: viewBox,
        });
      } catch (err) {
        if (err instanceof JsonSchemaError) throw err;
        throw new JsonSchemaError(`JSON 解析失敗: ${(err as Error).message}`);
      }
      if (parsed.surface !== surface) {
        throw new JsonSchemaError(
          `JSON 的 surface (${parsed.surface}) 與當前介面 (${surface}) 不符`,
        );
      }
      dispatch({ type: 'load', hotspots: parsed.hotspots, resetHistory: false });
    },
    [surface, viewBox],
  );

  const api: CalibrationApi = {
    isCalibrating: state.isCalibrating,
    enterCalibration,
    exitCalibration,
    toggleCalibration,
    hotspots: state.hotspots,
    selectedId: state.selectedId,
    selectHotspot,
    downloadJson,
    loadJson,
    resetToDefault,
    modifiedIds: state.modifiedIds,
    canUndo: state.history.length > 0,
    canRedo: state.future.length > 0,
    undo,
    redo,
  };

  return { api, commit };
}
