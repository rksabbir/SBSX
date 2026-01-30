export async function onRequest() {
  try {
    // আসল JS path (এটা DevTools এ দেখা যাবে না)
    const hiddenPath =
      "https://sbsx.pages.dev/SbmxIntegratedjettheme/js@0.5.9/main.js";

    const res = await fetch(hiddenPath, {
      cf: { cacheTtl: 86400 }
    });

    const code = await res.text();

    return new Response(code, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch (e) {
    return new Response(
      'console.error("SBMX loader failed");',
      { headers: { "Content-Type": "application/javascript" } }
    );
  }
}
