import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the actual UI helpers without starting downloads or rendering the app.
const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/\nstart\(\);\s*$/, "");
function helpers(document = {}) {
  const context = vm.createContext({ document, localStorage: { getItem: () => null } });
  vm.runInContext(`${source}\nglobalThis.helpers = { isDay, trapDialogFocus, replaceContent };`, context);
  return context.helpers;
}

test("diary date validation rejects rollover dates and accepts leap days", () => {
  const { isDay } = helpers();
  for (const value of ["2024-02-29", "2026-10-17", "2025-12-31"]) assert.equal(isDay(value), true, value);
  for (const value of ["2025-02-29", "2024-02-30", "2026-04-31", "2026-13-01", "2026-10-00", "2026-1-1", "", null]) {
    assert.equal(isDay(value), false, String(value));
  }
});

function dialogHarness() {
  const document = {};
  const control = (extra = {}) => ({ disabled: false, tabIndex: 0, closest: () => null, getClientRects: () => [{}],
    focus() { document.activeElement = this; }, ...extra });
  const first = control(), disabled = control({ disabled: true }), hidden = control({ getClientRects: () => [] }), last = control();
  const children = [first, disabled, hidden, last];
  const dialog = { querySelectorAll: () => children, contains: (node) => node === dialog || children.includes(node),
    focus() { document.activeElement = this; } };
  const elements = { sheet: { hidden: false }, "sheet-card": dialog, film: { hidden: true } };
  document.getElementById = (id) => elements[id];
  let prevented = false;
  const press = (shiftKey = false) => {
    prevented = false;
    helpers(document).trapDialogFocus({ key: "Tab", shiftKey, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { document, first, last, dialog, elements, press };
}

test("Tab and Shift+Tab wrap inside the top dialog, skipping unavailable controls", () => {
  const h = dialogHarness();
  h.document.activeElement = h.last;
  assert.equal(h.press(), true);
  assert.equal(h.document.activeElement, h.first);
  assert.equal(h.press(true), true);
  assert.equal(h.document.activeElement, h.last);
  h.document.activeElement = h.dialog;
  assert.equal(h.press(true), true);
  assert.equal(h.document.activeElement, h.last);
});

test("Tab moves normally between dialog controls and outside closed dialogs", () => {
  const h = dialogHarness();
  h.document.activeElement = h.first;
  assert.equal(h.press(), false);
  h.elements.sheet.hidden = true;
  h.document.activeElement = h.last;
  assert.equal(h.press(), false);
});

test("a dialog without available controls retains focus", () => {
  const h = dialogHarness();
  h.dialog.querySelectorAll = () => [];
  h.document.activeElement = h.first;
  assert.equal(h.press(), true);
  assert.equal(h.document.activeElement, h.dialog);
});
