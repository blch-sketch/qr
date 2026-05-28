// Cloudflare Worker: CORS proxy for Честный ЗНАК consumer check API
// Deploy: paste this code at dash.cloudflare.com → Workers → Create
// or use `wrangler deploy` (npm install -g wrangler)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CRPT_BASE = "https://mobile.api.crptech.ru/api/v3/check";

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const { searchParams } = new URL(request.url);
    const cis = searchParams.get("cis");

    if (!cis) {
      return json({ error: "cis parameter is required" }, 400);
    }

    const apiUrl = `${CRPT_BASE}?cis=${encodeURIComponent(cis)}`;

    let response;
    try {
      response = await fetch(apiUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(9000),
      });
    } catch (err) {
      return json({ error: "upstream_timeout", message: err.message }, 504);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return json({ error: "upstream_parse_error" }, 502);
    }

    return json(data, response.status);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
