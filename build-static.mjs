import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.join(projectRoot, "dist");
await rm(distRoot, { recursive: true, force: true });
const html = await readFile(
  path.join(projectRoot, "public", "ruta-v2.html"),
  "utf8",
);
const cameraData = await readFile(
  path.join(projectRoot, "public", "data", "rm-camera-locations.json"),
  "utf8",
);
const notificationWorker = await readFile(
  path.join(projectRoot, "public", "clarify-sw.js"),
  "utf8",
);
const htmlBase64 = Buffer.from(html, "utf8").toString("base64");
const cameraDataBase64 = Buffer.from(cameraData, "utf8").toString("base64");
const notificationWorkerBase64 = Buffer.from(notificationWorker, "utf8").toString("base64");
const worker = `const htmlBase64 = ${JSON.stringify(htmlBase64)};
const cameraDataBase64 = ${JSON.stringify(cameraDataBase64)};
const notificationWorkerBase64 = ${JSON.stringify(notificationWorkerBase64)};

function decodeText(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const html = decodeText(htmlBase64);
const cameraData = decodeText(cameraDataBase64);
const notificationWorker = decodeText(notificationWorkerBase64);
const OFFICIAL_FUEL_STATIONS_URL = "https://api.bencinaenlinea.cl/api/busqueda_estacion_filtro";
const OFFICIAL_FUEL_BRANDS_URL = "https://api.bencinaenlinea.cl/api/marca_ciudadano";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/mapbox-token") {
      const token = env.MAPBOX_PUBLIC_TOKEN;
      return Response.json(
        { token: token?.startsWith("pk.") ? token : null },
        {
          status: token?.startsWith("pk.") ? 200 : 503,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }

    if (url.pathname === "/api/fuel-stations") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Método no permitido", { status: 405 });
      try {
        const [stationResponse, brandResponse] = await Promise.all([
          fetch(OFFICIAL_FUEL_STATIONS_URL, { headers: { Accept: "application/json" } }),
          fetch(OFFICIAL_FUEL_BRANDS_URL, { headers: { Accept: "application/json" } }),
        ]);
        if (!stationResponse.ok || !brandResponse.ok) throw new Error("Fuente CNE no disponible");
        const [stationPayload, brandPayload] = await Promise.all([stationResponse.json(), brandResponse.json()]);
        const brands = Object.fromEntries((brandPayload.data || []).map((brand) => [String(brand.id), { nombre: brand.nombre }]));
        const stations = (stationPayload.data || []).filter((station) => station.gasolinera_bandera).map((station) => ({
          id: station.id, marca: station.marca, direccion: station.direccion, latitud: station.latitud, longitud: station.longitud, region: station.region, comuna: station.comuna, gasolinera_bandera: 1,
          combustibles: (station.combustibles || []).map((fuel) => ({ nombre_corto: fuel.nombre_corto, nombre_largo: fuel.nombre_largo, precio: fuel.precio, unidad_cobro: fuel.unidad_cobro, actualizado: fuel.actualizado, precio_fecha: fuel.precio_fecha })),
        }));
        const body = JSON.stringify({ source: "Bencina en Línea · Comisión Nacional de Energía", retrievedAt: new Date().toISOString(), stations, brands });
        return new Response(request.method === "HEAD" ? null : body, { headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=3600", "Content-Type": "application/json; charset=utf-8" } });
      } catch {
        return Response.json({ error: "No fue posible consultar Bencina en Línea" }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }

    if (url.pathname === "/" || url.pathname === "/ruta-v2.html") {
      return new Response(request.method === "HEAD" ? null : html, {
        headers: {
          "Cache-Control": "private, no-cache",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }

    if (url.pathname === "/data/rm-camera-locations.json") {
      return new Response(request.method === "HEAD" ? null : cameraData, {
        headers: {
          "Cache-Control": "public, max-age=86400",
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    if (url.pathname === "/clarify-sw.js") {
      return new Response(request.method === "HEAD" ? null : notificationWorker, {
        headers: {
          "Cache-Control": "no-cache",
          "Content-Type": "application/javascript; charset=utf-8",
          "Service-Worker-Allowed": "/",
        },
      });
    }

    if (url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    return new Response("No encontrado", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
`;

await mkdir(path.join(distRoot, "server"), { recursive: true });
await mkdir(path.join(distRoot, ".openai"), { recursive: true });
await writeFile(path.join(distRoot, "server", "index.js"), worker);
await writeFile(
  path.join(distRoot, ".openai", "hosting.json"),
  await readFile(path.join(projectRoot, ".openai", "hosting.json")),
);

console.log("Static Sites build complete.");
