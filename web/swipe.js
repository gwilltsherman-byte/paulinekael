// Swipeable cards. A card follows your finger; releasing past the threshold in an
// enabled direction calls onSwipe(dir). While dragging, the card gets
// --p-right / --p-left / --p-up / --p-down (0..1) for its direction stamps.

const DIRS = ["right", "left", "up", "down"];
const THRESHOLD = 90;

export function swipeable(card, enabled, onSwipe, onTap) {
  let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false, moved = false;

  const direction = () => {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 14) return null;
    if (ax >= ay) return dx > 0 ? "right" : "left";
    return dy < 0 ? "up" : "down";
  };
  const paint = () => {
    const d = direction();
    for (const k of DIRS) {
      const dist = k === "right" || k === "left" ? Math.abs(dx) : Math.abs(dy);
      card.style.setProperty(`--p-${k}`, d === k && enabled[k] ? Math.min(1, dist / THRESHOLD) : 0);
    }
  };

  card.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("[data-nodrag]")) return;
    dragging = true; moved = false; sx = ev.clientX; sy = ev.clientY; dx = dy = 0;
    card.setPointerCapture(ev.pointerId);
    card.style.transition = "none";
  });
  card.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    dx = ev.clientX - sx; dy = ev.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 22}deg)`;
    paint();
  });
  const end = (ev) => {
    if (!dragging) return;
    dragging = false;
    card.style.transition = "";
    const d = direction();
    const dist = d === "right" || d === "left" ? Math.abs(dx) : Math.abs(dy);
    if (d && enabled[d] && dist > THRESHOLD) onSwipe(d);
    else {
      reset(card);
      if (!moved && onTap) onTap(ev);
    }
    dx = dy = 0;
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

export function reset(card) {
  card.style.transform = "";
  for (const k of DIRS) card.style.setProperty(`--p-${k}`, 0);
}

/** Throw the card off screen in a direction (also used by the buttons). */
export function fly(card, dir) {
  const [x, y] = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] }[dir];
  card.style.setProperty(`--p-${dir}`, 1);
  card.style.transition = "transform .32s ease, opacity .32s ease";
  card.style.transform = `translate(${x * 130}%, ${y * 120}%) rotate(${x * 16}deg)`;
  card.style.opacity = "0";
}
