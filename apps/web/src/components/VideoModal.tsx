import { useEffect, useRef } from "react";

interface VideoModalProps {
  src: string;
  onClose: () => void;
}

export default function VideoModal({ src, onClose }: VideoModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="video-modal">
      <div className="video-modal__backdrop" onClick={onClose} />
      <div className="video-modal__inner">
        <button
          onClick={onClose}
          aria-label="Close video"
          className="video-modal__close"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <video
          ref={videoRef}
          src={src}
          controls
          autoPlay
          className="video-modal__video"
        />
      </div>
    </div>
  );
}
