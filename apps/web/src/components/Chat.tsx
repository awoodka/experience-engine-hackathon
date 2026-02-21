import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isToolUIPart,
  isReasoningUIPart,
  getToolName,
} from "ai";
import type {
  DynamicToolUIPart,
  ReasoningUIPart,
  ToolUIPart,
  UIMessage,
  UIDataTypes,
} from "ai";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Film,
  HardHat,
  Image,
  Loader2,
  Square,
  XCircle,
} from "lucide-react";
import { Fragment, useRef, useEffect, useState, useCallback } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

const SUGGESTIONS = [
  {
    label: "Best mason habits",
    prompt:
      "What does the best mason on this site do differently? Show me the micro-behaviors that set them apart.",
  },
  {
    label: "Body positioning",
    prompt:
      "Find moments where workers use expert body positioning or ergonomic techniques that reduce fatigue and injury risk.",
  },
  {
    label: "Material staging",
    prompt:
      "How do top performers stage their materials before starting a task? Compare efficient vs inefficient setups.",
  },
  {
    label: "Trainable insights",
    prompt:
      "What subconscious expert habits from this footage could be turned into training for new workers?",
  },
];

/** Custom data parts sent by the API media transform. */
interface MediaDataTypes extends UIDataTypes {
  video: { path: string };
  image: { path: string };
}

type ChatMessage = UIMessage<unknown, MediaDataTypes>;
type ChatToolPart = ToolUIPart | DynamicToolUIPart;

