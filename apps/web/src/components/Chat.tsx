import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { ArrowUp, HardHat, Loader2, SquarePen } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";

const SUGGESTIONS = [
  {
    label: "Safety violations",
    prompt: "Show safety violations or risky behaviors across all footage",
  },
  {
    label: "Expert techniques",
    prompt: "Find expert-level techniques and high-skill worker behaviors",
  },
  {
    label: "Tool usage",
    prompt: "Analyze tool usage patterns and efficiency across the job site",
  },
  {
    label: "Communication",
    prompt: "Identify team communication events and coordination patterns",
  },
];

type ChatMessage = UIMessage;

function getToolName(part: ChatMessage["parts"][number]): string | undefined {
  if (part.type === "dynamic-tool") return part.toolName;
  if (part.type.startsWith("tool-")) return part.type.slice(5);
  return undefined;
}

export default function Chat() {
  const { messages, sendMessage, setMessages, status } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: "http://localhost:7892/api/chat",
    }),
  });
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  const isStreaming = status === "streaming";
  const isReady = status === "ready";
  const isEmpty = messages.length === 0;

  useEffect(() => {
    setMounted(true);
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      if (!input.trim() || !isReady) return;
      sendMessage({ text: input });
      setInput("");
    },
    [input, isReady, sendMessage],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleSuggestion = (prompt: string) => {
    if (!isReady) return;
    sendMessage({ text: prompt });
  };

  const handleNewChat = () => {
    setMessages([]);
    setInput("");
    textareaRef.current?.focus();
  };

  return (
    <div
      className={cn(
        "flex h-screen flex-col bg-[var(--color-ee-bg)]",
        "transition-opacity duration-500",
        mounted ? "opacity-100" : "opacity-0",
      )}
    >
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-ee-accent)]">
            <HardHat className="h-4 w-4 text-black" />
          </div>
          <span className="text-base font-semibold tracking-tight text-[var(--color-ee-text)]">
            Experience Engine
          </span>
        </div>
        {!isEmpty && (
          <button
            onClick={handleNewChat}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ee-text-muted)] transition-colors hover:bg-[var(--color-ee-surface)] hover:text-[var(--color-ee-text)]"
            title="New chat"
          >
            <SquarePen className="h-4 w-4" />
          </button>
        )}
      </header>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center px-4">
            <div
              className="animate-fade-in-up"
              style={{ animationDelay: "100ms" }}
            >
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
                <HardHat className="h-7 w-7 text-white" />
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
          <div className="mx-auto max-w-3xl px-4 pt-2 pb-4">
            {messages.map((message, i) => {
              const isUser = message.role === "user";

              return message.parts.map((part, j) => {
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
                    <div key={key} className="animate-fade-in mb-6 flex gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600">
                        <HardHat className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="ee-prose min-w-0 flex-1 text-[15px]">
                        <Streamdown isAnimating={isStreaming}>
                          {part.text}
                        </Streamdown>
                      </div>
                    </div>
                  );
                }

                const toolName = getToolName(part);
                if (toolName) {
                  return (
                    <div key={key} className="animate-fade-in mb-4 flex gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-ee-surface)]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-ee-text-muted)]" />
                      </div>
                      <div className="flex items-center rounded-xl bg-[var(--color-ee-surface)] px-4 py-2 text-[13px] text-[var(--color-ee-text-muted)]">
                        <span className="font-medium">{`Using ${toolName}`}</span>
                      </div>
                    </div>
                  );
                }

                return null;
              });
            })}
            {isStreaming &&
              messages[messages.length - 1]?.role !== "assistant" && (
                <div className="animate-fade-in mb-6 flex gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600">
                    <HardHat className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex items-center gap-1.5 pt-2">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-ee-text-muted)] [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-ee-text-muted)] [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-ee-text-muted)] [animation-delay:300ms]" />
                  </div>
                </div>
              )}
            <div ref={endRef} />
          </div>
        )}
      </div>

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
              placeholder="Message Experience Engine..."
              disabled={!isReady}
              rows={1}
              className="w-full resize-none bg-transparent px-6 pt-4 pb-14 text-[15px] text-[var(--color-ee-text)] placeholder:text-[var(--color-ee-text-faint)] focus:outline-none disabled:opacity-40"
              style={{ maxHeight: "200px" }}
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              <button
                type="submit"
                disabled={!isReady || !input.trim()}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
                  input.trim() && isReady
                    ? "bg-white text-[var(--color-ee-bg)] hover:scale-105 hover:bg-gray-200 active:scale-95"
                    : "cursor-not-allowed bg-[var(--color-ee-text-faint)] text-[var(--color-ee-surface)]",
                )}
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                )}
              </button>
            </div>
          </div>
          <p className="mt-2.5 text-center text-[11px] text-[var(--color-ee-text-faint)]">
            Experience Engine analyzes construction video for expert behavioral
            patterns.
          </p>
        </form>
      </div>
    </div>
  );
}
