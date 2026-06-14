export type FloatingMenuPosition = {
  left: number;
  top: number;
};

export function clampFloatingMenuPosition(
  x: number,
  y: number,
  element: HTMLElement,
  margin = 8,
): FloatingMenuPosition {
  const rect = element.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

  return {
    left: clamp(x, margin, maxLeft),
    top: clamp(y, margin, maxTop),
  };
}

export function clampFloatingPanelTop(
  anchor: HTMLElement,
  panel: HTMLElement,
  preferredTopOffset = -5,
  margin = 8,
) {
  const anchorRect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const preferredTop = anchorRect.top + preferredTopOffset;
  const maxTop = Math.max(margin, window.innerHeight - panelRect.height - margin);

  return clamp(preferredTop, margin, maxTop) - anchorRect.top;
}

export function shouldOpenFloatingPanelToLeft(anchor: HTMLElement, panel: HTMLElement, gap = 4, margin = 8) {
  const anchorRect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const overflowsRight = anchorRect.right + gap + panelRect.width > window.innerWidth - margin;
  const hasRoomOnLeft = anchorRect.left - gap - panelRect.width >= margin;

  return overflowsRight && hasRoomOnLeft;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
