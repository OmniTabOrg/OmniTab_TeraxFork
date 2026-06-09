export function elementFromDragPosition(position: {
  x: number;
  y: number;
}): Element | null {
  let x = position.x;
  let y = position.y;
  if (x > window.innerWidth || y > window.innerHeight) {
    const dpr = window.devicePixelRatio || 1;
    x = x / dpr;
    y = y / dpr;
  }
  return document.elementFromPoint(x, y);
}