function ToolPart({ part }: { part: ChatToolPart }) {
  const [open, setOpen] = useState(false);
  const name = getToolName(part) ?? "tool";
  const state = part.state;

  const isRunning =
    !state ||
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested";
  const isError = state === "output-error";
  const isDone = state === "output-available";

  const input = part.input;
  const output = part.output;
  const errorText = part.errorText;

  const hasDetails = input != null || output != null || errorText != null;

  return (
    <div className="animate-fade-in mb-4 flex gap-3">
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isError
            ? "bg-red-500/10"
            : isDone
              ? "bg-emerald-500/10"
              : "bg-[var(--color-ee-surface)]",
        )}
      >
        {isRunning && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-ee-text-muted)]" />
        )}
        {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
        {isError && <XCircle className="h-3.5 w-3.5 text-red-400" />}
        {!isRunning && !isDone && !isError && (
          <XCircle className="h-3.5 w-3.5 text-[var(--color-ee-text-muted)]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <button
          onClick={() => hasDetails && setOpen(!open)}
          className={cn(
            "flex items-center gap-2 rounded-xl bg-[var(--color-ee-surface)] px-4 py-2 text-[13px] text-[var(--color-ee-text-muted)]",
            hasDetails && "cursor-pointer hover:bg-[var(--color-ee-border)]",
          )}
        >
          <span className="font-medium">{`${isRunning ? "Using" : "Used"} ${name}`}</span>
          {hasDetails && (
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          )}
        </button>
        {open && hasDetails && (
          <div className="mt-2 space-y-2 rounded-xl bg-[var(--color-ee-surface)] p-3 text-[12px]">
            {input != null && (
              <div>
                <div className="mb-1 font-semibold text-[var(--color-ee-text-muted)]">
                  Input
                </div>
                <pre className="overflow-x-auto break-all whitespace-pre-wrap text-[var(--color-ee-text-secondary)]">
                  {typeof input === "string"
                    ? input
                    : JSON.stringify(input, null, 2)}
                </pre>
              </div>
            )}
            {output != null && (
              <div>
                <div className="mb-1 font-semibold text-emerald-400">
                  Output
                </div>
                <pre className="overflow-x-auto break-all whitespace-pre-wrap text-[var(--color-ee-text-secondary)]">
                  {typeof output === "string"
                    ? output
                    : JSON.stringify(output, null, 2)}
                </pre>
              </div>
            )}
            {errorText != null && (
              <div>
                <div className="mb-1 font-semibold text-red-400">Error</div>
                <pre className="overflow-x-auto break-all whitespace-pre-wrap text-red-300">
                  {String(errorText)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReasoningPart({ part }: { part: ReasoningUIPart }) {
  const [open, setOpen] = useState(false);
  const isStreaming = !part.state || part.state === "streaming";

  return (
    <div className="animate-fade-in mb-4 flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-ee-surface)]">
        {isStreaming ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-ee-text-muted)]" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-ee-text-muted)]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <button
          onClick={() => setOpen(!open)}
          className="flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--color-ee-surface)] px-4 py-2 text-[13px] text-[var(--color-ee-text-muted)] hover:bg-[var(--color-ee-border)]"
        >
          <span className="font-medium">
            {isStreaming ? "Thinking..." : "Thought"}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
        {open && (
          <div className="mt-2 rounded-xl bg-[var(--color-ee-surface)] p-3 text-[13px] leading-relaxed text-[var(--color-ee-text-muted)]">
            {part.text}
          </div>
        )}
      </div>
    </div>
  );
}

function VideoPlayer({ path }: { path: string }) {
  // Rewrite data/ paths to /data/ for the Vite middleware
  const src = path.startsWith("data/") ? `/${path}` : path;

  return (
    <div className="animate-fade-in mb-6">
      <div className="overflow-hidden rounded-2xl border border-[var(--color-ee-border)] bg-black">
        <div className="flex items-center gap-2 border-b border-[var(--color-ee-border)] bg-[var(--color-ee-surface)] px-4 py-2">
          <Film className="h-4 w-4 text-[var(--color-ee-accent)]" />
          <span className="text-[13px] font-medium text-[var(--color-ee-text-secondary)]">
            Generated Video
          </span>
        </div>
        <video controls className="w-full" src={src} preload="metadata" />
      </div>
    </div>
  );
}

function ImageViewer({ path }: { path: string }) {
  const src = path.startsWith("data/") ? `/${path}` : path;

  return (
    <div className="animate-fade-in mb-6">
      <div className="overflow-hidden rounded-2xl border border-[var(--color-ee-border)] bg-black">
        <div className="flex items-center gap-2 border-b border-[var(--color-ee-border)] bg-[var(--color-ee-surface)] px-4 py-2">
          <Image className="h-4 w-4 text-[var(--color-ee-accent)]" />
          <span className="text-[13px] font-medium text-[var(--color-ee-text-secondary)]">
            Extracted Frame
          </span>
        </div>
        <img src={src} alt="Extracted frame" className="w-full" />
      </div>
    </div>
  );
}

export default function Chat() {
  const { messages, sendMessage, status, stop } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });
  const [input, setInput] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom();

  const isStreaming = status === "streaming";
  const isLoading = isStreaming || status === "submitted";
  const isEmpty = messages.length === 0;

  useEffect(() => {
    containerRef.current?.classList.replace("opacity-0", "opacity-100");
    textareaRef.current?.focus();
  }, []);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;
      sendMessage({ text: input });
      setInput("");
    },
    [input, isLoading, sendMessage],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleSuggestion = (prompt: string) => {
    if (isLoading) return;
    sendMessage({ text: prompt });
  };

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col bg-[var(--color-ee-bg)] opacity-0 transition-opacity duration-500"
    >
      {/* Messages area */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center px-4">
            <div
              className="animate-fade-in-up"
              style={{ animationDelay: "100ms" }}
            >
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center text-amber-500">
                <HardHat className="h-10 w-10" />
              </div>
            </div>
            <h1
              className="animate-fade-in-up mb-2 text-center text-[28px] font-semibold text-[var(--color-ee-text)]"
              style={{ animationDelay: "200ms" }}
            >
              What can I help with?
            </h1>
            <p
              className="animate-fade-in-up mb-10 text-center text-sm text-[var(--color-ee-text-muted)]"
              style={{ animationDelay: "300ms" }}
            >
              Analyze construction video, find patterns, identify behaviors.
            </p>
            <div
              className="animate-fade-in-up flex flex-wrap justify-center gap-2"
              style={{ animationDelay: "400ms" }}
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => handleSuggestion(s.prompt)}
                  className="rounded-full border border-[var(--color-ee-border)] bg-transparent px-4 py-2 text-[13px] font-medium text-[var(--color-ee-text-secondary)] transition-all hover:border-[var(--color-ee-text-muted)] hover:bg-[var(--color-ee-surface)] hover:text-[var(--color-ee-text)]"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div ref={contentRef} className="mx-auto max-w-3xl px-4 pt-2 pb-4">
            {messages.map((message, i) => {
              const isUser = message.role === "user";
              const isLastMessage = i === messages.length - 1;

              const lastTextIndex = message.parts.findLastIndex(
                (p) => p.type === "text",
              );

              return (
                <Fragment key={message.id}>
                  {message.parts.map((part, j) => {
                    const key = `${message.id}-${j}`;

                    if (part.type === "text") {
                      if (isUser) {
                        return (
                          <div
                            key={key}
                            className="animate-fade-in-up mb-6 flex justify-end"
                          >
                            <div className="max-w-[85%] rounded-3xl bg-[var(--color-ee-surface)] px-5 py-3 text-[15px] leading-relaxed text-[var(--color-ee-text)]">
                              {part.text}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={key} className="animate-fade-in mb-6">
                          <div className="ee-prose min-w-0 flex-1 text-[15px]">
                            <Streamdown
                              isAnimating={
                                isStreaming &&
                                isLastMessage &&
                                j === lastTextIndex
                              }
                            >
                              {part.text}
                            </Streamdown>
                          </div>
                        </div>
                      );
                    }

                    if (isReasoningUIPart(part)) {
                      return <ReasoningPart key={key} part={part} />;
                    }

                    if (isToolUIPart(part)) {
                      return <ToolPart key={key} part={part} />;
                    }

                    if (part.type === "data-video") {
                      return (
                        <VideoPlayer
                          key={key}
                          path={(part.data as { path: string }).path}
                        />
                      );
                    }

                    if (part.type === "data-image") {
                      return (
                        <ImageViewer
                          key={key}
                          path={(part.data as { path: string }).path}
                        />
                      );
                    }

                    return null;
                  })}
                </Fragment>
              );
            })}
            {isLoading &&
              messages[messages.length - 1]?.role !== "assistant" && (
                <div className="animate-fade-in mb-6">
                  <div className="flex items-center gap-1.5 pt-2">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-ee-text-muted)] [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-ee-text-muted)] [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-ee-text-muted)] [animation-delay:300ms]" />
                  </div>
                </div>
              )}
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {!isEmpty && !isAtBottom && (
        <div className="flex justify-center pb-2">
          <button
            onClick={() => scrollToBottom()}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-ee-surface)] text-[var(--color-ee-text-muted)] shadow-lg transition-all hover:bg-[var(--color-ee-border)] hover:text-[var(--color-ee-text)]"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className={cn("shrink-0 px-4 pb-4", isEmpty && "-mt-16")}>
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div
            className={cn(
              "relative overflow-hidden rounded-3xl bg-[var(--color-ee-surface)] shadow-xl shadow-black/20",
              "ring-1 ring-transparent transition-all focus-within:ring-[var(--color-ee-border)]",
            )}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything..."
              rows={1}
              className="w-full resize-none bg-transparent px-6 pt-4 pb-14 text-[15px] text-[var(--color-ee-text)] placeholder:text-[var(--color-ee-text-faint)] focus:outline-none"
              style={{ maxHeight: "200px" }}
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              {isLoading ? (
                <button
                  type="button"
                  onClick={() => stop()}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[var(--color-ee-bg)] transition-all duration-200 hover:scale-105 hover:bg-gray-200 active:scale-95"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
                    input.trim()
                      ? "bg-white text-[var(--color-ee-bg)] hover:scale-105 hover:bg-gray-200 active:scale-95"
                      : "cursor-not-allowed bg-[var(--color-ee-text-faint)] text-[var(--color-ee-surface)]",
                  )}
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
