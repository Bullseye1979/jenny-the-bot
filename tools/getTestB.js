/**********************************************************************************/
/* filename: getTestB.js                                                           *
/* Version 1.0                                                                     *
/* Purpose: Dummy test tool B. Returns a fake video URL immediately without        *
/*          calling any external API. Used to test the subagent pipeline without   *
/*          incurring video generation costs.                                      *
/**********************************************************************************/

const MODULE_NAME = "getTestB";
const DEFAULT_DELAY_MS = 30_000;


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


async function getInvoke(args) {
  await sleep(DEFAULT_DELAY_MS);
  const label = String(args?.label || "test-video").trim().replace(/[^a-z0-9_-]/gi, "_");
  const fakeUrl = `https://example.com/test/video_${label}_${Date.now()}.mp4`;

  return {
    ok: true,
    type: "video",
    url: fakeUrl,
    label,
    delayMs: DEFAULT_DELAY_MS,
    message: `Test video generated for label: ${label} (delay: ${DEFAULT_DELAY_MS}ms)`,
  };
}


export default {
  name: MODULE_NAME,
  invoke: getInvoke,
};
