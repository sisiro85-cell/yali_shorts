import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent } from "react";

export function HelpTooltip({ label, description }: { label: string; description: string }) {
  const tooltipId = `idea-help-${useId().replace(/:/g, "")}`;
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; arrowLeft: number } | null>(null);
  const isOpen = isHovered || isFocused;

  useLayoutEffect(() => {
    if (!isOpen) {
      setTooltipPosition(null);
      return;
    }

    function updatePosition() {
      const button = buttonRef.current;
      const tooltip = tooltipRef.current;
      if (!button || !tooltip) return;

      const buttonRect = button.getBoundingClientRect();
      const tooltipWidth = tooltip.getBoundingClientRect().width;
      const padding = 16;
      const preferredLeft = window.innerWidth <= 820
        ? buttonRect.left + buttonRect.width / 2 - tooltipWidth / 2
        : buttonRect.right + 10;
      const left = Math.max(padding, Math.min(preferredLeft, window.innerWidth - tooltipWidth - padding));
      const arrowLeft = Math.max(8, Math.min(buttonRect.left + buttonRect.width / 2 - left - 4, tooltipWidth - 16));
      setTooltipPosition({ left: left - buttonRect.left, arrowLeft });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [isOpen]);

  function handleBlur(event: FocusEvent<HTMLButtonElement>) {
    if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setIsFocused(false);
  }

  return (
    <span className={`idea-help-tooltip${isOpen ? " is-open" : ""}`}>
      <button
        ref={buttonRef}
        className="idea-help"
        type="button"
        aria-label={label}
        aria-describedby={isOpen ? tooltipId : undefined}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={handleBlur}
      >
        ?
      </button>
      {isOpen ? <span ref={tooltipRef} className="idea-help-tooltip__content" id={tooltipId} role="tooltip" style={tooltipPosition ? { left: `${tooltipPosition.left}px`, "--idea-help-arrow-left": `${tooltipPosition.arrowLeft}px` } as CSSProperties : undefined}>{description}</span> : null}
    </span>
  );
}
