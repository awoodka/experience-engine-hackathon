interface VideoCardProps {
  title: string;
  description?: string;
  thumbnailPath: string;
  durationSec?: number;
  date?: string;
  index?: number;
  badge?: { label: string; color: string };
  onClick: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VideoCard({
  title,
  description,
  thumbnailPath,
  durationSec,
  date,
  index = 0,
  badge,
  onClick,
}: VideoCardProps) {
  return (
    <div
      className="video-card"
      style={{ "--card-index": index } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`Play ${title}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="video-card__thumb">
        <img
          src={thumbnailPath}
          alt={title}
          className="video-card__thumb-img"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />

        <div className="video-card__play">
          <div className="video-card__play-circle">
            <svg
              className="video-card__play-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>

        {badge && (
          <span
            className="video-card__badge"
            style={{ "--badge-color": badge.color } as React.CSSProperties}
          >
            {badge.label}
          </span>
        )}

        {durationSec != null && (
          <span className="video-card__duration">
            {formatDuration(durationSec)}
          </span>
        )}
      </div>

      <div className="video-card__info">
        <h3 className="video-card__title">{title}</h3>
        {description && <p className="video-card__desc">{description}</p>}
        {date && (
          <div className="video-card__meta">
            <span className="video-card__date">{date}</span>
          </div>
        )}
      </div>
    </div>
  );
}
