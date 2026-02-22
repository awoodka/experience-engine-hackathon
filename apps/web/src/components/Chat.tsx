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
import superjson from "superjson";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Film,
  HardHat,
  Image,
  Loader2,
  Plus,
  Square,
  XCircle,
} from "lucide-react";
import {
  Fragment,
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useStickToBottom } from "use-stick-to-bottom";

// ---------------------------------------------------------------------------
// Chat persistence helpers (file-system via API)
// ---------------------------------------------------------------------------

function getChatIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/chat\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function saveChatToApi(id: string, msgs: ChatMessage[]) {
  try {
    const clean = msgs.map((m) => ({
      ...m,
      parts: m.parts.filter((p) => {
        if (p.type === "reasoning") return p.state === "complete";
        if (p.type === "tool-invocation")
          return p.state === "output-available" || p.state === "output-error";
        return true;
      }),
    }));
    api.api.chats[":id"]
      .$post({
        param: { id },
        json: superjson.serialize({
          messages: clean,
          updatedAt: new Date(),
        }),
      })
      .catch(() => {});
  } catch {
    // serialize failed – ignore
  }
}

// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  {
    label: "Who needs help tomorrow?",
    prompt:
      "Which workers had the most hesitation, rework, or micro-stops today? Show me the specific moments so I know who to check in with tomorrow morning.",
  },
  {
    label: "Pair up a fast mason with a slow one",
    prompt:
      "Find a worker who's fast and smooth at block laying and a worker who's struggling with the same task. Show me both clips so I can pair them up for a quick mentorship session.",
  },
  {
    label: "Where are we losing time?",
    prompt:
      "Where are we losing the most time across all the footage? Show me the biggest gaps between tasks, unnecessary tool changes, and stops that could've been avoided with better staging.",
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

  const description =
    input != null && typeof input === "object" && "description" in input
      ? String((input as Record<string, unknown>).description)
      : null;
  const name = description ?? getToolName(part) ?? "tool";

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
          <span className="font-medium">
            {description ? name : `${isRunning ? "Using" : "Used"} ${name}`}
          </span>
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
  const chatIdRef = useRef<string | null>(getChatIdFromUrl());

  const { messages, sendMessage, status, stop, setMessages } =
    useChat<ChatMessage>({
      transport: new DefaultChatTransport({
        api: "/api/chat",
      }),
    });
  const [input, setInput] = useState("");
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);

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

  // --- Load persisted chat from API on mount ---
  useEffect(() => {
    const id = chatIdRef.current;
    if (!id) return;
    api.api.chats[":id"]
      .$get({ param: { id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const { messages } = superjson.deserialize<{
          messages: ChatMessage[];
        }>(data);
        if (messages.length) setMessages(messages);
      })
      .catch(() => {});
  }, [setMessages]);

  // --- Persist to API via ref + status changes ---
  // Use a ref so we always have current messages regardless of effect deps
  const messagesRef = useRef(messages);
  useLayoutEffect(() => {
    messagesRef.current = messages;
  });

  // Save when status transitions to ready (chat finished)
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    const id = chatIdRef.current;
    if (!id) return;

    if (status === "ready" && prev !== "ready") {
      saveChatToApi(id, messagesRef.current);
    }
  }, [status]);

  // Periodic save every 3s while actively streaming
  useEffect(() => {
    const id = chatIdRef.current;
    if (!id || status === "ready") return;

    const interval = setInterval(() => {
      if (messagesRef.current.length > 0) {
        saveChatToApi(id, messagesRef.current);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [status]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  // Navigate to /chat/<id> on first message
  const ensureChatId = useCallback(() => {
    if (chatIdRef.current) return;
    const newId = crypto.randomUUID();
    chatIdRef.current = newId;
    window.history.pushState({}, "", `/chat/${newId}`);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;
      ensureChatId();
      sendMessage({ text: input });
      setInput("");
    },
    [input, isLoading, sendMessage, ensureChatId],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        plusMenuRef.current &&
        !plusMenuRef.current.contains(e.target as Node)
      ) {
        setPlusMenuOpen(false);
      }
    };
    if (plusMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [plusMenuOpen]);

  const transcript = useMemo(() => {
    return messages
      .map((msg) => {
        const heading =
          msg.role === "user" ? "## You said:" : "## Assistant said:";
        const sections: string[] = [];

        for (const part of msg.parts) {
          if (part.type === "text") {
            sections.push(part.text);
          } else if (isReasoningUIPart(part)) {
            sections.push(
              `<details>\n<summary>Thinking</summary>\n\n${part.text}\n\n</details>`,
            );
          } else if (isToolUIPart(part)) {
            const toolInput = part.input;
            const toolDesc =
              toolInput != null &&
              typeof toolInput === "object" &&
              "description" in toolInput
                ? String((toolInput as Record<string, unknown>).description)
                : null;
            const name = toolDesc ?? getToolName(part) ?? "tool";
            const lines: string[] = [];
            if (part.input != null) {
              const inputStr =
                typeof part.input === "string"
                  ? part.input
                  : JSON.stringify(part.input, null, 2);
              lines.push(`**Input:**\n\`\`\`json\n${inputStr}\n\`\`\``);
            }
            if (part.output != null) {
              const outputStr =
                typeof part.output === "string"
                  ? part.output
                  : JSON.stringify(part.output, null, 2);
              lines.push(`**Output:**\n\`\`\`json\n${outputStr}\n\`\`\``);
            }
            if (part.errorText != null) {
              lines.push(
                `**Error:**\n\`\`\`\n${String(part.errorText)}\n\`\`\``,
              );
            }
            sections.push(
              `<details>\n<summary>Tool Call: ${name}</summary>\n\n${lines.join("\n\n")}\n\n</details>`,
            );
          }
        }

        return `${heading}\n\n${sections.join("\n\n")}`;
      })
      .join("\n\n---\n\n");
  }, [messages]);

  const copyTranscript = useCallback(() => {
    navigator.clipboard.writeText(transcript);
    setPlusMenuOpen(false);
  }, [transcript]);

  const handleSuggestion = (prompt: string) => {
    if (isLoading) return;
    setInput(prompt);
    textareaRef.current?.focus();
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
              Surface expert micro-habits, compare worker techniques, find
              coaching opportunities.
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
                      return <VideoPlayer key={key} path={part.data.path} />;
                    }

                    if (part.type === "data-image") {
                      return <ImageViewer key={key} path={part.data.path} />;
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
        <form
          onSubmit={(e) => e.preventDefault()}
          className="mx-auto max-w-3xl"
        >
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
            <div className="absolute right-3 bottom-3 left-3 flex items-center justify-between">
              <div ref={plusMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setPlusMenuOpen((v) => !v)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
                    "border border-[var(--color-ee-border)] text-[var(--color-ee-text-muted)] hover:bg-[var(--color-ee-border)] hover:text-[var(--color-ee-text)]",
                    plusMenuOpen && "rotate-45",
                  )}
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                </button>
                {plusMenuOpen && (
                  <div className="absolute bottom-10 left-0 z-10 min-w-[180px] overflow-hidden rounded-xl border border-[var(--color-ee-border)] bg-[var(--color-ee-surface)] py-1 shadow-xl shadow-black/30">
                    <button
                      type="button"
                      onClick={copyTranscript}
                      className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[var(--color-ee-text-secondary)] transition-colors hover:bg-[var(--color-ee-border)] hover:text-[var(--color-ee-text)]"
                    >
                      <ClipboardCopy className="h-4 w-4" />
                      Copy transcript
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
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
                    type="button"
                    onClick={handleSubmit}
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
          </div>
        </form>
      </div>
    </div>
  );
}
