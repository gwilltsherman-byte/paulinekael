# Kael

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Assumption from the working product: curious film viewers who want something they will enjoy tonight, and returning viewers building a private record of their film taste. Primary devices are phones and desktop browsers. A typical visit is a short search or rating session; film reading and discovery can take longer.

## Product Purpose

Rate films you have seen, get recommendations that learn from your answers, choose a film, and save or log it. Success means a new viewer can understand and give three ratings without instruction, find a reasoned recommendation, save it, and find it again. A returning viewer can search, change a rating, log a viewing, or choose three Tonight picks with few steps.

## Positioning

The existing Bayesian taste model learns locally from ratings, chooses informative questions, and explains recommendations through the combination of films the viewer rated. Kael is named after Pauline Kael; it does not reproduce or claim to represent her opinions.

## Operating Context

Home recommendations; one-at-a-time Rate and a poster wall; Search with mood, genre and decade browsing; Library with Watchlist, Diary and Ratings; Your taste with scales, film history and friend taste links; Settings with streaming services, import, backup and restore. First recommendations begin after three ratings; twenty is the existing quiz goal. Keyboard quiz answers remain 1/2/3/4, S/W and Z.

## Capabilities and Constraints

Existing vanilla HTML, CSS and JavaScript modules, with a Python catalog/model build and GitHub Pages deployment. No framework or backend migration. Keep the current engine, catalog indices, exact imported ratings, mt.*.v1 storage keys, #f film links, taste links, quick-start loading, service worker and all import/export behavior. All personal state is device-local. Streaming availability is US-only and may change. Film details, posters, cast and trailers depend on the exported TMDB data and external images/video. Do not invent live availability or synchronization. Published site-branch data can support a local preview without retraining the model.

## Brand Commitments

Preserve Kael, real film artwork and factual catalog content. The user requests one complete, distinctive redesign and delegates creative decisions. Existing visuals are evidence rather than a binding design system. Apple, Stripe and Linear are requested craft references, complemented by film-cultural references.

## Evidence on Hand

README.md; web/; taste/; model/; tests/; scripts/smoke.mjs; current GitHub site branch. The working interface and real TMDB poster assets are available. No fabricated reviews, editorial verdicts or user statistics.

## Product Principles

- Give a clear next action while keeping exploration close.
- Make the reason for a recommendation understandable.
- Let film imagery and titles carry the character.
- Preserve personal history and provide an obvious way to back it up.
- Make common tasks equally usable by touch and keyboard.

## Accessibility & Inclusion

User requires visible keyboard focus, semantic controls, appropriate focus in dialogs, readable contrast, mobile layouts, usable touch targets and reduced motion. Restore browser zoom. Keep dates, loading, errors and missing metadata honest.
