import { useState } from "react";
import VideoModal from "./VideoModal";

type Category = "hesitation" | "attention" | "smoothness" | "coordination";

interface FeedItem {
  id: string;
  category: Category;
  activity: string;
  reasoning: string;
  tutorial: {
    id: string;
    title: string;
    description: string;
    videoPath: string;
    durationSec: number;
  };
}

const CAT: Record<Category, { label: string; color: string }> = {
  hesitation: { label: "Hesitation", color: "#f87171" },
  attention: { label: "Attention", color: "#fbbf24" },
  smoothness: { label: "Smoothness", color: "#60a5fa" },
  coordination: { label: "Coordination", color: "#34d399" },
};

const FEED: FeedItem[] = [
  {
    id: "f0",
    category: "attention",
    activity: "Cutting arrow tape on pipe insulation",
    reasoning:
      "Wasn\u2019t aware of where his hands were relative to the blade \u2014 didn\u2019t pause to check grip or cut direction before acting. Self-corrects thirty seconds later, proving the skill was there, just not the awareness.",
    tutorial: {
      id: "cutting-toward-the-hand",
      title: "Cutting Toward the Hand",
      description:
        "This worker wasn\u2019t aware of his hand position, didn\u2019t mentally prepare, and didn\u2019t check before cutting.",
      videoPath: "/data/tutorials/cutting-toward-the-hand/video.mp4",
      durationSec: 31.5,
    },
  },
  {
    id: "f1",
    category: "coordination",
    activity: "HVAC panel installation and heavy lift",
    reasoning:
      "Didn\u2019t assess the weight before lifting solo \u2014 wasn\u2019t aware this was a two-person job and didn\u2019t check for a partner before starting. The crew coordinates perfectly later, proving the protocol exists.",
    tutorial: {
      id: "crew-coordination-on-scaffold",
      title: "Crew Coordination on Scaffold",
      description:
        "This worker didn\u2019t assess the load or check for a partner before starting.",
      videoPath: "/data/tutorials/crew-coordination-on-scaffold/video.mp4",
      durationSec: 36.5,
    },
  },
  {
    id: "f2",
    category: "smoothness",
    activity: "Plumbing tool staging and flux application",
    reasoning:
      "Didn\u2019t mentally prepare the workspace \u2014 wasn\u2019t aware of what tools he\u2019d need next. Forty seconds hunting in a dark bin. Later stages flux within arm\u2019s reach, proving he knows the principle but skipped the setup.",
    tutorial: {
      id: "stage-before-you-start",
      title: "Stage Before You Start",
      description:
        "This plumber didn\u2019t check that everything was accessible before starting.",
      videoPath: "/data/tutorials/stage-before-you-start/video.mp4",
      durationSec: 35.5,
    },
  },
  {
    id: "f3",
    category: "smoothness",
    activity: "Brazing copper pipe fittings",
    reasoning:
      "The pause before committing heat isn\u2019t hesitation \u2014 it\u2019s the mental check a novice skips. He was aware of the joint geometry and prepared his angle before the flame touched copper.",
    tutorial: {
      id: "read-the-joint",
      title: "Read the Joint",
      description:
        "The gap between experienced and inexperienced is the check before the heat.",
      videoPath: "/data/tutorials/read-the-joint/video.mp4",
      durationSec: 22.5,
    },
  },
  {
    id: "f4",
    category: "attention",
    activity: "Laying blocks at height without protection",
    reasoning:
      "Didn\u2019t assess surroundings before climbing \u2014 no awareness of fall exposure, no check for guardrails or harness before stepping onto the wall.",
    tutorial: {
      id: "laying-blocks-at-the-edge",
      title: "Laying Blocks at the Edge",
      description:
        "These workers weren\u2019t aware of the fall exposure and didn\u2019t check the platform before stepping up.",
      videoPath: "/data/tutorials/laying-blocks-at-the-edge/video.mp4",
      durationSec: 32.2,
    },
  },
];

function formatDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function thumbUrl(videoPath: string): string {
  return videoPath.replace(/video\.mp4$/, "thumb.jpg");
}

function buildSummary(): { text: string; counts: [Category, number][] } {
  const counts: Partial<Record<Category, number>> = {};
  for (const item of FEED) {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
  }
  const sorted = (Object.entries(counts) as [Category, number][]).sort(
    ([, a], [, b]) => b - a,
  );
  const top = sorted[0]?.[0];
  const total = FEED.length;

  let text = `${total} improvement areas detected across ${sorted.length} behavioral categories. `;
  if (top === "hesitation")
    text +=
      "Hesitation is the dominant pattern \u2014 repeated check-adjust loops and correction cycles are adding up. Stronger commit habits would save significant time.";
  else if (top === "attention")
    text +=
      "Attention gaps lead the list \u2014 verification steps are being skipped before irreversible actions.";
  else if (top === "smoothness")
    text +=
      "Smoothness issues dominate \u2014 unnecessary pauses and poor staging are breaking work rhythm.";
  else
    text +=
      "Coordination gaps are the primary concern \u2014 timing with crew and equipment needs tightening.";

  return { text, counts: sorted };
}

export default function FeedView() {
  const [playingTutorial, setPlayingTutorial] = useState<string | null>(null);
  const { text: summaryText, counts: summaryCounts } = buildSummary();

  return (
    <>
      <div className="fd-feed">
        {/* Summary header */}
        <div className="fd-summary">
          <div className="fd-summary__top">
            <span className="fd-summary__label">Today&rsquo;s Review</span>
            <span className="fd-summary__count">{FEED.length} items</span>
          </div>
          <p className="fd-summary__text">{summaryText}</p>
          <div className="fd-summary__cats">
            {summaryCounts.map(([cat, count]) => (
              <span
                key={cat}
                className="fd-summary__cat"
                style={{ "--sc": CAT[cat].color } as React.CSSProperties}
              >
                <span className="fd-summary__cat-dot" />
                {count} {CAT[cat].label}
              </span>
            ))}
          </div>
        </div>

        {/* Feed cards */}
        {FEED.map((item, i) => {
          const cat = CAT[item.category];
          return (
            <article
              key={item.id}
              className="fd-card"
              style={
                {
                  "--fd-cat": cat.color,
                  "--fd-i": i,
                } as React.CSSProperties
              }
            >
              <div
                className="fd-card__media"
                onClick={() => setPlayingTutorial(item.tutorial.videoPath)}
              >
                <img
                  src={thumbUrl(item.tutorial.videoPath)}
                  alt=""
                  className="fd-card__img block h-auto w-full"
                  width={640}
                  height={480}
                />
                <div className="fd-card__overlay" />

                <div
                  className="fd-pill"
                  style={{ "--pill-c": cat.color } as React.CSSProperties}
                >
                  <span className="fd-pill__dot" />
                  {cat.label}
                </div>

                <div className="fd-card__play">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>

                <span className="fd-card__dur">
                  {formatDur(item.tutorial.durationSec)}
                </span>
              </div>

              <div className="fd-card__body">
                <h3 className="fd-card__activity">{item.activity}</h3>
                <p className="fd-card__reasoning">{item.reasoning}</p>
                <button
                  className="fd-cta"
                  onClick={() => setPlayingTutorial(item.tutorial.videoPath)}
                >
                  <span className="fd-cta__label">{item.tutorial.title}</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {playingTutorial && (
        <VideoModal
          src={playingTutorial}
          onClose={() => setPlayingTutorial(null)}
        />
      )}
    </>
  );
}
