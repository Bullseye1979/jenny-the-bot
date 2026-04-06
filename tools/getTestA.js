/**********************************************************************************/
/* filename: getTestA.js                                                           *
/* Version 1.0                                                                     *
/* Purpose: Dummy test tool A. Returns a fake image URL immediately without        *
/*          calling any external API. Used to test the subagent pipeline without   *
/*          incurring image generation costs.                                      *
/**********************************************************************************/

const MODULE_NAME = "getTestA";


async function getInvoke(args) {
  const label = String(args?.label || "test-image").trim().replace(/[^a-z0-9_-]/gi, "_");
  const fakeUrl = `https://example.com/test/image_${label}_${Date.now()}.png`;

  return {
    ok: true,
    type: "image",
    url: fakeUrl,
    label,
    message: `Test image generated for label: ${label}`,
  };
}


export default {
  name: MODULE_NAME,
  invoke: getInvoke,
};
