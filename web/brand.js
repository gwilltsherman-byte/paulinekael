// Kael's title-card lettering. These paths are the source for SVG, icons and canvas.
// The open joins in the K suggest a film splice and remain visible at favicon size.
export const BRAND = Object.freeze({ ink: "#102c43", gold: "#eac55c", paper: "#f7f6ee" });
export const WORDMARK = Object.freeze({
  width: 490,
  height: 128,
  k: "M0 0H22V128H0Z M32 57L78 0H108L61 57Z M32 71H62L110 128H80Z",
  ael: "M132 128L178 0H202L248 128H224L214 98H166L156 128Z M174 76H206L190 31Z M270 0H366V22H294V51H353V73H294V106H366V128H270Z M390 0H414V106H490V128H390Z",
});

// The install icon: an admit-one ticket stub with the K cut out of it. Coordinates are
// from the ticket's centre; the tear line has notched ends and a row of perforations.
export const TICKET = Object.freeze({
  width: 240, height: 352, radius: 16, notch: 22, tear: 92, holes: 9, hole: 5,
  star: "M0 116l9 20 22 2-16 15 5 22-20-11-20 11 5-22-16-15 22-2Z",
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
