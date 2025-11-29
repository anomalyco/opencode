import React, { useEffect, useRef } from 'react';

interface ShimmerTextProps {
  children: React.ReactNode;
  color?: string;
  className?: string;
}

export const ShimmerText: React.FC<ShimmerTextProps> = ({
  children,
  color = '#da7756',
  className = ''
}) => {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const span = spanRef.current;
    if (!span) return;

    const text = children?.toString() || '';
    const chars = text.split('');

    // Create individual spans for each character
    span.innerHTML = chars.map((char, index) =>
      `<span data-char-index="${index}" style="color: ${color}">${char === ' ' ? '&nbsp;' : char}</span>`
    ).join('');

    const charSpans = span.querySelectorAll('[data-char-index]') as NodeListOf<HTMLSpanElement>;
    const totalChars = charSpans.length;
    let animationId: number;

    const animate = () => {
      const time = Date.now() / 1000; // Convert to seconds
      const sweepWidth = 3; // Width of the shimmer band
      const speed = 6; // Speed of the sweep

      // Calculate the position of the shimmer band (0 to totalChars + sweepWidth)
      const pos = ((time * speed) % (totalChars + sweepWidth * 2)) - sweepWidth;

      charSpans.forEach((charSpan, index) => {
        // Calculate distance from current position
        const distance = Math.abs(index - pos);

        // Calculate brightness based on distance from shimmer center
        let brightness = Math.max(0, 1 - (distance / sweepWidth));
        brightness = Math.pow(brightness, 2); // Smooth falloff

        // Interpolate between base color and white
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        const shimmerR = Math.round(r + (255 - r) * brightness);
        const shimmerG = Math.round(g + (255 - g) * brightness);
        const shimmerB = Math.round(b + (255 - b) * brightness);

        charSpan.style.color = `rgb(${shimmerR}, ${shimmerG}, ${shimmerB})`;
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [children, color]);

  return (
    <span ref={spanRef} className={className} style={{ color }}>
      {children}
    </span>
  );
};