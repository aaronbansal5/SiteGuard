# Supabase authentication

Supabase handles email/password identity, signup, confirmation and password reset.
SiteGuard continues storing worker profiles, role assignments, hashed app sessions,
notes, measurements and incidents in Tiger Data. The application never stores
passwords or Supabase refresh tokens. No Supabase database tables or storage buckets
are used by SiteGuard.

## Local configuration

Put these values in the ignored root `.env`:

```dotenv
AUTH_MODE=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_ADMIN_EMAIL=your-admin-email@example.com
APP_ORIGIN=http://127.0.0.1:3001
```

Existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values are accepted
as compatibility aliases. The SDK runs on the backend, so the frontend does not
need provider credentials. Do not use a Supabase service-role/secret key here.
Keep the existing `DATABASE_URL`, `COOKIE_SECRET` and `MEASUREMENT_TOKEN`.

In Supabase **Authentication → URL Configuration**, set Site URL to the same
`APP_ORIGIN` and allow redirects to `http://127.0.0.1:3001/login**` for this local
setup. Use your HTTPS public origin instead when deployed. Enable the email
provider under Authentication. Keep email confirmation enabled; configure SMTP
for real workloads because provider email limits also affect signup/reset.

Run `npm run build` then `npm run start`. Open `http://127.0.0.1:3001` and use
**Create an account**. Email addresses serve as usernames. Confirm the emailed
link before signing in. For Vite development on port 5173, set `APP_ORIGIN` to
`http://127.0.0.1:5173` and add that origin's login redirect to Supabase as well.
Only configured origins may submit authenticated browser writes. Alternatively,
keep the primary origin on port 3001 and set
`AUTH_ADDITIONAL_ORIGINS=http://127.0.0.1:5173` to explicitly trust the Vite
frontend too; confirmation emails still return to the primary origin.

## Worker and admin accounts

Create the admin email account and choose its password through the signup form
(or create a confirmed account in Supabase Authentication → Users). Only the
server-configured `SUPABASE_ADMIN_EMAIL`, verified by Supabase, receives admin
access. All other verified accounts create a dedicated worker profile. Existing
worker accounts matching the configured admin email are elevated on next login,
audited, and their old sessions revoked. Existing role assignments are otherwise
preserved; changing the configured email does not silently revoke previously
assigned admins. Use `npm run auth:disable` to disable an existing app account.

Do not add role selectors to signup or trust user-editable Supabase metadata for
privileges. The client cannot choose a worker ID or impersonate one of the seeded
fictional workers. A team may use one worker email/password and a separate admin
email/password for its demonstration; real deployments should use individual
accounts.

Browser entry routes are `/login` and `/signup`. Sessions use an HttpOnly,
SameSite=Lax cookie (Secure when hosted) and an eight-hour app session stored only
as a digest. Password authentication is reverified with Supabase at sign-in;
existing app sessions are validated against server-owned records on every request.
Logout revokes the current app session. Password reset revokes all app sessions
for that Supabase identity. Provider-only account deletion/revocation is not pushed
to SiteGuard automatically: disable the app account for immediate revocation, or
wait for its app session to expire. Supabase provider sessions are never used as
an unverified authorization source.

Workers cannot access manager APIs even by navigating directly to `/supervisor`.
Camera/feed sharing and scene notes retain their existing app permissions. Auth
does not change camera consent, measurement sources, protected scheduling or
assistance handling.

## Verification

`npm run typecheck`, `npm run test`, `npm run build`, and `npm run test:e2e`.
Supabase auth tests mock only provider responses and exercise real app session,
role, persistence, validation and logout logic. Browser tests mock account
responses and cover login/signup/reset and role navigation. Live verification
requires creating confirmed accounts and signing in; a successful settings
request alone does not establish successful live password authentication.

The implementation follows Supabase's [email/password authentication](https://supabase.com/docs/guides/auth/passwords),
[server-verified getUser](https://supabase.com/docs/reference/javascript/auth-getuser),
and [password-reset flow](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).
