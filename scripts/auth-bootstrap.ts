import { loadConfig } from "../apps/api/src/config.js";
import { openRepository } from "../apps/api/src/db/repository.js";
import { bootstrapManager } from "../apps/api/src/auth-service.js";
const c = loadConfig();
if (c.authMode !== "oidc")
  throw new Error("Set AUTH_MODE=oidc before bootstrapping accounts");
const subject = process.env.AUTH_BOOTSTRAP_SUBJECT,
  email = process.env.AUTH_BOOTSTRAP_EMAIL;
if (!subject || !email)
  throw new Error(
    "Set AUTH_BOOTSTRAP_SUBJECT and AUTH_BOOTSTRAP_EMAIL from verified provider account records",
  );
const r = await openRepository(c);
try {
  const id = await bootstrapManager(r, {
    issuer: c.oidcIssuer!,
    subject,
    email,
    siteId: c.siteId,
  });
  console.log(`Manager account created: ${id} for site ${c.siteId}`);
} finally {
  await r.close();
}
