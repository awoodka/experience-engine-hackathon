/**
 * Stream transform that detects video/image results in tool outputs and:
 * 1. Emits typed `data-video` / `data-image` UI message chunks so the
 *    frontend can render them as first-class media players.
 * 2. Strips the echoed JSON from text-delta chunks so the user doesn't
 *    see raw `{"type":"video","path":"..."}` in the chat.
 */
import type { UIMessageChunk } from "ai";

interface MediaResult {
  kind: "video" | "image";
  path: string;
}

/** Try to extract a video/image descriptor from an arbitrary value. */
function tryParseMedia(value: unknown): MediaResult | null {
  let obj = value;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (
    obj &&
    typeof obj === "object" &&
    "type" in obj &&
    "path" in obj &&
    (obj.type === "video" || obj.type === "image") &&
    typeof obj.path === "string"
  ) {
    return { kind: obj.type as "video" | "image", path: obj.path };
  }
  return null;
}

/**
 * Returns a TransformStream that sits between `toUIMessageStream()` and the
 * SSE response.  It injects `data-video` / `data-image` chunks when a tool
 * output contains media, and buffers text-delta chunks just long enough to
 * detect (and suppress) echoed media JSON.
 */
export function createMediaTransform() {
  let jsonBuf = "";
  let isBuffering = false;
  let bufId = "";

  function flushBuffer(
    controller: TransformStreamDefaultController<UIMessageChunk>,
  ) {
    if (jsonBuf) {
      controller.enqueue({ type: "text-delta", id: bufId, delta: jsonBuf });
      jsonBuf = "";
    }
    isBuffering = false;
  }

  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      // ── tool output → inject data part ──────────────────────────
      if (chunk.type === "tool-output-available") {
        const media = tryParseMedia(chunk.output);
        if (media) {
          controller.enqueue({
            type: `data-${media.kind}`,
            data: { path: media.path },
          } as UIMessageChunk);
        }
        controller.enqueue(chunk);
        return;
      }

      // ── text-delta → buffer & strip media JSON ─────────────────
      if (chunk.type === "text-delta") {
        if (isBuffering) {
          jsonBuf += chunk.delta;

          const trimmed = jsonBuf.trim();
          try {
            const obj = JSON.parse(trimmed);
            // Complete JSON object
            if (tryParseMedia(obj)) {
              // Media JSON → discard the buffered text
              jsonBuf = "";
              isBuffering = false;
              return;
            }
            // Valid JSON but not media → forward as text
            flushBuffer(controller);
            return;
          } catch {
            // Incomplete JSON – keep buffering up to a limit
            if (jsonBuf.length > 1000) {
              flushBuffer(controller);
            }
            return;
          }
        }

        // Not currently buffering — check if this delta starts a JSON object
        const leftTrimmed = chunk.delta.trimStart();
        if (leftTrimmed.startsWith("{")) {
          // Forward any leading whitespace before the `{`
          const wsLen = chunk.delta.length - leftTrimmed.length;
          if (wsLen > 0) {
            controller.enqueue({
              type: "text-delta",
              id: chunk.id,
              delta: chunk.delta.slice(0, wsLen),
            });
          }
          isBuffering = true;
          bufId = chunk.id;
          jsonBuf = leftTrimmed;

          // Try an immediate parse (might be complete in one chunk)
          try {
            const obj = JSON.parse(jsonBuf.trim());
            if (tryParseMedia(obj)) {
              jsonBuf = "";
              isBuffering = false;
              return;
            }
            // Valid but not media
            flushBuffer(controller);
            return;
          } catch {
            // Incomplete – keep buffering
            return;
          }
        }

        // Regular text — forward immediately
        controller.enqueue(chunk);
        return;
      }

      // ── text-end → flush anything left in the buffer ───────────
      if (chunk.type === "text-end") {
        if (jsonBuf) {
          const media = tryParseMedia(jsonBuf.trim());
          if (!media) {
            flushBuffer(controller);
          } else {
            jsonBuf = "";
            isBuffering = false;
          }
        }
        controller.enqueue(chunk);
        return;
      }

      // ── everything else passes through ─────────────────────────
      controller.enqueue(chunk);
    },
  });
}
