import { useState } from "react";
import type { Worker } from "@siteguard/contracts";
import { useIdentity } from "../App";
import { api, useAction, useResource } from "../lib/api";
import { ErrorNotice } from "./ui";
export function InvitationsPanel() {
  const { config } = useIdentity();
  return config?.mode === "oidc" ? <AccountInvitations /> : null;
}
function AccountInvitations() {
  const workers = useResource<{ workers: Worker[] }>("/workers");
  const invitations = useResource<{
    invitations: {
      id: string;
      email: string;
      workerId: string;
      expiresAt: string;
      redeemedAt: string | null;
    }[];
  }>("/auth/invitations");
  const action = useAction();
  const [email, setEmail] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  return (
    <section className="card">
      <h2>Invite worker accounts</h2>
      <p>
        Link a verified account to an existing worker. Invitations expire after
        24 hours and assign worker access only.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const result = await api<{ inviteUrl: string }>(
              "/auth/invitations",
              { email: email.trim(), workerId },
            );
            setInviteUrl(result.inviteUrl);
            await invitations.refresh();
          });
        }}
      >
        <label>
          Worker email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setInviteUrl("");
            }}
          />
        </label>
        <label>
          Worker
          <select
            required
            value={workerId}
            onChange={(e) => {
              setWorkerId(e.target.value);
              setInviteUrl("");
            }}
          >
            <option value="">Select worker</option>
            {workers.data?.workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.displayName}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          disabled={action.busy || !workers.data}
        >
          {action.busy ? "Creating invitation…" : "Create worker invitation"}
        </button>
      </form>
      <ErrorNotice
        message={action.error || workers.error || invitations.error}
      />
      {inviteUrl && (
        <div className="notice">
          <div>
            <strong>Invitation created</strong>
            <p>
              Share this private, one-use link with the intended worker. No
              email has been sent.
            </p>
            <label>
              Invitation link
              <input
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.target.select()}
              />
            </label>
          </div>
        </div>
      )}
      {invitations.data && (
        <ul>
          {invitations.data.invitations.map((invite) => (
            <li key={invite.id}>
              {invite.email} ·{" "}
              {invite.redeemedAt
                ? "Accepted"
                : Date.parse(invite.expiresAt) < Date.now()
                  ? "Expired"
                  : "Pending"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
