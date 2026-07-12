import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export interface LobbyPropPosition {
  left: string;
  top: string;
  width: string;
  height: string;
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
      style={position as CSSProperties}
      onClick={onActivate}
      aria-label={`${label}：${detail}`}
    >
      {children}
      <span className="lobby-prop-label"><strong>{label}</strong><small>{detail}</small></span>
    </button>
  );
}

export function LobbyLightningEffect() {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let triggerTimer = 0;
    let clearTimer = 0;
    let echoTimer = 0;
    const schedule = () => {
      triggerTimer = window.setTimeout(() => {
        setFlash(true);
        clearTimer = window.setTimeout(() => setFlash(false), 110);
        echoTimer = window.setTimeout(() => {
          setFlash(true);
          clearTimer = window.setTimeout(() => {
            setFlash(false);
            schedule();
          }, 70);
        }, 190);
      }, 5_000 + Math.round(Math.random() * 8_000));
    };
    schedule();
    return () => {
      window.clearTimeout(triggerTimer);
      window.clearTimeout(clearTimer);
      window.clearTimeout(echoTimer);
    };
  }, []);

  return <div className={'lobby-lightning' + (flash ? ' flash' : '')} aria-hidden />;
}

export function LobbyFireplaceEffect() {
  return (
    <div className="lobby-fireplace" aria-hidden>
      <span className="lobby-flame flame-a" />
      <span className="lobby-flame flame-b" />
      <span className="lobby-flame flame-c" />
    </div>
  );
}

export function LobbyAmbientScene() {
  return (
    <>
      <LobbyLightningEffect />
      <LobbyFireplaceEffect />
      <div className="lobby-film-grain" aria-hidden />
    </>
  );
}
