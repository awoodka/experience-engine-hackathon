import { useState, useEffect } from "react";
import VideoCard from "./VideoCard";
import VideoModal from "./VideoModal";

interface TutorialMeta {
  id: string;
  title: string;
  description: string;
  generatedAt: string;
  videoPath: string;
  thumbnailPath: string;
  durationSec?: number;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function TutorialGrid() {
  const [tutorials, setTutorials] = useState<TutorialMeta[] | null>(null);
  const [error, setError] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tutorials")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: TutorialMeta[]) => setTutorials(data))
      .catch(() => setError(true));
  }, []);

  if (!tutorials && !error) {
    return (
      <div className="tut-loading">
        <div className="tut-loading__spinner" />
        <span>Loading tutorials</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tut-error">
        Failed to load tutorials. Is the API server running?
      </div>
    );
  }

  if (tutorials!.length === 0) {
    return (
      <div className="tut-empty">
        <div className="tut-empty__icon">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <h2 className="tut-empty__title">No tutorials yet</h2>
        <p className="tut-empty__desc">
          Generate your first tutorial from the CLI to see it here.
        </p>
        <code className="tut-empty__cmd">{"./ee tutorial-render <slug>"}</code>
        <a href="/" className="tut-empty__link">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Go to Chat
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="tut-header">
        <h1 className="tut-header__title">Tutorials</h1>
        <hr className="tut-header__rule" />
        <p className="tut-header__meta">
          Behavioral micro-lessons generated from on-site video analysis
        </p>
        <p className="tut-header__count">
          {tutorials!.length} tutorial{tutorials!.length === 1 ? "" : "s"}{" "}
          generated
        </p>
      </div>

      <div className="tut-grid">
        {tutorials!.map((t, i) => (
          <VideoCard
            key={t.id}
            title={t.title}
            description={t.description}
            thumbnailPath={`/${t.thumbnailPath}`}
            durationSec={t.durationSec}
            date={formatDate(t.generatedAt)}
            index={i}
            onClick={() => setPlayingVideo(`/${t.videoPath}`)}
          />
        ))}
      </div>

      {playingVideo && (
        <VideoModal src={playingVideo} onClose={() => setPlayingVideo(null)} />
      )}
    </>
  );
}
