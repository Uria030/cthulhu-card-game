import { AI_INVESTIGATOR_ROSTER } from '@cthulhu/shared';

const KEY = 'ug_selected_party';

function toTemplateId(value: string): string {
  return AI_INVESTIGATOR_ROSTER.find((p) => p.rosterCode === value)?.templateId ?? value;
}

export function getPartyTemplateIds(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === 'string')
      ? (v as string[]).map(toTemplateId)
      : null;
  } catch {
    return null;
  }
}

export function setPartyTemplateIds(templateIds: string[]): void {
  localStorage.setItem(KEY, JSON.stringify(templateIds));
}

export const getPartyCodes = getPartyTemplateIds;
export const setPartyCodes = setPartyTemplateIds;
