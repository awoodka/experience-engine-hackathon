import { useState } from "react";
import VideoCard from "./VideoCard";
import VideoModal from "./VideoModal";

type Category = "hesitation" | "attention" | "smoothness" | "coordination";

interface Tutorial {
  id: string;
  title: string;
  description: string;
  thumbnailPath: string;
  videoPath: string;
  durationSec: number;
}

interface Improvement {
  id: string;
  category: Category;
  score: number;
  activity: string;
  reasoning: string;
  segment: string;
  tutorial: Tutorial;
}

const CATEGORY: Record<Category, { label: string; color: string }> = {
  hesitation: { label: "Hesitation", color: "#f87171" },
  attention: { label: "Attention", color: "#fbbf24" },
  smoothness: { label: "Smoothness", color: "#60a5fa" },
  coordination: { label: "Coordination", color: "#34d399" },
};

const IMPROVEMENTS: Improvement[] = [
  {
    id: "imp-1",
    category: "hesitation",
    score: 32,
    activity: "Searching for parts in unlabeled storage bins",
    reasoning:
      "30s hunting for fittings that should have been identifiable at a glance.",
    segment: "Seg 11",
    tutorial: {
      id: "stage-your-tools",
      title: "Stage Your Tools First",
      description:
        "Every trip back to the cart during assembly is time you didn\u2019t need to lose.",
      thumbnailPath: "/data/tutorials/stage-your-tools/thumb.jpg",
      videoPath: "/data/tutorials/stage-your-tools/video.mp4",
      durationSec: 20,
    },
  },
  {
    id: "imp-2",
    category: "attention",
    score: 28,
    activity: "Overhead ProPress fired without seating verification",
    reasoning:
      "No fitting seating mark check before triggering the press cycle.",
    segment: "Seg 20",
    tutorial: {
      id: "check-first",
      title: "Check Before You Act",
      description:
        "Verifying a press fitting before committing an irreversible joint.",
      thumbnailPath: "/data/tutorials/check-first/thumb.jpg",
      videoPath: "/data/tutorials/check-first/video.mp4",
      durationSec: 17,
    },
  },
  {
    id: "imp-3",
    category: "hesitation",
    score: 41,
    activity: "Re-measuring manifold dimensions after task break",
    reasoning: "Initial markup was not trusted or clearly documented.",
    segment: "Seg 17",
    tutorial: {
      id: "know-your-next-move",
      title: "Know Your Next Move",
      description:
        "The biggest time losses come from not knowing what comes next.",
      thumbnailPath: "/data/tutorials/know-your-next-move/thumb.jpg",
      videoPath: "/data/tutorials/know-your-next-move/video.mp4",
      durationSec: 17,
    },
  },
  {
    id: "imp-4",
    category: "smoothness",
    score: 38,
    activity: "Wasted motion during scrap copper sorting",
    reasoning:
      "No designated scrap collection point, causing unnecessary back-and-forth.",
    segment: "Seg 5",
    tutorial: {
      id: "stop-and-redo",
      title: "Stop and Redo",
      description:
        "Poor pre-planning forced rework and added time without progress.",
      thumbnailPath: "/data/tutorials/stop-and-redo/thumb.jpg",
      videoPath: "/data/tutorials/stop-and-redo/video.mp4",
      durationSec: 18,
    },
  },
  {
    id: "imp-5",
    category: "attention",
    score: 35,
    activity: "Unit lifted without rough opening measurement",
    reasoning:
      "No dimension check before the 3-person lift \u2014 4 min of grinder rework.",
    segment: "Seg 8",
    tutorial: {
      id: "rough-opening-check",
      title: "Measure Before You Lift",
      description:
        "The cost of skipping a rough opening check before a heavy lift.",
      thumbnailPath: "/data/tutorials/rough-opening-check/thumb.jpg",
      videoPath: "/data/tutorials/rough-opening-check/video.mp4",
      durationSec: 15,
    },
  },
];

