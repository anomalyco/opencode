import { useCallback, useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TextPart } from "@shared/types";

interface TextContentProps {
  part: TextPart;
  isStreaming: boolean;
}

function CodeBlock({
  language,
  children,
}: {
  language: string | undefined;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [children]);

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language || "text"}</span>
        <button
          onClick={handleCopy}
          className="text-oc-muted hover:text-oc-text transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="code-block-content">
        <pre>
          <code className={language ? `language-${language}` : ""}>
            {children}
          </code>
        </pre>
      </div>
    </div>
  );
}

export function TextContent({ part, isStreaming }: TextContentProps) {
  const components = useMemo(
    () => ({
      code({
        className,
        children,
        ...props
      }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) {
        const match = /language-(\w+)/.exec(className || "");
        const codeString = String(children).replace(/\n$/, "");
        if (match) {
          return <CodeBlock language={match[1]}>{codeString}</CodeBlock>;
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }),
    [],
  );

  if (!part.text) {
    if (isStreaming) {
      return (
        <div className="markdown-content streaming-cursor">
          <p className="text-oc-muted text-sm">Generating...</p>
        </div>
      );
    }
    return null;
  }

  return (
    <div className={`markdown-content ${isStreaming ? "streaming-cursor" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {part.text}
      </ReactMarkdown>
    </div>
  );
}
