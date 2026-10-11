import type { Session } from "@siteguard/contracts";
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
  if (active?.source === preferences.source) return { session: active };
  if (active) await api(`/sessions/${active.id}/complete`, {});
  return api<{ session: Session }>("/sessions", preferences);
}