function buildSummary(improvements: Improvement[]): string {
  const counts: Partial<Record<Category, number>> = {};
  for (const imp of improvements) {
    counts[imp.category] = (counts[imp.category] ?? 0) + 1;
  }

  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const topCategory = sorted[0]?.[0] as Category | undefined;
  const categoryCount = sorted.length;

  const parts: string[] = [];

  parts.push(
    `Today\u2019s analysis flagged ${improvements.length} improvement areas across ${categoryCount} behavioral categories.`,
  );

  if (topCategory === "hesitation") {
    parts.push(
      "Hesitation was the most frequent pattern \u2014 time lost searching for materials and re-verifying work after breaks suggests stronger pre-staging and markup habits would help.",
    );
  } else if (topCategory === "attention") {
    parts.push(
      "Attention gaps were the leading concern \u2014 verification steps were skipped before irreversible actions, increasing rework risk.",
    );
  } else if (topCategory === "smoothness") {
    parts.push(
      "Smoothness issues dominated \u2014 excess motion and poor workspace layout added unnecessary time to routine tasks.",
    );
  }

  if (counts["attention"] && topCategory !== "attention") {
    parts.push(
      "Skipped checks before critical steps also surfaced as a recurring theme.",
    );
  }

  if (counts["smoothness"] && topCategory !== "smoothness") {
    parts.push(
      "Workspace layout contributed to unnecessary movement during material handling.",
    );
  }

  return parts.join(" ");
}

export default function DailyReview() {
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);

  const summary = buildSummary(IMPROVEMENTS);

  const catCounts: Partial<Record<Category, number>> = {};
  for (const imp of IMPROVEMENTS) {
    catCounts[imp.category] = (catCounts[imp.category] ?? 0) + 1;
  }

  const catData = (Object.entries(catCounts) as [Category, number][]).map(
    ([cat, count]) => ({
      key: cat,
      ...CATEGORY[cat],
      count,
    }),
  );
  const maxCount = Math.max(...catData.map((d) => d.count));

  return (
    <>
      <div className="rv-page">
        <div className="ee-grain" aria-hidden="true" />
        <div className="ee-glow ee-glow--warm" aria-hidden="true" />
        <div className="ee-glow ee-glow--deep" aria-hidden="true" />

        <div className="rv-content">
          <header className="rv-hero">
            <div className="rv-hero__date">
              <span className="rv-hero__date-month">Feb</span>
              <span className="rv-hero__date-day">21</span>
            </div>
            <div className="rv-hero__body">
              <span className="rv-hero__label">Daily Review</span>
              <h1 className="rv-hero__name">Marcus Rivera</h1>
              <p className="rv-hero__meta">
                Plumber Journeyman &middot; Crew B-12 Mechanical &middot;
                Building 400, Floor 3
              </p>
              <div className="rv-meters">
                {catData.map(({ key, label, color, count }) => (
                  <div key={key} className="rv-meter">
                    <span className="rv-meter__label" style={{ color }}>
                      {label}
                    </span>
                    <div className="rv-meter__track">
                      <div
                        className="rv-meter__fill"
                        style={{
                          background: color,
                          width: `${(count / maxCount) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="rv-meter__count" style={{ color }}>
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </header>

          <div className="rv-summary">
            <p>{summary}</p>
          </div>

          <div className="rv-grid">
            {IMPROVEMENTS.map((imp, i) => {
              const cat = CATEGORY[imp.category];
              return (
                <VideoCard
                  key={imp.id}
                  title={imp.tutorial.title}
                  description={imp.tutorial.description}
                  thumbnailPath={imp.tutorial.thumbnailPath}
                  durationSec={imp.tutorial.durationSec}
                  index={i}
                  badge={{ label: cat.label, color: cat.color }}
                  onClick={() => setPlayingVideo(imp.tutorial.videoPath)}
                />
              );
            })}
          </div>
        </div>
      </div>

      {playingVideo && (
        <VideoModal src={playingVideo} onClose={() => setPlayingVideo(null)} />
      )}
    </>
  );
}
