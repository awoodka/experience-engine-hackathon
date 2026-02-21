/**
 * Activity Log Index Generator
 *
 * Reads all construction index entries and produces richly annotated
 * activity-log entries with action categorization, worker roles, tool
 * states, material flow, lean classification, productivity ratings,
 * and temporal analysis.
 *
 * Usage: bun run scripts/generate-activity-log.ts
 */

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const INDEX_DIR = join(import.meta.dir, "..", "data", "index");
const CONSTRUCTION_DIR = join(INDEX_DIR, "construction", "entries");
const OUTPUT_DIR = join(INDEX_DIR, "activity-log", "entries");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConstructionEntry {
  startSec: number;
  endSec: number;
  phase: string;
  activity: string;
  workers: number;
  tools: string[];
  trade: string;
  video: string;
  notes?: string;
}

interface ActivityLogEntry {
  video: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  action: string;
  actionCategory: string;
  phase: string;
  workers: number;
  workerRoles: string[];
  trade: string;
  interactionType: string;
  tools: string[];
  toolState: string;
  materials: string[];
  materialFlow: string;
  location: string;
  elevation: string;
  description: string;
  isTransition: boolean;
  previousAction: string;
  triggerEvent: string;
  valueCategory: string;
  productivityRating: number;
  notes: string;
}

// ---------------------------------------------------------------------------
// Action Category Classification
// ---------------------------------------------------------------------------

