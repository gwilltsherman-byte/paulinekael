// Kael's title-card lettering. These paths are the source for SVG, icons and canvas.
// The wordmark's K suggests a film splice; the app icon is a single film frame.
export const BRAND = Object.freeze({ ink: "#102c43", gold: "#eac55c", paper: "#f7f6ee", white: "#ffffff" });
export const WORDMARK = Object.freeze({
  width: 490,
  height: 128,
  k: "M0 0H22V128H0Z M32 57L78 0H108L61 57Z M32 71H62L110 128H80Z",
  ael: "M132 128L178 0H202L248 128H224L214 98H166L156 128Z M174 76H206L190 31Z M270 0H366V22H294V51H353V73H294V106H366V128H270Z M390 0H414V106H490V128H390Z",
});

// A flat film frame, with its picture and four perforations cut from one shape.
// Its standalone palette does not change the interface or title-card lettering.
export const APP_MARK = Object.freeze({
  version: "film-frame-v4",
  field: 64,
  colors: Object.freeze({ field: "#f9d74c", mark: "#252321" }),
  path: "M16 15H48A4 4 0 0 1 52 19V45A4 4 0 0 1 48 49H16A4 4 0 0 1 12 45V19A4 4 0 0 1 16 15Z M18 25H46V39H18Z M18 19H23V22H18Z M41 19H46V22H41Z M18 42H23V45H18Z M41 42H46V45H41Z",
  favicon: Object.freeze({
    field: 32, scale: 0.56, radius: 6,
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
