# SiteGuard AdaptiveBreak

Contactless recovery visibility and safety-conscious break planning for physically demanding worksites.

## Product

A worker voluntarily checks in during a protected break, observes pulse and breathing measurements, reviews descriptive changes, reports symptoms, and requests additional rest or human assistance. A supervisor coordinates staffing without shortening required breaks or treating measurements as medical clearance.
Judge-facing distinction: one connected workflow, camera observations → transparent history → worker request → protected staffing adjustment. Presage supplies contactless observations; SiteGuard supplies understandable records and operational context.

## Boundaries

No diagnosis, fatigue/risk score, accident prediction, medically optimal break duration, or fitness-for-work decision. Measurement failure implies neither safety nor danger. Example breaks are fictional site policy, not legal/medical guidance. No facial identification or storage of camera images/video. Verify Presage processing and telemetry separately before real use.

## Architecture and ownership

npm workspaces: apps/web, apps/api, packages/contracts, packages/mock-data. React/TypeScript/Vite, Tailwind, Recharts, Fastify, Zod. SQLite local default; PostgreSQL/Tiger Data explicit alternative. Gemini optional/server-side. Presage independently owned native local bridge. Production API serves web build; Vite proxies /api in development. No automatic database/source fallback.
Developer 1 owns app/contracts/fixtures/specs/root configuration. Developer 2 owns native bridge. Developer 3 owns deployment/CI. Developer 4 owns integration testing/demo/presentation. Coordinate edits; native bridge keeps its own lockfile.

## Screens and journey

Landing with worker/supervisor entry; worker home and selection; consent/context/source choice; stationary measurement with source, quality, connection, charts and stop; descriptive summary and comparison; source-labeled history; supervisor requests, protected timeline, staffing proposals and explicit actions. Assistance and symptoms remain available without measurement consent and during failure.

## Design

Slate/navy and restrained teal; amber pending requests. No recovery/safety score. Tablet-friendly controls, keyboard focus, reduced motion, readable chart text. Supervisor overview omits physiological history; session sharing requires worker consent. Source labels accompany all readings/history/summaries.

## Analytics

Metric-independent: quality=valid and non-null. Initial window: the 15 seconds starting at that metric's first valid reading (vendor warm-up differs per metric; pulse and breathing are anchored separately); final last 15 seconds. Duration >=45 seconds measured from that first valid reading; five readings spanning five seconds per window; no overlapping windows. Recommended check-in length: real Presage 90 seconds (positioning and warm-up come first); mock 60 seconds (synthetic, valid from the first reading, so its windows equal the first/last 15 seconds). Medians; delta=final-initial. Otherwise insufficient_data. These are data-sufficiency rules, not clinical thresholds.
Historical: most recent five eligible completed prior sessions within 30 days; same worker/source/workload/temperature band (<20, 20-<30, >=30 Celsius); at least three per metric. Missing context prevents comparison. Bands are coarse context groups, not safety thresholds. Never mix synthetic/real history; no causal inference.

## Protected scheduling

Protected intervals cannot move/shrink. Approval creates separate additional rest. Pending/acknowledged additional rest and unresolved assistance block assignments from request time; approved rest blocks its interval. Assistance acknowledgment does not resolve it. Half-open intervals [start,end). Reject worker overlaps, break/rest/request conflicts, unavailable workers, task/skill mismatch. Preserve valid assignment portions; scan uncovered intervals chronologically; choose qualified available workers by fewest assigned minutes then ID. Gaps remain explicit. Transactional revision-checked commit never resolves requests or modifies breaks.

## Demo and acceptance

Six fictional workers, two tasks, staggered protected breaks, source-labeled synthetic history seeded relative to demo startup. Run 60-second mock check-in, descriptive summary/history, rest request, supervisor approval and coverage adjustment. Demonstrate symptoms independent of vitals. Real Presage starts a separate session and cannot compare with mock history. Gemini optional; deterministic facts always available.
Persistent restart/reset; tested API contracts; no credentials for mock; no frontend secrets; source honesty; protected breaks/unresolved assistance retained; external failures explicit. Hosted demo fictional only; real measurements local by default. Demo role selection is not production authentication.

## Account login

The configured app now uses Supabase for email/password signup, confirmation and
password recovery. Login is the entry page; users do not select their privilege
level. A verified server-configured admin email grants supervisor access; other
new accounts get their own worker profiles. App roles and hashed, revocable app
sessions remain in Tiger Data. Demo role selection is explicit rehearsal mode
only. The existing native iPhone OIDC handoff is not a Supabase login flow; its
future adapter must exchange a verified Supabase identity before receiving an
app session. The phone web experience uses the same login as the desktop app.