const ACTION_PATTERNS: [RegExp, string][] = [
  // ===== HIGHEST PRIORITY — specific compound patterns =====

  // Masonry: Place-Unit — SPECIFIC verb+block compound patterns (high confidence)
  [
    /\b(lay|laying|place|placing|set|setting|position|seat)\b.*\b(block|cmu|unit|concrete)\b/i,
    "Place-Unit",
  ],
  [
    /\b(block|cmu|unit|concrete)\b.*\b(lay|place|set|position|seat|placement)\b/i,
    "Place-Unit",
  ],
  [/\bbuild\b.*\b(wall|block|structure)\b/i, "Place-Unit"],
  [
    /\b(block.*construct|wall.*construct|construct.*wall|construct.*block)\b/i,
    "Place-Unit",
  ],

  // Masonry: Apply-Mortar — when spreading/applying mortar is the PRIMARY verb
  [/\b(spread|spreading)\b.*\bmortar\b/i, "Apply-Mortar"],
  [/\b(apply|applying)\b.*\bmortar\b/i, "Apply-Mortar"],
  [/\bmortar\b.*\b(application|spreading)\b/i, "Apply-Mortar"],
  [/\bbed of mortar\b/i, "Apply-Mortar"],
  [/\bmortar bed\b/i, "Apply-Mortar"],

  // Masonry: Place-Unit — BROAD catch-alls (after Apply-Mortar to avoid false matches)
  [
    /\b(ongoing|continued|continuing|progress)\b.*\b(masonry|block)\b/i,
    "Place-Unit",
  ],
  [/\bmasonry\b.*\b(production|work|task|activit)\b/i, "Place-Unit"],
  [/\bblock\s*wall\b.*\b(construct|build|progress|install)\b/i, "Place-Unit"],
  [/\bblock\s*laying\b/i, "Place-Unit"],
  [/\bblock\s*work\b/i, "Place-Unit"],
  [/\bcmu\s*block/i, "Place-Unit"],

  // Quality checks: Align/Level before generic Inspect
  [
    /\b(level|leveling|align|plumb|straight|string line|check.*alignment|fine-tun|ensur.*level)/i,
    "Align/Level",
  ],
  [
    /\b(smooth|finishing|refining|jointing|brush.*joint|clean.*joint|scrape.*excess|remov.*mortar|remov.*spatter)\b.*\bjoint/i,
    "Joint-Finish",
  ],
  [/\b(joint|jointing)\b.*\b(finish|clean|refin|smooth)/i, "Joint-Finish"],
  [/\bmortar\s*joint/i, "Joint-Finish"],
  [/\bfinishing\b.*\bjoint/i, "Joint-Finish"],
  [/\brefining\b.*\bjoint/i, "Joint-Finish"],
  [
    /\b(inspect|verify|examin|assess|survey|quality control)/i,
    "Inspect/Verify",
  ],
  [/\bpour\b|fill\b.*\b(cavit|grout)\b/i, "Pour/Fill"],
  [/\b(measur|tape measure|ruler)\b/i, "Measure"],

  // Mechanical/Plumbing — specific trade actions
  [/\b(solder|braz|torch)\b/i, "Solder/Braze"],
  [/\bflux\b/i, "Glue/Seal"],
  [/\b(press|crimp)\b.*\b(tool|fit|pipe|copper)\b/i, "Press-Fit"],
  [/\b(drill|bore|hole)\b/i, "Drill"],
  [/\b(fasten|screw|bolt|tighten|secur|mount|bracket|driver)\b/i, "Fasten"],
  [/\b(cut|saw|grind|trim|angle grinder)\b/i, "Cut"],
  [/\b(assembl|fabricat|pre-fab)\b/i, "Fabricate"],
  [/\b(install|connect|thread|pull.*tub|rough-in)\b/i, "Install"],
  [/\b(glue|seal|adhesive|caulk|primer)\b/i, "Glue/Seal"],

  // Labeling / Documentation
  [/\b(label|identif|sticker|tag|document)\b/i, "Document/Label"],
  [/\bwrit(e|ing)\b.*\b(note|cardboard|mark)\b/i, "Document/Label"],
  [/\bmark(ing)?\b.*\b(measurement|cardboard|material)\b/i, "Document/Label"],

  // Material handling (before people movement — "move" can be ambiguous)
  [
    /\b(transfer|transport|carry|carrying|push.*cart|wheel|deliver|haul)/i,
    "Transport-Material",
  ],
  [
    /\b(gather|sort|organiz|stag|retriev|prepar.*material|collect|supply)/i,
    "Stage/Organize",
  ],
  [/\b(load|unload|hoist|lift.*crane)\b/i, "Load/Unload"],

  // People movement (must come after material handling)
  [
    /\b(walk|transit|navigat|moving through|moving to|moving between|pass|arriv|climb|stairs)\b/i,
    "Transport-Self",
  ],
  [/\bmovement within\b/i, "Transport-Self"],

  // Communication / Supervision
  [/\b(consult|discuss|coordinat|instruct|direct|meeting)\b/i, "Communicate"],
  [/\b(supervis|oversee|manage)\b/i, "Supervise"],

  // Idle / Break
  [/\b(wait|idle|standby|paus|stop|await)\b/i, "Wait/Idle"],
  [/\b(break|meal|lunch|rest)\b/i, "Break"],

  // Cleanup
  [
    /\b(clean|sweep|clear|tidy|gather.*scrap|debris|remov.*spatter)/i,
    "Clean/Sweep",
  ],

  // Rework
  [/\b(rework|redo|repair|fix|correct)\b/i, "Repair/Rework"],
];

function classifyAction(
  activity: string,
  phase: string,
  tools: string[],
): string {
  // Phase-based overrides
  if (phase === "Break") return "Break";
  if (phase === "Cleanup") return "Clean/Sweep";

  // Try pattern matching
  for (const [pattern, category] of ACTION_PATTERNS) {
    if (pattern.test(activity)) return category;
  }

  // Phase-based fallbacks
  if (phase === "Transit") return "Transport-Self";
  if (phase === "Standby") {
    const actLower = activity.toLowerCase();
    if (/mobile|phone|device/.test(actLower)) return "Communicate";
    if (/observe|assess|inspect|check/.test(actLower)) return "Inspect/Verify";
    return "Wait/Idle";
  }
  if (phase === "Prep") return "Stage/Organize";
  if (phase === "Downtime") return "Wait/Idle";

  // Tool-based inference for production
  const toolStr = tools.join(" ").toLowerCase();
  if (
    /trowel/.test(toolStr) &&
    /block|cmu|concrete/.test(activity.toLowerCase())
  )
    return "Place-Unit";
  if (/trowel/.test(toolStr)) return "Apply-Mortar";
  if (/level|spirit level/.test(toolStr)) return "Align/Level";
  if (/torch/.test(toolStr)) return "Solder/Braze";
  if (/drill/.test(toolStr)) return "Drill";
  if (/press/.test(toolStr)) return "Press-Fit";
  if (/grinder/.test(toolStr)) return "Cut";

  return "Install";
}

