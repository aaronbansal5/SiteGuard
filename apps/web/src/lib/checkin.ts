import {
  RECOMMENDED_CHECK_IN_SECONDS,
  type Session,
} from "@siteguard/contracts";
import { api } from "./api";

type Preferences = Pick<
  Session,
  "source" | "consentVersion" | "shareWithSupervisor" | "context"
> & { input?: "camera" | "custom"; onDemand?: boolean };

type PreferencesWithOptionalBreak = Omit<Preferences, "breakId"> & {
  breakId?: Session["breakId"];
};

/** Called only by an explicit worker start/switch action. Never mix sources. */
export async function startOrResumeCheckIn(
  workerId: string,
  preferences: PreferencesWithOptionalBreak,
) {
  const history = await api<{ sessions: Session[] }>(
    `/workers/${workerId}/history?limit=20`,
  );
  const active = history.sessions.find(
    (session) => session.status === "active",
  );
  // A fresh camera action may change native/custom input. Source alone cannot
  // attest that the old bridge capture still exists or uses the chosen input.
  if (
    active?.source === "mock" &&
    preferences.source === "mock" &&
    !active.interruption &&
    Date.now() - Date.parse(active.startedAt) <
      RECOMMENDED_CHECK_IN_SECONDS.mock * 1000
  )
    return { session: active };
  if (active) await api(`/sessions/${active.id}/complete`, {});
  return api<{ session: Session }>("/sessions", preferences);
}
