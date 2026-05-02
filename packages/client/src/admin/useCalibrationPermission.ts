/**
 * useCalibrationPermission — 校準權限 Hook
 *
 * 規格(校準工具升級為通用基礎設施 §4.3)要求兩道驗證:
 *   1. 前端快速攔下(本 Hook) — 使用者沒有 admin 權限就不掛載校準 UI
 *   2. 伺服器端在 onSaveJson POST 時必須再次驗證(本檔不負責)
 *
 * 本專案 admin auth 規約:
 *   - localStorage.admin_token = JWT
 *   - localStorage.admin_user  = JSON 字串(含 role)
 * 既有 packages/client/public/admin/admin-shared.js 一致。
 *
 * Dev escape hatch:URL 加 ?admin=1 模擬管理員(僅前端,後端仍會擋)。
 */
import { useMemo } from 'react';

interface AdminUser {
  role?: string;
  username?: string;
}

function readAdminUser(): AdminUser | null {
  try {
    const raw = localStorage.getItem('admin_user');
    if (!raw) return null;
    return JSON.parse(raw) as AdminUser;
  } catch {
    return null;
  }
}

export function useCalibrationPermission(): boolean {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === '1') return true;
    const token = localStorage.getItem('admin_token');
    if (!token) return false;
    const user = readAdminUser();
    return !!user && user.role === 'admin';
  }, []);
}
