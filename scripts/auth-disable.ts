import { loadConfig } from "../apps/api/src/config.js";
import { openRepository } from "../apps/api/src/db/repository.js";
import { z } from "zod";
const c = loadConfig();
const id = z.uuid().parse(process.env.AUTH_ACCOUNT_ID);
const r = await openRepository(c);
try {
  await r.transaction(async (tx) => {
    const rows = await tx.driver.query(
      "SELECT id FROM auth_accounts WHERE id=$1 AND site_id=$2",
      [id, c.siteId],
    );
    if (!rows.length)
      throw new Error("Account not found in this deployment site");
    await tx.driver.query("UPDATE auth_accounts SET disabled=1 WHERE id=$1", [
      id,
    ]);
    await tx.driver.query("DELETE FROM auth_sessions WHERE account_id=$1", [
      id,
    ]);
  });
  console.log("Account disabled and all sessions revoked");
} finally {
  await r.close();
}
