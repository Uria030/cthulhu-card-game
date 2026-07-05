const KEY = 'ug_selected_save';

export interface SelectedSave {
  id: string;
  slot: number;
  template_id: string;
  campaign_id?: string | null;
}

export function getSelectedSave(): SelectedSave | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value.id === 'string' ? value as SelectedSave : null;
  } catch {
    return null;
  }
}

export function setSelectedSave(save: SelectedSave): void {
  localStorage.setItem(KEY, JSON.stringify(save));
}

export function clearSelectedSave(): void {
  localStorage.removeItem(KEY);
}
