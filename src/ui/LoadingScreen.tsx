export function LoadingScreen({ progress, label }: { progress: number; label: string }) {
  return (
    <div className="loading">
      <div className="loading-inner">
        <div className="danfo-mark" aria-hidden>
          <span />
          <span />
        </div>
        <h1 className="brand">Real Lagos</h1>
        <p className="loading-sub">A life-sim prototype on the real map of Lagos — Yaba, Lagos Island, Ikoyi, Victoria Island, Lekki Phase 1.</p>
        <div className="bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className="loading-label">{label}</p>
        <p className="attrib-small">
          Map data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap contributors
          </a>
        </p>
      </div>
    </div>
  );
}
