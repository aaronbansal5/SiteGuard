# SiteGuard API v1

Same-origin JSON /api. UTC ISO timestamps, UUID IDs, minutes and Celsius. Authoritative runtime schemas: packages/contracts/src. Strict writes; server timestamps. Role-scoped signed HttpOnly SameSite cookie; Secure hosted. Demo login is not production authentication. Signed cookies expire server-side after 24 hours. Worker owns records; supervisor needs session sharing consent for physiological summaries. Ingest internal-only bearer token.

## Models

Worker(id,displayName,skills). Session(id,workerId,breakId,source,status,startedAt,endedAt,context,consentVersion,shareWithSupervisor,interruption). Reading envelope(sequence,reading). Reading(timestamp,heartRateBpm|null,respiratoryRateBrpm|null,quality,source). Break(id,workerId,startsAt,endsAt,kind,policyLabel,revision,requestId|null). Assignment(id,taskId,workerId,startsAt,endsAt). Request(id,workerId,sessionId|null,kind,requestedMinutes|null,status,createdAt,restStartsAt|null,restEndsAt|null,revision,note|null). Symptom(id,workerId,sessionId|null,codes,note|null,createdAt,assistanceRequestId).
SupervisorView(workerId,generatedAt,breaks,assignments,tasks,availability,requests,symptomReports,sharedSessions:SharedSessionRef(id,source,status,startedAt,endedAt|null,linkedToRequest)[]).
SelfReport(sessionId,workerId,tiredness:1..5,origin:worker|synthetic,createdAt). PersonalInsights(sessionId,source,experimental:true,synthetic,pulse,breathing,tiredness,selfReport|null,limitations); pulse/breathing={baseline:Baseline(status,reason|null,priorCount,requiredCount,current|null,usualMedian|null,usualMad|null,robustZ|null,classification:within_usual|settled_less|settled_more|null),trend:Trend(status,reason|null,count,requiredCount,slopePerSession|null,direction:steady|settling_more|settling_less|null)}; tiredness=TirednessEstimate(status,reason:current_session_unavailable|not_enough_labeled_sessions|ratings_do_not_vary|estimate_not_reliable|null,labeledCount,requiredCount,looMae|null,maeBound,estimate|null,rangeLow|null,rangeHigh|null,includesSyntheticReports). PersonalTrend(source,experimental:true,synthetic,pulse:Trend,breathing:Trend,limitations). Models, constants and limits: docs/RECOVERY_MODEL.md.
MetricSummary(status,initialMedian|null,finalMedian|null,delta|null,initialCount,finalCount). Comparison(status,count,historicalMedianDelta|null). Summary(sessionId,source,context,durationSeconds,pulse,breathing,pulseComparison,breathingComparison,limitations).

## Endpoints

