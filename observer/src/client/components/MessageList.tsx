import { useEffect, useRef } from "react";
import type { MessageWithParts, ActiveStream } from "@shared/types";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";

interface MessageListProps {
  messages: MessageWithParts[];
  activeStreams: ActiveStream[];
}

export function MessageList({ messages, activeStreams }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAutoScrollRef = useRef(true);

  // Track whether user has scrolled up
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 80;
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (isAutoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeStreams]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl mb-2 opacity-20">📭</div>
          <p className="text-oc-muted text-sm">No messages yet</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3"
    >
      {messages.map((msg) => {
        if (msg.info.role === "user") {
          return <UserMessage key={msg.info.id} message={msg} />;
        }
        return (
          <AssistantMessage
            key={msg.info.id}
            message={msg}
            activeStreams={activeStreams}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
