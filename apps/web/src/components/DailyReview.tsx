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
    score: 45,
    activity: "Spreading mortar on existing course",
    reasoning:
      "Over-loads the trowel, then scrapes back the excess before the block can go down \u2014 a correction step that shouldn\u2019t exist.",
    segment: "Seg 1",
    tutorial: {
      id: "mortar-overload",
      title: "Mortar Overload",
      description:
        "Stop scraping back excess mortar \u2014 gauge your load before the trowel touches the wall.",
      thumbnailPath: "/data/tutorials/mortar-overload/thumb.jpg",
      videoPath: "/data/tutorials/mortar-overload/video.mp4",
      durationSec: 34,
    },
  },
  {
    id: "imp-2",
    category: "hesitation",
    score: 50,
    activity: "Leveling and plumbing the course",
    reasoning:
      "Taps the block, checks the level, taps again \u2014 can\u2019t commit to what the first check already showed.",
    segment: "Seg 3",
    tutorial: {
      id: "block-level-loop",
      title: "Block Level Loop",
      description:
        "Trust your first level read \u2014 over-adjusting wastes the time you saved.",
      thumbnailPath: "/data/tutorials/block-level-loop/thumb.jpg",
      videoPath: "/data/tutorials/block-level-loop/video.mp4",
      durationSec: 35,
    },
  },
  {
    id: "imp-3",
    category: "hesitation",
    score: 50,
    activity: "Block adjustment and joint sealing",
    reasoning:
      "Block placed, error spotted, loops back to fix it \u2014 the alignment check came too late.",
    segment: "Seg 8",
    tutorial: {
      id: "block-adjust-loop",
      title: "Block Adjust Loop",
      description:
        "Sight the line before you set \u2014 correction after placement costs more than prevention.",
      thumbnailPath: "/data/tutorials/block-adjust-loop/thumb.jpg",
      videoPath: "/data/tutorials/block-adjust-loop/video.mp4",
      durationSec: 35,
    },
  },
  {
    id: "imp-4",
    category: "smoothness",
    score: 50,
    activity: "Installing joint reinforcement mesh",
    reasoning:
      "Carries the mesh to the wall, then pauses before committing \u2014 a micro-stop that breaks the rhythm of the course.",
    segment: "Seg 15",
    tutorial: {
      id: "mesh-idle-gap",
      title: "Mesh Idle Gap",
      description:
        "Pre-stage the mesh so the carry flows directly into placement \u2014 no pause.",
      thumbnailPath: "/data/tutorials/mesh-idle-gap/thumb.jpg",
      videoPath: "/data/tutorials/mesh-idle-gap/video.mp4",
      durationSec: 31,
    },
  },
  {
    id: "imp-5",
    category: "coordination",
    score: 55,
    activity: "Preparing next course section",
    reasoning:
      "Watches the crane instead of moving into guide position \u2014 still getting set when the block arrived.",
    segment: "Seg 5",
    tutorial: {
      id: "crane-wait-placement",
      title: "Crane Wait Placement",
      description:
        "Pre-position before the crane arrives \u2014 don\u2019t wait for it to come to you.",
      thumbnailPath: "/data/tutorials/crane-wait-placement/thumb.jpg",
      videoPath: "/data/tutorials/crane-wait-placement/video.mp4",
      durationSec: 36,
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
      "Hesitation was the most frequent pattern \u2014 repeated check-adjust loops and excess mortar correction cycles suggest stronger pre-staging and commit habits would save significant time per course.",
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

  if (counts["smoothness"] && topCategory !== "smoothness") {
    parts.push(
      "A smoothness gap also appeared \u2014 an idle micro-pause before mesh placement adds unnecessary stop time to an otherwise fluid sequence.",
    );
  }

  if (counts["coordination"] && topCategory !== "coordination") {
    parts.push(
      "A coordination gap also appeared \u2014 waiting for the crane to arrive before moving to guide position costs time that pre-positioning would eliminate.",
    );
  }

  if (counts["attention"] && topCategory !== "attention") {
    parts.push(
      "Skipped checks before critical steps also surfaced as a recurring theme.",
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
