import type { CSSProperties, ReactNode } from 'react';

export interface LobbyPropPosition {
  left: string;
  top: string;
  size: string;
}

export function InteractiveLobbyProp({
  label,
  detail,
  position,
  available,
  children,
  onActivate,
}: {
  label: string;
  detail: string;
  position: LobbyPropPosition;
  available: boolean;
  children?: ReactNode;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      className={'lobby-prop' + (available ? ' available' : ' reserved')}
      style={{
        '--prop-left': position.left,
        '--prop-top': position.top,
        '--prop-size': position.size,
      } as CSSProperties}
      onClick={onActivate}
      aria-label={`${label}：${detail}`}
    >
      {children}
      <span className="lobby-prop-label"><strong>{label}</strong><small>{detail}</small></span>
    </button>
  );
}

export function LobbyFilmGrain() {
  return <div className="lobby-film-grain" aria-hidden />;
}
