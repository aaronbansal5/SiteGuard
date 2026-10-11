# Account authentication and role separation

SiteGuard supports two explicit modes. `AUTH_MODE=demo` is a local, fictional walkthrough with a visible worker/supervisor selector; it is not account security. `AUTH_MODE=oidc` delegates login to a hosted OpenID Connect provider and authorizes accounts against the application database. Hosted deployments require OIDC and always disable `/api/demo/login`, regardless of `DEMO_MODE`.

## Recommended provider setup: Auth0 with Google login

Create an Auth0 **Regular Web Application**. Enable its Google social connection and Universal Login. Workers can sign in using Google; the application never stores passwords. Follow the provider's production Google connection setup rather than deploying shared development credentials.

Set these server-only values in `.env` or the hosting secret store:

```
AUTH_MODE=oidc
APP_ORIGIN=https://your-app.example.com
SITE_ID=your-stable-site-id
OIDC_ISSUER=https://your-tenant.auth0.com/
OIDC_CLIENT_ID=your-regular-web-client-id
OIDC_CLIENT_SECRET=your-regular-web-client-secret
COOKIE_SECRET=<random secret of at least 32 characters>
MEASUREMENT_TOKEN=<separate random internal-service credential>
```

The allowed callback URL is exactly `${APP_ORIGIN}/api/auth/callback`. For local development use `APP_ORIGIN=http://127.0.0.1:3001` and register that exact callback separately. Set the provider token endpoint authentication method to match its client settings; this implementation uses the SDK's client-secret-post authentication when a secret is supplied, and public-client authentication otherwise. No OIDC credentials enter browser assets.

The OIDC SDK performs issuer/audience/ID-token validation, state, nonce and PKCE checks. Account login requires an explicit boolean `email_verified=true` claim. The provider's returned email must continue matching the authorized account email. Provider role claims cannot grant application manager access.

## Bootstrap the first manager

Obtain the exact, verified `sub` and email from the provider's account records. Use the exact issuer value returned by its OIDC discovery document. Run the offline command with deployment configuration loaded:

```
AUTH_BOOTSTRAP_SUBJECT='verified-provider-subject' AUTH_BOOTSTRAP_EMAIL='manager@example.com' npm run auth:bootstrap
```

This is an administrator operation requiring database access. It creates a supervisor account for the configured site, and refuses to elevate an existing account. There is no public manager signup or role-setting endpoint. If the demo fixtures are needed, keep `DEMO_MODE=true`; setting it false does not create real workforce rosters automatically. Do not present fictional fixtures as a production workforce.

## Invite workers

The manager signs in and opens **Worker access**. Select an existing worker record, enter the worker's verified account email and generate the invitation. Send the invitation URL privately using your normal trusted channel; SiteGuard does not send email. Invitations expire after 24 hours. Only the matching verified email can redeem an invitation, only once. The resulting account is always a worker, linked to that worker record. New invitations invalidate previous unredeemed invitations for that worker. Disabled managers' invitations cannot be redeemed.

## Sessions and authorization

Sessions use 256-bit opaque secrets in an HttpOnly SameSite=Lax cookie, Secure when hosted. Only SHA-256 digests are persisted. Sessions expire after eight hours; logout deletes the server record, so cookie replay cannot restore access. Local demo cookies also reference revocable database sessions. Account disabled state, deployment site membership and linked worker existence are checked on every request; open streams recheck every five seconds.

The database is permanently bound to one `SITE_ID` when OIDC starts. All operational records belong to that one deployment. Changing `SITE_ID` with the same database is refused. This is **single-site deployment isolation**, not a multitenant implementation.

Worker reads are restricted to their own records. Manager physiological access still requires session-specific sharing consent. Account login does not authenticate through camera measurement, and consent is not required to request help.

Authenticated browser writes require the configured Origin and JSON. Native requests use an opaque bearer session. Internal sensor ingestion uses its separate measurement credential.

To disable an account and revoke all its sessions:

```
AUTH_ACCOUNT_ID='account-uuid' npm run auth:disable
```

There is no automatic account reactivation or manager elevation UI; coordinate administrator account changes through reviewed database operations.

## iPhone handoff

The SwiftUI client uses `ASWebAuthenticationSession` to open `/api/auth/mobile/start?challenge=<S256 challenge>`. The native app retains the random verifier; the server completes normal provider login and redirects only to `siteguard-worker://auth?code=<opaque code>`. No arbitrary callback URL is accepted. `/api/auth/mobile/exchange` accepts the code and verifier, verifies the challenge and consumes the two-minute code once. It returns the existing eight-hour application session token, stored in the app's Keychain and sent as `Authorization: Bearer ...`. Logout revokes the same persisted session. The provider client secret and provider tokens stay on the server.

The native worker UI refuses supervisor sessions. The backend continues authorizing the account's actual role, rather than trusting client UI. Native camera measurement remains a separate SDK integration gate.

## Verification and limits

Automated tests cover real OpenID client protocol behavior with signed RSA ID-token fixtures and HTTPS provider fetch stubs, invitation redemption, verified email, state/nonce failures, ignored role claims, logout/replay, site isolation and permissions. These fixtures do not establish a live Auth0/Google login. Creating provider credentials, registering callbacks and observing a real login are outstanding external setup steps.

Provider logout is not performed: application logout revokes SiteGuard access, while the browser may remain signed into Google/Auth0. The next sign-in may reuse that provider session. Deploy one API instance as documented until measurement ownership and quotas support distributed instances.
