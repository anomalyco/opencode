import React, { useState, useEffect, useRef } from 'react';

interface AgentDisplay {
  name: string;
  color: string;
}

interface ExecutableShimmerProps {
  initialAgents?: AgentDisplay[];
  className?: string;
  id?: string;
}

export const ExecutableShimmer: React.FC<ExecutableShimmerProps> = ({
  initialAgents = [{ name: 'claude', color: '#da7756' }],
  className = '',
  id,
}) => {
  const [agents, setAgents] = useState<AgentDisplay[]>(initialAgents);
  const containerRef = useRef<HTMLSpanElement>(null);
  const charRefsRef = useRef<Array<{ element: HTMLSpanElement; color: string }>>([]);

  useEffect(() => {
    const handleUpdateCommand = (event: CustomEvent) => {
      const { agents: updatedAgents } = event.detail;
      setAgents(updatedAgents);
    };

    window.addEventListener('updateExecutableShimmer', handleUpdateCommand as EventListener);

    return () => {
      window.removeEventListener('updateExecutableShimmer', handleUpdateCommand as EventListener);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Collect all character spans from the rendered React content
    const charSpans: Array<{ element: HTMLSpanElement; color: string }> = [];
    const allSpans = container.querySelectorAll('[data-color]') as NodeListOf<HTMLSpanElement>;

    allSpans.forEach((span) => {
      charSpans.push({
        element: span,
        color: span.dataset.color || '#da7756'
      });
    });

    charRefsRef.current = charSpans;
    const totalChars = charSpans.length;
    let animationId: number;

    const animate = () => {
      const time = Date.now() / 1000;
      const sweepWidth = 3;
      const speed = 6;

      const pos = ((time * speed) % (totalChars + sweepWidth * 2)) - sweepWidth;

      charSpans.forEach((item, index) => {
        const baseColor = item.color;
        const distance = Math.abs(index - pos);

        let brightness = Math.max(0, 1 - (distance / sweepWidth));
        brightness = Math.pow(brightness, 2);

        const r = parseInt(baseColor.slice(1, 3), 16);
        const g = parseInt(baseColor.slice(3, 5), 16);
        const b = parseInt(baseColor.slice(5, 7), 16);

        const shimmerR = Math.round(r + (255 - r) * brightness);
        const shimmerG = Math.round(g + (255 - g) * brightness);
        const shimmerB = Math.round(b + (255 - b) * brightness);

        item.element.style.color = `rgb(${shimmerR}, ${shimmerG}, ${shimmerB})`;
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [agents]);

  return (
    <span ref={containerRef} id={id} className={className}>
      {agents.map((agent, agentIdx) => (
        <React.Fragment key={agent.name}>
          {agentIdx > 0 && (
            <>
              <span data-color="#6b7280">,</span>
              <span data-color="#6b7280"> </span>
            </>
          )}
          {agent.name.split('').map((char, charIdx) => (
            <span key={`${agent.name}-${charIdx}`} data-color={agent.color}>
              {char}
            </span>
          ))}
        </React.Fragment>
      ))}
    </span>
  );
};