POST /demo/login {role:worker,workerId} or {role:supervisor} → {role,workerId?}, cookie.
GET /demo/me → current identity (401 before login).
GET /health → {status,database,measurementSources,insightsMode}.
GET /workers → {workers} (public fictional roster).
POST /sessions {breakId,source,consentVersion:v1,shareWithSupervisor,context:{workload,temperatureC}} → 201 {session}. Worker owner, current break, one active session.
GET /sessions/:id → {session}.
GET /sessions/:id/events → persisted reading/status/error SSE; last-event-id replay.
POST /sessions/:id/readings {readings:ReadingEnvelope[]} → {accepted,duplicates}. Internal bearer, max100, whole-batch validation, source fixed, timestamps within session/receipt. Identical replay deduplicated; changed payload 409. Completed session disallows writes.
GET /sessions/:id/readings → {readings}.
POST /sessions/:id/complete {} → {session,summary}; idempotent, stops source first.
GET /sessions/:id/summary → {summary}.
GET /workers/:id/history?limit=20&before=cursor → {sessions:[Session & {summary}],nextCursor}; worker-only history.
GET /sessions/:id/personal-insights → {insights:PersonalInsights}. Owning worker only; supervisors 403 even with sharing consent. Experimental, same-source own history only; explicit insufficient_data states.
POST /sessions/:id/self-report {tiredness:1..5|null} → {selfReport:SelfReport|null}. Owning worker only, completed session only (409 otherwise); null removes. Voluntary; never used for scheduling, approvals or supervisor views.
GET /workers/:id/personal-trend?source=mock|presage → {trend:PersonalTrend}. Worker self only; source required (400 otherwise).
PATCH /sessions/:id/sharing {shareWithSupervisor:false} → {session}. Owning worker only; withdraws supervisor access to that session's readings, summary, events and explanation (granting is only possible at consent). Idempotent; audited with actor worker. Requests, symptom reports, breaks and staffing blocks are unchanged. Open supervisor event streams end at the next heartbeat (≤5 s) with error SHARING_WITHDRAWN.
GET /workers/:id/supervisor-view → {view:SupervisorView}. Worker self only (supervisors 403). The records about this worker that GET /supervisor/overview returns (breaks, assignments, referenced tasks, availability, requests, symptom reports) plus every session the worker currently shares (id, source, status, times, linkedToRequest). No readings, summaries, personal insights or self-reports.
POST /symptom-reports {sessionId:null|UUID,codes:nonempty array,note:null|string} → 201 {report,request}. Atomic report/assistance linkage, no session required.
POST /rest-requests {sessionId:null|UUID,kind,requestedMinutes:null|integer} → 201 {request}. Additional rest 1..120; assistance null. Input bounds are not medical recommendations.
GET /rest-requests → own worker requests or supervisor list.
PATCH /rest-requests/:id {action:acknowledge|approve|resolve|decline,revision,note,restStartsAt?,restEndsAt?} → {request,scheduleRevision}. Supervisor. Assistance acknowledge/resolve only. Approval creates rest >=requested minutes; no protected changes. Explicit note required. Acknowledgment retains block. Audit every action; stale revisions 409.
GET /supervisor/overview → {workers,breaks,requests,assignments,tasks,availability,symptomReports,sharedSessionIds,coverageGaps,scheduleRevision}. No physiological histories, personal insights or self-reports.
GET /breaks → {breaks,scheduleRevision}; workers see own.
PATCH /breaks/:id {startsAt,endsAt,revision} → {break,scheduleRevision}. Supervisor, additional only, duration cannot shrink below approved duration; protected 409.
POST /schedule/preview {} → {baseRevision,assignments,coverageGaps}.
POST /schedule/commit {baseRevision,assignments} → {scheduleRevision,assignments,coverageGaps,auditEventId}; transactional constraints; gaps explicit.
POST /insights/explain {kind:session,sessionId} or {kind:schedule,auditEventId} → {origin:gemini|deterministic,observations,limitations}. Server fetches facts; no raw vitals/names/symptom notes/footage sent.
POST /demo/reset {} → {reset:true}; supervisor local demo only, disabled hosted/non-demo.

## Errors and sample

{error:{code,message,fieldErrors?,requestId}}. 400 validation,401 identity,403 access,404 missing,409 state/constraints/revision,503 dependency; 429 bounded login/write/stream quotas. No secrets/internals.
Example reading: {"timestamp":"2026-10-10T15:00:01.000Z","heartRateBpm":104,"respiratoryRateBrpm":21,"quality":"valid","source":"mock"}. Demo protected break15min, session60sec, additional rest5min: fictional fixtures, not safety guidance.

## Resource limits

Demo login:30 requests/minute/IP; other writes:120/minute/IP. SSE:6 streams/identity,12/worker,64/process; quotas release on close. Heartbeats revalidate signed identity expiry every5seconds without stopping the underlying measurement source. Native-source transport status is configured/unverified until a successful bridge check-in. Limits are process-local; production ingress/shared quotas require separate deployment validation.
