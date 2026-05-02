/**************************************************************/
/* filename: "00047-cron-subchannel-gc.js"                 */
/* Version 1.0                                               */
/* Purpose: Deletes expired subchannel context records.     */
/**************************************************************/

import { getDb } from "../shared/webpage/interface.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "cron-subchannel-gc";


export default async function getCronSubchannelGc(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "subchannel-gc" && wo?.cronId !== "subchannel-gc") return coreData;

  const log = getPrefixedLogger(wo, import.meta.url);

  try {
    const pool = await getDb(coreData);
    const [res] = await pool.execute(
      "DELETE FROM context WHERE subchannel IS NOT NULL AND eol_ts IS NOT NULL AND eol_ts <= NOW()"
    );

    log("Expired subchannel context records removed", "info", {
      moduleName: MODULE_NAME,
      recordsDeleted: Number(res?.affectedRows || 0)
    });
  } catch (e) {
    log("Expired subchannel context cleanup failed", "error", {
      moduleName: MODULE_NAME,
      reason: String(e?.message || e)
    });
  }

  return coreData;
}