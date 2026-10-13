// Title search: which films a typed query finds, best first. Pure functions over the
// film list, so it can be tested without a browser (tests/search.test.mjs).
import { norm } from "./importer.js";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const article = /^(the|a|an) /;
// How well a title matches adds to log10(votes), so a better match wins unless the other
// film is much more famous (an exact 1,000-vote title still loses to a 2-million-vote
// sequel that starts with the same words).
const BONUS = [0, 0.4, 1.0, 1.5];   // contains every word, each word starts a word, starts with it, is it

export class Titles {
  /** titles, votes: the films' columns (same order as films.json). */
  constructor(titles, votes) {
    this.titles = titles;
    this.votes = votes;
    this.index = new Array(titles.length);   // lowercase, accent-free titles, filled by warm()
    this.at = 0;
  }

  /** Index more titles: at least 256, then more until about ms milliseconds have passed
   *  (Infinity: all that's left). Lets the app build the index in small slices while it's
   *  idle, so the first search doesn't have to. Returns true once every title is indexed. */
  warm(ms) {
    const end = performance.now() + ms, n = this.titles.length;
    do {
      for (const stop = Math.min(n, this.at + 256); this.at < stop; this.at++) this.index[this.at] = norm(this.titles[this.at]);
    } while (this.at < n && performance.now() < end);
    return this.at >= n;
  }

  /** The best `limit` films for a query, best first. A title that is the query ("the"
   *  and "a" don't count), starts with it, or has each word starting a word ranks above
   *  one that merely contains the words, then the more famous the better (see BONUS). */
  find(query, limit = 30) {
    const words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    this.warm(Infinity);
    const { index, votes } = this, phrase = words.join(" ");
    const starts = words.map((w) => new RegExp(`(^|[^a-z0-9])${escapeRe(w)}`));
    const top = [];   // [score, film], best first
    const consider = (i, tier) => {
      const score = BONUS[tier] + Math.log10(votes[i] + 1);
      if (top.length === limit && score <= top[limit - 1][0]) return;
      let p = top.length;
      while (p > 0 && top[p - 1][0] < score) p--;
      top.splice(p, 0, [score, i]);
      if (top.length > limit) top.pop();
    };
    for (let i = 0; i < index.length; i++) {
      const t = index[i];
      if (!words.every((w) => t.includes(w))) continue;
      const bare = t.replace(article, "");
      consider(i, t === phrase || bare === phrase ? 3 : t.startsWith(phrase) || bare.startsWith(phrase) ? 2
        : starts.every((r) => r.test(t)) ? 1 : 0);
    }
    if (!top.length) {
      // Nothing, so try it as one run of letters: "spiderman" for Spider-Man, "wall-e" for WALL·E.
      // The titles as runs of letters are made the first time this is needed, then kept, so
      // typing a title that isn't there doesn't redo them on every key.
      const run = phrase.replace(/[^a-z0-9]/g, "");
      if (run.length > 1) {
        this.runs ??= index.map((t) => t.replace(/[^a-z0-9]/g, ""));
        for (let i = 0; i < index.length; i++) if (this.runs[i].includes(run)) consider(i, 0);
      }
    }
    return top.map(([, i]) => i);
  }
}
