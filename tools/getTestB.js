/**********************************************************************************/
/* filename: getTestB.js                                                           *
/* Version 1.0                                                                     *
/* Purpose: Dummy test tool B. Returns a fake video URL immediately without        *
/*          calling any external API. Used to test the subagent pipeline without   *
/*          incurring video generation costs.                                      *
/**********************************************************************************/

const MODULE_NAME = "getTestB";


async function getInvoke(args) {
  const label = String(args?.label || "test-video").trim().replace(/[^a-z0-9_-]/gi, "_");
  const fakeUrl = `https://example.com/test/video_${label}_${Date.now()}.mp4`;

  return {
    ok: true,
    type: "video",
    url: fakeUrl,
    label,
    message: `Test video generated for label: ${label}`,
  };
}


export default {
  name: MODULE_NAME,
  invoke: getInvoke,
};