// ---------------------------------------------------------------------------
// Concise Action Label
// ---------------------------------------------------------------------------

function generateActionLabel(activity: string): string {
  // If the activity already starts with a verb, trim it
  const trimmed = activity.replace(
    /^(The )?(worker|workers|mason|masons|team) (is |are |continues? to |proceeds? to )?/i,
    "",
  );
  // Capitalize first letter and ensure verb-first
  const firstChar = trimmed.charAt(0).toUpperCase();
  let label = firstChar + trimmed.slice(1);
  // Remove trailing period
  label = label.replace(/\.$/, "");
  // Trim to reasonable length
  if (label.length > 120) label = label.slice(0, 117) + "...";
  return label;
}

// ---------------------------------------------------------------------------
// Worker Roles
// ---------------------------------------------------------------------------

function inferWorkerRoles(
  workers: number,
  trade: string,
  activity: string,
  actionCategory: string,
  phase: string,
): string[] {
  if (workers === 0) return [];

  const actLower = activity.toLowerCase();
  const isMasonry = trade === "Masonry";
  const isMP = trade === "Mechanical/Plumbing";

  if (workers === 1) {
    if (phase === "Transit") return ["Journeyman"];
    if (/supervis|inspect|check|survey|assess/.test(actLower))
      return ["Foreman"];
    if (/label|document|writ|mark/.test(actLower)) return ["Journeyman"];
    if (isMasonry) return ["Lead Mason"];
    if (isMP) return ["Journeyman Plumber"];
    return ["Journeyman"];
  }

  if (workers === 2) {
    if (/supervis|instruct|consult/.test(actLower))
      return ["Supervisor", "Journeyman"];
    if (/help|assist/.test(actLower)) {
      if (isMasonry) return ["Lead Mason", "Helper"];
      if (isMP) return ["Journeyman Plumber", "Helper"];
      return ["Lead Worker", "Helper"];
    }
    if (isMasonry) return ["Lead Mason", "Mason"];
    if (isMP) return ["Journeyman Plumber", "Apprentice"];
    if (phase === "Transit") return ["Worker", "Worker"];
    return ["Lead Worker", "Helper"];
  }

  if (workers === 3) {
    if (isMasonry) return ["Lead Mason", "Mason", "Material Handler"];
    if (isMP) return ["Journeyman Plumber", "Apprentice", "Helper"];
    if (/supervis/.test(actLower)) return ["Supervisor", "Worker", "Worker"];
    return ["Lead Worker", "Worker", "Helper"];
  }

  // 4+
  if (isMasonry) return ["Lead Mason", "Mason", "Mason", "Material Handler"];
  if (isMP) return ["Foreman", "Journeyman Plumber", "Apprentice", "Helper"];
  return Array.from({ length: workers }, (_, i) =>
    i === 0 ? "Lead Worker" : "Worker",
  );
}

// ---------------------------------------------------------------------------
// Interaction Type
// ---------------------------------------------------------------------------

function classifyInteraction(
  workers: number,
  activity: string,
  phase: string,
  actionCategory: string,
): string {
  if (workers <= 1) return "Solo";

  const actLower = activity.toLowerCase();

  if (/supervis|inspect.*with|consult/.test(actLower)) return "Supervised";
  if (
    /handoff|pass|transfer/.test(actLower) ||
    actionCategory === "Load/Unload"
  )
    return "Handoff";
  if (/help|assist|with.*help|helper/.test(actLower)) return "Assisted";
  if (/team|collaborat|together|jointly/.test(actLower)) return "Collaborative";
  if (phase === "Transit" && workers > 1) return "Parallel";

  // Default multi-worker classification
  if (workers === 2) return "Assisted";
  if (workers >= 3) return "Collaborative";
  return "Assisted";
}

