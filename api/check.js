// Vercel Serverless Function: CORS proxy for Честный ЗНАК consumer check API
// Deployed automatically when you connect this repo to Vercel (vercel.com → sign in with GitHub)

const CRPT_API = "https://mobile.api.crptech.ru/api/v3/check";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const { cis } = req.query;
  if (!cis) {
    return res.status(400).json({ error: "cis parameter is required" });
  }

  let upstream;
  try {
    upstream = await fetch(`${CRPT_API}?cis=${encodeURIComponent(cis)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
  } catch (err) {
    return res.status(504).json({ error: "upstream_timeout", message: err.message });
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return res.status(502).json({ error: "upstream_parse_error" });
  }

  return res.status(upstream.status).json(data);
}
