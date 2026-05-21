interface Props {
  size?: number;
  className?: string;
}

/**
 * Perplex brand mark. Renders the official P-mark PNG (transparent
 * background, black silhouette) as a CSS mask, with the visible body
 * being a linear gradient that shades from orange (lower-left) into
 * dark navy. Preserves the exact original silhouette and gives the
 * "orange shade from one side" effect.
 */
export function PerplexMark({ size = 32, className }: Props) {
  const maskStyle: React.CSSProperties = {
    width: size,
    height: size,
    background: "var(--s-accent, #ff6b1a)",
    transform: "translateY(2px)",
    display: "inline-block",
    WebkitMaskImage: "url(/perplex-mark.png)",
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskImage: "url(/perplex-mark.png)",
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
  };
  return <span aria-hidden className={className} style={maskStyle} />;
}
