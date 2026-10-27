// Kael's title-card lettering. These paths are the source for SVG, icons and canvas.
// The wordmark's K suggests a film splice; the separate app symbol is a cinema eye.
export const BRAND = Object.freeze({ ink: "#102c43", gold: "#eac55c", paper: "#f7f6ee", white: "#ffffff" });
export const WORDMARK = Object.freeze({
  width: 490,
  height: 128,
  k: "M0 0H22V128H0Z M32 57L78 0H108L61 57Z M32 71H62L110 128H80Z",
  ael: "M132 128L178 0H202L248 128H224L214 98H166L156 128Z M174 76H206L190 31Z M270 0H366V22H294V51H353V73H294V106H366V128H270Z M390 0H414V106H490V128H390Z",
});

// A personal eye for cinema: a screen-shaped pupil inside an asymmetric eye.
// This bright, standalone symbol has its own palette; the app's lettering and
// interface keep their established colors. The favicon enlarges the small screen.
export const APP_MARK = Object.freeze({
  version: "cinema-eye-v3",
  field: 512,
  colors: Object.freeze({ field: "#ffe45b", eye: "#3b2bc5", screen: "#fff8e7", cut: "#ff604f" }),
  eye: "M80 256C132 177 184 142 246 142C316 142 379 184 432 256C380 335 328 370 266 370C196 370 133 328 80 256Z",
  screen: Object.freeze({ x: 188, y: 205, width: 136, height: 102, radius: 12 }),
  cut: "M276 205H324V253Z",
  angle: -8,
  favicon: Object.freeze({
    field: 32, scale: 0.076, radius: 6,
    screen: Object.freeze({ x: 180, y: 199, width: 152, height: 114, radius: 12 }),
    cut: "M276 199H332V255Z",
  }),
});

export function drawWordmark(context, x, y, width) {
  context.save();
  context.translate(x, y);
  context.scale(width / WORDMARK.width, width / WORDMARK.width);
  context.fillStyle = BRAND.gold;
  context.fill(new Path2D(WORDMARK.k));
  context.fillStyle = BRAND.paper;
  context.fill(new Path2D(WORDMARK.ael), "evenodd");
  context.restore();
}