// ---------------------------------------------------------------------------
// Tool State
// ---------------------------------------------------------------------------

function classifyToolState(
  tools: string[],
  phase: string,
  actionCategory: string,
): string {
  if (tools.length === 0) return "Not-Applicable";

  if (phase === "Transit") return "Being-Transported";
  if (phase === "Prep" || phase === "Cleanup") return "Setup";
  if (phase === "Standby" || phase === "Break" || phase === "Downtime")
    return "Idle-In-Hand";

  if (
    [
      "Install",
      "Fabricate",
      "Cut",
      "Drill",
      "Fasten",
      "Solder/Braze",
      "Glue/Seal",
      "Press-Fit",
      "Apply-Mortar",
      "Place-Unit",
      "Pour/Fill",
      "Align/Level",
      "Joint-Finish",
      "Document/Label",
      "Measure",
      "Clean/Sweep",
    ].includes(actionCategory)
  ) {
    return "Active-Use";
  }

  if (["Inspect/Verify", "Communicate", "Supervise"].includes(actionCategory)) {
    return "Idle-In-Hand";
  }

  return "Active-Use";
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function inferMaterials(
  activity: string,
  tools: string[],
  trade: string,
): string[] {
  const mats: string[] = [];
  const actLower = activity.toLowerCase();
  const toolStr = tools.join(" ").toLowerCase();

  // Masonry materials
  if (/mortar/.test(actLower) || /mortar/.test(toolStr)) mats.push("Mortar");
  if (/\b(block|cmu|concrete block|masonry unit)\b/.test(actLower))
    mats.push("Concrete Blocks (CMU)");
  if (/grout/.test(actLower)) mats.push("Grout");

  // Plumbing materials
  if (/copper/.test(actLower) || /copper/.test(toolStr))
    mats.push("Copper Pipe");
  if (/pex/.test(actLower)) mats.push("PEX Tubing");
  if (/fitting/.test(actLower)) mats.push("Pipe Fittings");
  if (/solder/.test(actLower)) mats.push("Solder");
  if (/flux/.test(actLower)) mats.push("Flux");
  if (/manifold/.test(actLower)) mats.push("Copper Manifold");
  if (/bracket/.test(actLower) || /bracket/.test(toolStr))
    mats.push("Metal Brackets");
  if (/pipe support/.test(actLower)) mats.push("Pipe Supports");
  if (/insul/.test(actLower)) mats.push("Pipe Insulation");
  if (/conduit/.test(actLower)) mats.push("Conduit");

  // Labels
  if (/label|sticker/.test(actLower)) mats.push("Identification Labels");
  if (/tape/.test(toolStr) && /label/.test(actLower))
    mats.push("Adhesive Tape");

  // HVAC
  if (/hvac|unit|casing/.test(actLower)) mats.push("HVAC Unit Components");

  // General
  if (/drywall/.test(actLower)) mats.push("Drywall");
  if (/cardboard/.test(actLower) || /cardboard/.test(toolStr))
    mats.push("Cardboard");
  if (/metal (stud|trim|plate)/.test(actLower)) mats.push("Metal Framing");
  if (/scrap/.test(actLower)) mats.push("Scrap Material");

  // If nothing detected but production phase with masonry trade
  if (mats.length === 0 && trade === "Masonry" && /trowel/.test(toolStr)) {
    mats.push("Mortar", "Concrete Blocks (CMU)");
  }

  return [...new Set(mats)];
}

// ---------------------------------------------------------------------------
// Material Flow
// ---------------------------------------------------------------------------

function classifyMaterialFlow(
  phase: string,
  actionCategory: string,
  materials: string[],
): string {
  if (materials.length === 0) return "None";

  if (
    [
      "Install",
      "Apply-Mortar",
      "Place-Unit",
      "Pour/Fill",
      "Solder/Braze",
      "Glue/Seal",
      "Press-Fit",
      "Fasten",
      "Cut",
      "Joint-Finish",
      "Document/Label",
    ].includes(actionCategory)
  ) {
    return "Consuming";
  }
  if (
    ["Transport-Material", "Transport-Tool", "Load/Unload"].includes(
      actionCategory,
    )
  ) {
    return "Transporting";
  }
  if (["Stage/Organize", "Fabricate", "Measure"].includes(actionCategory))
    return "Staging";
  if (["Inspect/Verify", "Align/Level"].includes(actionCategory))
    return "Inspecting";
  if (phase === "Transit") return "Transporting";
  if (phase === "Prep") return "Staging";

  return "Consuming";
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

function inferLocation(
  activity: string,
  trade: string,
  video: string,
  phase: string,
): string {
  const actLower = activity.toLowerCase();

  // Specific locations from context clues
  if (/shaft|riser/.test(actLower)) return "Mechanical shaft";
  if (/utility (room|closet)/.test(actLower)) return "Utility closet";
  if (/bathroom/.test(actLower)) return "Bathroom utility area";
  if (/ceiling|overhead/.test(actLower)) return "Overhead ceiling cavity";
  if (/stair/.test(actLower)) return "Stairwell";
  if (/hallway|corridor/.test(actLower)) return "Interior corridor";
  if (/wall cavity/.test(actLower)) return "Wall cavity";
  if (/platform|deck|scaffold|elevated/.test(actLower))
    return "Elevated work platform";
  if (/corner/.test(actLower)) return "Wall corner section";
  if (/exterior|outside/.test(actLower)) return "Exterior wall section";
  if (/foundation/.test(actLower)) return "Foundation wall";
  if (/window/.test(actLower)) return "Window sill area";
  if (/storage|container/.test(actLower)) return "Material storage area";
  if (/workbench|workstation|cart/.test(actLower)) return "Mobile workstation";
  if (/floor/.test(actLower) && /construction/.test(actLower))
    return "Active construction floor";

  // Phase-based defaults
  if (phase === "Transit") return "Interior corridor";

  // Trade-based defaults
  if (trade === "Masonry") return "Block wall work zone";
  if (trade === "Mechanical/Plumbing") return "Mechanical work area";
  return "Active construction floor";
}

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------

function inferElevation(activity: string, tools: string[]): string {
  const actLower = activity.toLowerCase();
  const toolStr = tools.join(" ").toLowerCase();

  if (/scaffold/.test(actLower) || /scaffold/.test(toolStr)) return "Scaffold";
  if (/ladder/.test(actLower) || /ladder/.test(toolStr)) return "Ladder";
  if (
    /elevated|platform|deck|upper level|high.*level|top.*course|height/.test(
      actLower,
    )
  )
    return "Elevated-Platform";
  if (/roof/.test(actLower)) return "Roof";
  if (/below.grade|basement|below/.test(actLower)) return "Below-Grade";
  if (/stair|climb|between.*level/.test(actLower)) return "Multi-Level";

  return "Ground";
}

// ---------------------------------------------------------------------------
// Trigger Event
// ---------------------------------------------------------------------------

function inferTriggerEvent(
  entry: ConstructionEntry,
  prevEntry: ConstructionEntry | null,
  actionCategory: string,
): string {
  if (!prevEntry) return "Start of video recording";

  const prevPhase = prevEntry.phase;
  const currPhase = entry.phase;

  // Phase transitions
  if (prevPhase !== currPhase) {
    if (currPhase === "Production" && prevPhase === "Prep")
      return "Completion of preparation work";
    if (currPhase === "Production" && prevPhase === "Transit")
      return "Arrival at work location";
    if (currPhase === "Production" && prevPhase === "Standby")
      return "End of waiting period";
    if (currPhase === "Production" && prevPhase === "Break")
      return "Return from break";
    if (currPhase === "Transit" && prevPhase === "Production")
      return "Completion of production task";
    if (currPhase === "Transit" && prevPhase === "Prep")
      return "Materials gathered, heading to work zone";
    if (currPhase === "Prep" && prevPhase === "Transit")
      return "Arrival at staging/material area";
    if (currPhase === "Prep" && prevPhase === "Production")
      return "Need for additional materials or tools";
    if (currPhase === "Standby" && prevPhase === "Production")
      return "Work obstruction or await direction";
    if (currPhase === "Standby" && prevPhase === "Transit")
      return "Pausing to observe or assess situation";
    if (currPhase === "Cleanup" && prevPhase === "Production")
      return "Production task completed";
    if (currPhase === "Break") return "Scheduled break time";
    return `Transition from ${prevPhase.toLowerCase()} phase`;
  }

  // Same phase continuations
  if (currPhase === "Production") {
    if (
      actionCategory === "Align/Level" ||
      actionCategory === "Inspect/Verify"
    ) {
      return "Quality checkpoint in workflow";
    }
    if (actionCategory === "Apply-Mortar")
      return "Preparation for next unit placement";
    if (actionCategory === "Place-Unit")
      return "Mortar bed ready for placement";
    return "Natural workflow progression";
  }

  if (currPhase === "Transit") return "Continuing movement to destination";

  return "Natural workflow progression";
}

// ---------------------------------------------------------------------------
// Productivity Rating
// ---------------------------------------------------------------------------

function computeProductivityRating(
  phase: string,
  actionCategory: string,
  workers: number,
  tools: string[],
  materials: string[],
  interactionType: string,
): number {
  // Base scores by phase
  let score: number;
  switch (phase) {
    case "Production":
      score = 80;
      break;
    case "Prep":
      score = 45;
      break;
    case "Transit":
      score = 15;
      break;
    case "Standby":
      score = 8;
      break;
    case "Downtime":
      score = 5;
      break;
    case "Break":
      score = 0;
      break;
    case "Cleanup":
      score = 30;
      break;
    default:
      score = 20;
  }

  // Production action category bonuses
  if (phase === "Production") {
    if (
      [
        "Install",
        "Place-Unit",
        "Apply-Mortar",
        "Solder/Braze",
        "Press-Fit",
        "Fabricate",
        "Fasten",
        "Pour/Fill",
      ].includes(actionCategory)
    ) {
      score += 15;
    }
    if (
      ["Align/Level", "Inspect/Verify", "Joint-Finish"].includes(actionCategory)
    ) {
      score += 8;
    }
    if (["Measure", "Cut", "Drill"].includes(actionCategory)) {
      score += 10;
    }
  }

  // Tool engagement bonus
  if (tools.length > 0 && phase === "Production") score += 5;

  // Material consumption bonus
  if (materials.length > 0 && phase === "Production") score += 2;

  // Collaboration efficiency — multi-worker production is more valuable
  if (workers >= 2 && phase === "Production" && interactionType !== "Parallel")
    score += 3;

  // Prep with materials is more productive than prep without
  if (phase === "Prep" && materials.length > 0) score += 10;
  if (phase === "Prep" && tools.length > 0) score += 5;

  // Transit carrying materials is better than empty-handed
  if (phase === "Transit" && materials.length > 0) score += 15;
  if (phase === "Transit" && tools.length > 0) score += 8;

  // Cleanup is necessary
  if (phase === "Cleanup" && tools.length > 0) score += 10;

  // Communication/supervision during production is still productive
  if (
    ["Communicate", "Supervise"].includes(actionCategory) &&
    phase !== "Standby"
  ) {
    score = Math.max(score, 35);
  }

  // Document/Label during production
  if (actionCategory === "Document/Label") score = Math.max(score, 55);

  // Cap at 100
  return Math.min(100, Math.max(0, score));
}

// ---------------------------------------------------------------------------
// Value Category
// ---------------------------------------------------------------------------

function classifyValueCategory(phase: string, actionCategory: string): string {
  // Value-Adding: direct production work
  if (
    phase === "Production" &&
    [
      "Install",
      "Fabricate",
      "Cut",
      "Drill",
      "Fasten",
      "Solder/Braze",
      "Glue/Seal",
      "Press-Fit",
      "Apply-Mortar",
      "Place-Unit",
      "Pour/Fill",
      "Align/Level",
      "Joint-Finish",
      "Measure",
      "Document/Label",
    ].includes(actionCategory)
  ) {
    return "Value-Adding";
  }

  // Waste: idle, empty transit, breaks, rework
  if (
    ["Wait/Idle", "Break", "Repair/Rework"].includes(actionCategory) ||
    phase === "Downtime" ||
    phase === "Break"
  ) {
    return "Waste";
  }

  if (phase === "Standby" && actionCategory === "Wait/Idle") return "Waste";

  // Inspection during production is value-adding
  if (phase === "Production" && actionCategory === "Inspect/Verify")
    return "Value-Adding";

  // Everything else is necessary non-value
  return "Necessary-Non-Value";
}

// ---------------------------------------------------------------------------
// Description Enhancement
// ---------------------------------------------------------------------------

function enhanceDescription(
  activity: string,
  actionCategory: string,
  phase: string,
  trade: string,
  tools: string[],
  materials: string[],
  workers: number,
  interactionType: string,
  location: string,
  elevation: string,
): string {
  // Ensure first character is uppercase
  let desc = activity.charAt(0).toUpperCase() + activity.slice(1);

  // Ensure it ends with a period
  if (!desc.endsWith(".")) desc += ".";

  // Add context about technique and quality indicators
  const additions: string[] = [];

  if (workers > 1 && interactionType === "Collaborative") {
    additions.push(`Team of ${workers} workers coordinating together.`);
  }

  if (elevation !== "Ground" && elevation !== "Multi-Level") {
    const elevLabel = elevation.replace("-", " ").toLowerCase();
    if (!activity.toLowerCase().includes(elevLabel.split(" ")[0])) {
      additions.push(`Work performed at ${elevLabel}.`);
    }
  }

  if (materials.length > 0 && phase === "Production") {
    const matList = materials.filter(
      (m) => !activity.toLowerCase().includes(m.toLowerCase().split(" ")[0]),
    );
    if (matList.length > 0) {
      additions.push(`Materials in use: ${matList.join(", ")}.`);
    }
  }

  if (additions.length > 0) {
    desc = desc.replace(/\.$/, "") + ". " + additions.join(" ");
  }

  // Final trim — ensure single trailing period
  desc = desc.replace(/\.+$/, ".");

  return desc;
}

// ---------------------------------------------------------------------------
// Main Processing
// ---------------------------------------------------------------------------

async function processVideo(filename: string): Promise<ActivityLogEntry[]> {
  const filepath = join(CONSTRUCTION_DIR, filename);
  const raw = await readFile(filepath, "utf-8");
  const entries: ConstructionEntry[] = JSON.parse(raw);
  const results: ActivityLogEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const prevEntry = i > 0 ? entries[i - 1] : null;

    const durationSec = entry.endSec - entry.startSec;
    const actionCategory = classifyAction(
      entry.activity,
      entry.phase,
      entry.tools,
    );
    const action = generateActionLabel(entry.activity);
    const workerRoles = inferWorkerRoles(
      entry.workers,
      entry.trade,
      entry.activity,
      actionCategory,
      entry.phase,
    );
    const interactionType = classifyInteraction(
      entry.workers,
      entry.activity,
      entry.phase,
      actionCategory,
    );
    const toolState = classifyToolState(
      entry.tools,
      entry.phase,
      actionCategory,
    );
    const materials = inferMaterials(entry.activity, entry.tools, entry.trade);
    const materialFlow = classifyMaterialFlow(
      entry.phase,
      actionCategory,
      materials,
    );
    const location = inferLocation(
      entry.activity,
      entry.trade,
      entry.video,
      entry.phase,
    );
    const elevation = inferElevation(entry.activity, entry.tools);
    const triggerEvent = inferTriggerEvent(entry, prevEntry, actionCategory);
    const isTransition = prevEntry !== null && prevEntry.phase !== entry.phase;

    const productivityRating = computeProductivityRating(
      entry.phase,
      actionCategory,
      entry.workers,
      entry.tools,
      materials,
      interactionType,
    );
    const valueCategory = classifyValueCategory(entry.phase, actionCategory);
    const description = enhanceDescription(
      entry.activity,
      actionCategory,
      entry.phase,
      entry.trade,
      entry.tools,
      materials,
      entry.workers,
      interactionType,
      location,
      elevation,
    );

    const previousAction = prevEntry
      ? generateActionLabel(
          prevEntry.activity,
          classifyAction(prevEntry.activity, prevEntry.phase, prevEntry.tools),
        )
      : "None";

    // Generate notes based on notable observations
    const notesParts: string[] = [];
    if (durationSec < 10)
      notesParts.push(
        "Very short segment — possible micro-task or transition.",
      );
    if (durationSec > 60)
      notesParts.push("Extended duration segment — sustained focused work.");
    if (entry.workers >= 4)
      notesParts.push("Large crew visible — peak labor density for this area.");
    if (entry.phase === "Standby" && durationSec > 30)
      notesParts.push(
        "Extended standby period — potential scheduling or coordination inefficiency.",
      );
    if (entry.phase === "Transit" && durationSec > 60)
      notesParts.push(
        "Long transit time — evaluate workspace layout and material staging locations.",
      );
    if (actionCategory === "Align/Level" || actionCategory === "Inspect/Verify")
      notesParts.push(
        "Quality control step — indicates attention to craftsmanship standards.",
      );
    if (entry.phase === "Production" && entry.tools.length === 0)
      notesParts.push(
        "Production work with no tools visible — manual/hand work or tools out of frame.",
      );

    results.push({
      video: entry.video,
      startSec: entry.startSec,
      endSec: entry.endSec,
      durationSec,
      action,
      actionCategory,
      phase: entry.phase,
      workers: entry.workers,
      workerRoles,
      trade: entry.trade,
      interactionType,
      tools: entry.tools,
      toolState,
      materials,
      materialFlow,
      location,
      elevation,
      description,
      isTransition,
      previousAction,
      triggerEvent,
      valueCategory,
      productivityRating,
      notes: notesParts.join(" ") || "",
    });
  }

  return results;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const files = (await readdir(CONSTRUCTION_DIR)).filter((f) =>
    f.endsWith(".json"),
  );
  console.log(`Processing ${files.length} videos...\n`);

  let totalEntries = 0;
  let totalDuration = 0;
  const summaryRows: string[] = [];

  for (const file of files.sort()) {
    const entries = await processVideo(file);
    totalEntries += entries.length;

    const videoDuration =
      entries.length > 0 ? entries[entries.length - 1].endSec : 0;
    totalDuration += videoDuration;

    // Compute per-video stats
    const avgProd =
      entries.reduce((sum, e) => sum + e.productivityRating, 0) /
      entries.length;
    const valueAdding = entries.filter(
      (e) => e.valueCategory === "Value-Adding",
    ).length;
    const waste = entries.filter((e) => e.valueCategory === "Waste").length;
    const nnv = entries.filter(
      (e) => e.valueCategory === "Necessary-Non-Value",
    ).length;

    const categories = new Map<string, number>();
    for (const e of entries) {
      categories.set(
        e.actionCategory,
        (categories.get(e.actionCategory) ?? 0) + 1,
      );
    }
    const topCategory = [...categories.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0];

    const outPath = join(OUTPUT_DIR, file);
    await writeFile(outPath, JSON.stringify(entries, null, 2));

    const row = `  ${file.padEnd(40)} ${String(entries.length).padStart(3)} entries | avg prod: ${avgProd.toFixed(1).padStart(5)} | VA: ${String(valueAdding).padStart(2)} NNV: ${String(nnv).padStart(2)} W: ${String(waste).padStart(2)} | top: ${topCategory[0]}`;
    summaryRows.push(row);
    console.log(row);
  }

  console.log("\n" + "=".repeat(100));
  console.log(
    `  TOTAL: ${totalEntries} activity-log entries across ${files.length} videos`,
  );
  console.log(
    `  Total video duration: ${(totalDuration / 60).toFixed(1)} minutes`,
  );
  console.log("=".repeat(100));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
