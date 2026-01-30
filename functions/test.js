export async function onRequest() {
  try {
    // hidden original JS
    const hiddenURL =
      "https://sbsx.pages.dev/SbmxIntegratedjettheme/js@0.5.9/main.js";

    // Fetch original JS
    const res = await fetch(hiddenURL);
    const code = await res.text();

    // Serve JS to browser via /app.js
    return new Response(code, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch (err) {
    return new Response(
      'console.error("Failed to load SBMX JS");',
      { headers: { "Content-Type": "application/javascript" } }
    );
  }
}
