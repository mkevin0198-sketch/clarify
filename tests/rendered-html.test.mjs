import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectSourceUrl = new URL("../public/ruta-v2.html", import.meta.url);
const packagedSourceUrl = new URL("./ruta-v2.html", import.meta.url);
const sourceUrl = existsSync(fileURLToPath(projectSourceUrl))
  ? projectSourceUrl
  : packagedSourceUrl;
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
const workerAvailable = existsSync(fileURLToPath(workerUrl));
const buildSourceUrl = new URL("../build-static.mjs", import.meta.url);
const buildSourceAvailable = existsSync(fileURLToPath(buildSourceUrl));
const notificationWorkerUrl = new URL("../public/clarify-sw.js", import.meta.url);
const bluetoothReceiverUrl = new URL("../android-app/app/src/main/java/cl/clarify/app/BluetoothConnectionReceiver.java", import.meta.url);
const bluetoothPrefsUrl = new URL("../android-app/app/src/main/java/cl/clarify/app/BluetoothPrefs.java", import.meta.url);
const mainActivityUrl = new URL("../android-app/app/src/main/java/cl/clarify/app/MainActivity.java", import.meta.url);
const androidManifestUrl = new URL("../android-app/app/src/main/AndroidManifest.xml", import.meta.url);

async function render() {
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const source = await readFile(sourceUrl, "utf8");

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          return url.pathname === "/ruta-v2.html"
            ? new Response(source, {
                status: 200,
                headers: { "content-type": "text/html; charset=utf-8" },
              })
            : new Response("Not found", { status: 404 });
        },
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function readTolls(html) {
  const match = html.match(
    /const TOLL_DATA=(\[.*?\]);\s*const SANTIAGO/s,
  );
  assert.ok(match, "TOLL_DATA debe existir en la aplicación");
  return Function(`"use strict"; return (${match[1]});`)();
}

function coordinateIssues(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    return ["debe tener exactamente 2 valores"];
  }
  if (!value.every(Number.isFinite)) {
    return ["contiene valores no numéricos"];
  }

  const [latitude, longitude] = value;
  const issues = [];
  if (latitude < -90 || latitude > 90) issues.push("latitud fuera de rango");
  if (longitude < -180 || longitude > 180) {
    issues.push("longitud fuera de rango");
  }
  return issues;
}

test("permite eliminar un viaje o todo el historial con confirmación", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /id="deleteAllTrips"[^>]*>Eliminar todos</);
  assert.match(html, /id="tripDeleteModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="tripDeleteCancel"/);
  assert.match(html, /id="tripDeleteConfirm"/);
  assert.match(html, /id="deleteOpenTrip"/);
  assert.match(html, /openTripDeleteModal\(deleteTripButton\.dataset\.deleteTrip\)/);
  assert.match(html, /openTripDeleteModal\(openHistoryTripId\)/);
  assert.match(html, /bindElementEvent\("#deleteAllTrips","click",\(\)=>openTripDeleteModal\(\)\)/);
  assert.match(html, /bindElementEvent\("#tripDeleteConfirm","click",confirmTripDeletion\)/);
  assert.match(html, /classList\.toggle\("hidden",!trips\.length\)/);

  const match = html.match(
    /function tripsAfterDeletion\(trips,pending\)\{.*?return trips\}/s,
  );
  assert.ok(match, "la eliminación debe conservarse como una transformación comprobable");
  const tripsAfterDeletion = Function(
    "tripRecordId",
    `"use strict"; ${match[0]}; return tripsAfterDeletion;`,
  )((trip) => String(trip?.id ?? trip?.date ?? ""));
  const trips = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(tripsAfterDeletion(trips, { type: "one", id: "b" }), [
    { id: "a" },
    { id: "c" },
  ]);
  assert.deepEqual(tripsAfterDeletion(trips, { type: "all" }), []);
  assert.deepEqual(tripsAfterDeletion(trips, null), trips);
  assert.equal(trips.length, 3, "el cálculo no debe mutar el historial original");
});

test("presenta historial visual, detalle con mapa y análisis deslizable", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /<h1>Historial de viajes<\/h1>/);
  assert.match(html, /id="tripMonthFilter"/);
  assert.match(html, /id="tripMonthModal"[^>]*role="dialog"/);
  assert.match(html, /id="historyAnalysisCarousel"/);
  assert.equal([...html.matchAll(/data-analysis-slide="[0-3]"/g)].length, 4);
  assert.match(html, /scroll-snap-type:x mandatory/);
  assert.match(html, /class="history-donut"/);
  assert.match(html, /id="tripHistoryDetail"/);
  assert.match(html, /id="tripHistoryMap"/);
  assert.match(html, /id="tripDetailLiters"/);
  assert.match(html, /id="tripDetailTagCount"/);
  assert.match(html, /data-trip-open="\$\{id\}"/);
  assert.match(html, /new mapboxgl\.Map\(\{container:"tripHistoryMap"/);
  assert.match(html, /addSource\("trip-track"/);
  assert.match(html, /fitBounds\(bounds,\{padding:28,duration:0\}\)/);
  assert.match(html, /id="historyAnalysisDetail"/);
  assert.match(html, /function historyActivityAnalysisHTML/);
  assert.match(html, /tollBreakdown=tollItems\.map/);

  const statsMatch = html.match(
    /function tripHistoryStats\(trips\)\{.*?return totals\}/s,
  );
  assert.ok(statsMatch, "el análisis debe calcularse desde los viajes reales");
  const tripHistoryStats = Function(`${statsMatch[0]}; return tripHistoryStats;`)();
  const stats = tripHistoryStats([
    {
      date: "2026-08-03T12:00:00.000Z",
      km: 10,
      fuel: 1000,
      toll: 500,
      total: 1500,
      durationMin: 30,
      tollBreakdown: [{ highway: "Autopista Central", price: 500 }],
    },
    {
      date: "2026-08-04T12:00:00.000Z",
      km: 20,
      fuel: 2000,
      toll: 0,
      total: 2000,
      durationMin: 45,
    },
  ]);
  assert.equal(stats.count, 2);
  assert.equal(stats.km, 30);
  assert.equal(stats.total, 3500);
  assert.equal(stats.minutes, 75);
  assert.deepEqual(stats.concessionRows, [["Autopista Central", 500]]);
});

test("muestra litros usados y guarda cargas con foto de boleta", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /id="expenseLiters">0,0 L</);
  assert.match(html, /liters=km\/Math\.max\(\.1,getConfig\(\)\.efficiency\)/);
  assert.match(html, /id="openFuelEntry"[^>]*>\+ Agregar carga</);
  assert.match(html, /id="fuelEntryDate"[^>]*type="date"/);
  assert.match(html, /id="fuelEntryLiters"[^>]*type="number"/);
  assert.match(html, /id="fuelEntryAmount"[^>]*type="number"/);
  assert.match(html, /id="fuelEntryCamera"[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"/);
  assert.match(html, /id="fuelEntryReceipt"[^>]*type="file"[^>]*accept="image\/\*"/);
  assert.match(html, /Tomar foto/);
  assert.match(html, /Leer boleta con IA/);
  assert.match(html, /Tesseract\.recognize\(image,"spa"/);
  assert.match(html, /function parseFuelReceiptText\(text\)/);
  assert.match(html, /selectedFuelReceiptFile/);
  assert.match(html, /id="fuelReceiptPreview"/);
  assert.match(html, /id="receiptViewerModal"[^>]*role="dialog"/);
  assert.match(html, /localStorage\.getItem\("ruta\.fuelEntries"\)/);
  assert.match(html, /localStorage\.setItem\("ruta\.fuelEntries"/);
  assert.match(html, /indexedDB\.open\("ruta-personal",1\)/);
  assert.match(html, /createObjectStore\("fuel-receipts"\)/);
  assert.match(html, /file\.size>10\*1024\*1024/);
  assert.match(html, /canvas\.toBlob\(/);
  assert.match(html, /FuelReceiptStore\.put\(id,blob\)/);
  assert.match(html, /data-view-receipt=/);
  assert.match(html, /data-delete-fuel=/);
  assert.match(html, /confirm\(`¿Eliminar la carga/);
  assert.match(html, /fuelLoadedTotal/);
  assert.match(html, /fuelPaidTotal/);
});

test("desglosa el gasto TAG por autopista y por pórtico", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /id="tollHighwayBreakdown"/);
  assert.match(html, /Gasto TAG por autopista/);
  assert.match(html, /function tollSpendingByHighway\(trips\)/);
  assert.match(html, /class="toll-highway-passage"/);
  assert.match(html, /return groups\.map\(group=>`<details class="toll-highway"><summary>/);
  assert.match(html, /function tollPassageDaysHTML\(passages\)/);
  assert.match(html, /class="toll-highway-day"/);
  assert.match(html, /class="toll-day-chevron"/);
  assert.match(html, /\.toll-highway-day\[open\] \.toll-day-chevron/);
  assert.doesNotMatch(html, /class="toll-highway"\$\{index===0\?" open"/);
  assert.match(html, /renderTollHighwayBreakdown\(trips,tolls\)/);

  const normalizeMatch = html.match(/function normalizeHighwayName\(value\)\{.*?\}/s);
  const groupsMatch = html.match(/function tollSpendingByHighway\(trips\)\{.*?return\[\.\.\.groups\.values\(\)\].*?;\r?\n\}/s);
  assert.ok(normalizeMatch && groupsMatch, "debe existir el agrupador por autopista");
  const tollSpendingByHighway = Function(
    `function tripRecordId(trip){return trip.id||""}; ${normalizeMatch[0]}; ${groupsMatch[0]}; return tollSpendingByHighway;`,
  )();
  const groups = tollSpendingByHighway([
    {id:"v1",date:"2026-08-20",tollBreakdown:[{id:"p1",name:"P1 Costanera Norte",highway:"Aut. Costanera Norte",price:865},{id:"p2",name:"P2 Costanera Norte",highway:"Aut. Costanera Norte",price:510}]},
    {id:"v2",date:"2026-08-21",tollBreakdown:[{id:"p3",name:"P3 Vespucio Norte",highway:"Vespucio Norte",price:420}]},
  ]);
  assert.equal(groups[0].highway, "Autopista Costanera Norte");
  assert.equal(groups[0].total, 1375);
  assert.equal(groups[0].passages.length, 2);
  assert.equal(groups[1].total, 420);
});

test("configura notificaciones nativas y auto inicio por Bluetooth", async () => {
  const [html, buildSource, notificationWorker, bluetoothReceiver, bluetoothPrefs, mainActivity] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(buildSourceUrl, "utf8"),
    readFile(notificationWorkerUrl, "utf8"),
    readFile(bluetoothReceiverUrl, "utf8"),
    readFile(bluetoothPrefsUrl, "utf8"),
    readFile(mainActivityUrl, "utf8"),
  ]);
  assert.match(html, /id=\"notificationToggle\"/);
  assert.match(html, /id=\"bluetoothToggle\"/);
  assert.match(html, /id=\"bluetoothLink\"/);
  assert.match(html, /id=\"bluetoothForget\"/);
  assert.match(html, /const NotificationManager=/);
  assert.match(html, /Notification\.requestPermission\(\)/);
  assert.match(html, /serviceWorker\.register\(\"\/clarify-sw\.js\"/);
  assert.match(html, /registration\.showNotification/);
  assert.match(html, /const TollNotificationManager=/);
  assert.match(html, /TollNotificationManager\.update\(up\)/);
  assert.match(html, /navigator\.bluetooth\.requestDevice\(\{acceptAllDevices:true\}\)/);
  assert.match(html, /navigator\.bluetooth\.getDevices\(\)/);
  assert.match(html, /window\.ClarifyAndroid/);
  assert.match(html, /selectCarBluetooth\(\)/);
  assert.match(html, /window\.ClarifyNativeBluetoothAutoStart/);
  assert.match(html, /window\.ClarifyNativeBluetoothAutoFinish/);
  assert.match(html, /finishTrip\(\{saveTrip:true\}\)/);
  assert.match(html, /desconectado durante 30 segundos/);
  assert.match(html, /startTrip\(\{freeDrive:true\}\)/);
  assert.match(bluetoothReceiver, /DISCONNECT_GRACE_MS = 30_000L/);
  assert.match(bluetoothReceiver, /setAndAllowWhileIdle/);
  assert.match(bluetoothReceiver, /BluetoothPrefs\.anyConnected\(context\)/);
  assert.match(bluetoothReceiver, /ACTION_AUTO_FINISH/);
  assert.match(bluetoothPrefs, /Set<String> addresses/);
  assert.match(mainActivity, /setMultiChoiceItems/);
  assert.match(mainActivity, /ClarifyNativeBluetoothAutoFinish/);
  assert.match(buildSource, /url\.pathname === \"\/clarify-sw\.js\"/);
  assert.match(buildSource, /Service-Worker-Allowed/);
  assert.match(notificationWorker, /notificationclick/);
  assert.match(notificationWorker, /clients\.openWindow\(\"\/\"\)/);
});

test("publica la aplicación ruta. real", { skip: !workerAvailable }, async (context) => {
  let response;
  try {
    response = await render();
  } catch (error) {
    if (error?.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME") {
      context.skip("el Worker compilado requiere el runtime Cloudflare");
      return;
    }
    throw error;
  }
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ruta\./i);
  assert.match(html, /id="map"/);
  assert.match(html, /id="gpsModal"/);
  assert.match(html, /id="gpsModalTitle"/);
  assert.match(html, /id="gpsModalText"/);
  assert.match(html, /id="gpsModalHelp"/);
  assert.match(html, /id="gpsOpenTop"/);
  assert.match(html, /id="gpsClose"/);
  assert.match(html, /id="gpsRetry"/);
  assert.match(html, /class="bottom-nav"/);
  assert.match(html, /data-bottom-view="summary"/);
  assert.match(html, /id="openNewTrip"/);
  assert.match(html, /id="newTripSheet"/);
  assert.match(html, /id="homeRecenter"/);
  assert.match(html, /id="driveRemainingTime"/);
  assert.match(html, /id="driveEta"/);
});

test("sirve ruta-v2.html como aplicación principal", { skip: !buildSourceAvailable }, async () => {
  const buildSource = await readFile(buildSourceUrl, "utf8");
  assert.match(buildSource, /url\.pathname === "\/" \|\| url\.pathname === "\/ruta-v2\.html"/);
  assert.match(buildSource, /url\.pathname === "\/data\/rm-camera-locations\.json"/);
  assert.match(buildSource, /cameraDataBase64/);
  assert.match(buildSource, /Content-Type": "text\/html; charset=utf-8"/);
  assert.match(buildSource, /Content-Type": "application\/json; charset=utf-8"/);
  assert.match(buildSource, /MAPBOX_PUBLIC_TOKEN/);
});

test("sirve el inventario oficial de cámaras como JSON", { skip: !workerAvailable }, async () => {
  workerUrl.searchParams.set("cameras", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/data/rm-camera-locations.json"),
    {},
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  const data = await response.json();
  assert.equal(data.metadata.pointCount, 246);
  assert.equal(data.points.length, 246);
});

test("consulta en vivo las bencineras y precios oficiales de la CNE", async () => {
  const [html, buildSource] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(buildSourceUrl, "utf8"),
  ]);
  assert.match(buildSource, /url\.pathname === "\/api\/fuel-stations"/);
  assert.match(buildSource, /https:\/\/api\.bencinaenlinea\.cl\/api\/busqueda_estacion_filtro/);
  assert.match(buildSource, /https:\/\/api\.bencinaenlinea\.cl\/api\/marca_ciudadano/);
  assert.match(buildSource, /max-age=900, stale-while-revalidate=3600/);
  assert.match(html, /FUEL_STATION_DATA_URL="\/api\/fuel-stations"/);
  assert.match(html, /function normalizeFuelStationCollection\(payload\)/);
  assert.match(html, /id:"fuel-station-clusters"/);
  assert.match(html, /id:"fuel-station-points"/);
  assert.match(html, /id:"fuel-station-prices"/);
  assert.match(html, /id="driveFuelStationToggle"/);
  assert.match(html, /id="homeFuelStationCount"/);
  assert.match(html, /fuelsJson:JSON\.stringify\(fuels\)/);
  assert.match(html, /ensureMapPictograms\(map\)/);
  assert.match(html, /"icon-image":"clarify-fuel"/);
  assert.match(html, /"clarify-camera","camera"/);
  assert.match(html, /toll-marker-icon/);
  assert.match(html, /Fuente oficial CNE/);
  assert.match(html, /Bencina en Línea de la Comisión Nacional de Energía/);
});

test("resume el mes y agrega una parada durante la navegación activa", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /id="driveAddStop"/);
  assert.match(html, /id="activeStopModal"/);
  assert.match(html, /const ActiveNavigationStopManager=/);
  assert.match(html, /state\.remainingStops\.unshift\(stop\)/);
  assert.match(html, /recalculateFromCurrent\(point,\{force:true\}\)/);
  assert.match(html, /mobile-app-header \.search-btn\{min-width:58px/);
  assert.match(html, /month-summary-card\{display:grid;grid-template-columns:minmax\(86px,/);
  assert.match(html, /workspace:has\(#summaryView:not\(\.hidden\)\).*height:calc\(100dvh - var\(--bottom-nav-height\)/);
});

test("mantiene el JavaScript válido y las referencias DOM presentes", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const scripts = [
    ...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi),
  ]
    .map((match) => match[1])
    .filter(Boolean);

  assert.ok(scripts.length > 0);
  for (const source of scripts) {
    assert.doesNotThrow(() => Function(source));
  }

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(
    (match) => match[1],
  );
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicateIds, []);

  const referencedIds = [
    ...html.matchAll(/\$\("#([^"]+)"\)/g),
  ].map((match) => match[1]);
  const missingIds = [...new Set(referencedIds.filter((id) => !ids.includes(id)))];
  assert.deepEqual(missingIds, []);
});

test("valida las coordenadas y polígonos de todos los pórticos", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const rawTolls = readTolls(html);
  const validatorStart = html.indexOf("function inspectLatLon");
  const validatorEnd = html.indexOf("const tollValidation");
  assert.ok(validatorStart >= 0 && validatorEnd > validatorStart);
  const validatorSource = html.slice(validatorStart, validatorEnd);
  const { validateTollData, pointInLatLonPolygon } = Function(
    `${validatorSource}; return {validateTollData, pointInLatLonPolygon};`,
  )();
  const tollValidation = validateTollData(rawTolls);
  const tolls = tollValidation.valid;
  const invalid = [];

  for (const toll of tolls) {
    const issues = coordinateIssues(toll.coordinate);
    if (!Array.isArray(toll.polygon) || toll.polygon.length < 3) {
      issues.push("polígono incompleto");
    } else {
      toll.polygon.forEach((point, index) => {
        issues.push(
          ...coordinateIssues(point).map(
            (issue) => `polygon[${index}]: ${issue}`,
          ),
        );
      });
    }
    if (issues.length) invalid.push({ id: toll.id, issues });
  }

  assert.equal(rawTolls.length, 313);
  assert.equal(tolls.length, 313);
  assert.deepEqual(tollValidation.invalid, []);
  assert.deepEqual(invalid, []);
  assert.equal(
    new Set(tolls.map((toll) => toll.coordinate.join(","))).size,
    tolls.length,
    "los marcadores direccionales no deben quedar superpuestos",
  );
  assert.deepEqual(
    tolls.filter((toll) => !pointInLatLonPolygon(toll.coordinate, toll.polygon)),
    [],
    "cada marcador debe quedar dentro de su polígono",
  );

  const corrected = tolls.find((toll) => toll.id === "p2.2_cost_norte_PO");
  assert.deepEqual(corrected?.coordinate, [-33.3944898, -70.6033484]);
  const guarded = validateTollData([
    {
      id: "valid",
      coordinate: [-33.4, -70.6],
      polygon: [
        [-33.4, -70.6],
        [-33.5, -70.6],
        [-33.5, -70.7],
      ],
    },
    {
      id: "invalid",
      coordinate: [-33, 3944898, -70, 6033484],
      polygon: [
        [-33.4, -70.6],
        [-33.5, -70.6],
        [-33.5, -70.7],
      ],
    },
  ]);
  assert.deepEqual(
    guarded.valid.map((toll) => toll.id),
    ["valid"],
  );
  assert.deepEqual(
    guarded.invalid.map((toll) => toll.id),
    ["invalid"],
  );
  assert.match(html, /TOLL_DATA\.splice\(0,TOLL_DATA\.length/);
});

test("centraliza el GPS real sin convertir Santiago en origen", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const managerStart = html.indexOf("const LocationManager=(()=>");
  const managerEnd = html.indexOf("async function useGPS", managerStart);
  assert.ok(managerStart >= 0 && managerEnd > managerStart);

  const geolocationCalls = [
    ...html.matchAll(
      /navigator\.geolocation\.(getCurrentPosition|watchPosition|clearWatch)/g,
    ),
  ];
  assert.equal(
    geolocationCalls.filter((match) => match[1] === "getCurrentPosition").length,
    1,
  );
  assert.equal(
    geolocationCalls.filter((match) => match[1] === "watchPosition").length,
    1,
  );
  assert.ok(
    geolocationCalls.every(
      (match) => match.index >= managerStart && match.index < managerEnd,
    ),
  );

  assert.match(html, /LocationState=Object\.freeze/);
  assert.match(html, /getFreshPosition/);
  assert.match(html, /startTracking/);
  assert.match(html, /stopTracking/);
  assert.match(html, /subscribe/);
  assert.match(html, /maximumAge:0,timeout:18000/);
  assert.match(html, /maximumAge:0,timeout:20000/);
  assert.doesNotMatch(html, /state\.origin\s*=\s*SANTIAGO/);
  assert.doesNotMatch(html, /setLngLat\(state\.origin\|\|SANTIAGO\)/);
  assert.doesNotMatch(html, />Desde Santiago Centro</);
  assert.match(html, />Buscando tu ubicación…</);
});

test("aplica reglas festivas chilenas al cálculo de tarifa", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const calendarStart = html.indexOf("function parseClock");
  const calendarEnd = html.indexOf("function tollLngLat", calendarStart);
  assert.ok(calendarStart >= 0 && calendarEnd > calendarStart);
  const calendar = Function(
    "getConfig",
    `${html.slice(calendarStart, calendarEnd)}; return {isChileHoliday, chileDayMinute, tollRate};`,
  )(() => ({ tollCategory: "1" }));

  const holiday = new Date("2026-05-01T12:00:00.000Z");
  const weekday = new Date("2026-05-04T12:00:00.000Z");
  assert.equal(calendar.isChileHoliday(holiday), true);
  assert.equal(calendar.chileDayMinute(holiday).day, "fest");
  assert.equal(calendar.isChileHoliday(new Date("2026-04-03T12:00:00.000Z")), true);
  assert.equal(calendar.isChileHoliday(weekday), false);

  const toll = {
    pricing: {
      categories: {
        1: { offPeakCLP: 100, peakCLP: 200, saturatedCLP: 300 },
      },
      windows: [
        { kind: "peak", days: ["fest"], start: "00:00", end: "24:00" },
      ],
    },
  };
  assert.equal(calendar.tollRate(toll, holiday).price, 200);
  assert.equal(calendar.tollRate(toll, weekday).price, 100);
});

test("LocationManager mantiene un solo watcher y filtra saltos imprecisos", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const managerStart = html.indexOf("const LocationManager=(()=>");
  const managerEnd = html.indexOf("async function useGPS", managerStart);
  const managerSource = html.slice(managerStart, managerEnd);

  let getCalls = 0;
  let watchCalls = 0;
  let clearCalls = 0;
  let watchSuccess;
  const baseTimestamp = Date.now();
  const nativePosition = (
    longitude,
    latitude,
    accuracy,
    timestamp,
    speed = 3,
    heading = 90,
  ) => ({
    coords: { longitude, latitude, accuracy, speed, heading },
    timestamp,
  });
  const geolocation = {
    getCurrentPosition(success) {
      getCalls += 1;
      success(
        nativePosition(
          -70.6483,
          -33.4569,
          8,
          baseTimestamp,
        ),
      );
    },
    watchPosition(success) {
      watchCalls += 1;
      watchSuccess = success;
      return 41;
    },
    clearWatch(id) {
      assert.equal(id, 41);
      clearCalls += 1;
    },
  };
  const LocationState = {
    IDLE: "IDLE",
    CHECKING_PERMISSION: "CHECKING_PERMISSION",
    LOCATING: "LOCATING",
    TRACKING: "TRACKING",
    ERROR: "ERROR",
  };
  const manager = Function(
    "navigator",
    "window",
    "state",
    "LocationState",
    "IS_DEV",
    "isEmbedded",
    "geoPermissionState",
    "locationErrorCode",
    "haversine",
    "bearingBetween",
    "smoothHeading",
    "headingDifference",
    "MIN_HEADING_SPEED_MPS",
    "MIN_HEADING_MOVE_M",
    "MAX_HEADING_SOURCE_DIFFERENCE",
    "filterGpsVisualPosition",
    `${managerSource}; return LocationManager;`,
  )(
    { geolocation },
    { isSecureContext: true },
    { deviceHeading: null },
    LocationState,
    false,
    () => false,
    async () => "granted",
    (error) =>
      error?.locationCode ??
      ({ 1: "PERMISSION_DENIED", 2: "POSITION_UNAVAILABLE", 3: "TIMEOUT" }[
        error?.code
      ] ??
        "UNKNOWN"),
    () => 10,
    () => 90,
    (current, target, factor = 0.22) => {
      const delta = ((target - current + 540) % 360) - 180;
      return ((current + delta * factor) % 360 + 360) % 360;
    },
    (a, b) => Math.abs(((a - b + 540) % 360) - 180),
    2,
    4,
    65,
    (previous, reading) => {
      if (!previous) return { ...reading };
      if (reading.accuracy > 65) {
        return { ...previous, timestamp: reading.timestamp, accuracy: reading.accuracy };
      }
      return { ...reading };
    },
  );

  const fresh = await manager.getFreshPosition({ force: true });
  assert.equal(fresh.accuracy, 8);
  assert.equal(getCalls, 1);
  assert.equal(manager.startTracking(), 41);
  assert.equal(manager.startTracking(), 41);
  assert.equal(watchCalls, 1);
  assert.equal(manager.getState().watchId, 41);

  watchSuccess(
    nativePosition(-70.64829, -33.45689, 8, baseTimestamp + 500, 0.2, 270),
  );
  assert.equal(
    manager.getState().visualPosition.heading,
    90,
    "a baja velocidad debe conservar el último rumbo válido",
  );

  watchSuccess(
    nativePosition(-70.6482, -33.4568, 60, baseTimestamp + 1000),
  );
  const weakButUsable = manager.getState().visualPosition;
  assert.equal(weakButUsable.accuracy, 60);

  watchSuccess(
    nativePosition(-70.63, -33.44, 140, baseTimestamp + 2000),
  );
  const rejectedJump = manager.getState().visualPosition;
  assert.equal(rejectedJump.longitude, weakButUsable.longitude);
  assert.equal(rejectedJump.latitude, weakButUsable.latitude);

  watchSuccess(
    nativePosition(-70.61, -33.41, 8, baseTimestamp + 1500),
  );
  assert.equal(
    manager.getState().position.timestamp,
    baseTimestamp + 2000,
    "una lectura atrasada no debe devolver la flecha hacia una posición anterior",
  );

  watchSuccess(
    nativePosition(-70.6481, -33.4567, 12, baseTimestamp + 3000),
  );
  assert.equal(manager.getState().visualPosition.accuracy, 12);

  manager.stopTracking();
  assert.equal(clearCalls, 1);
  assert.equal(manager.getState().watchId, null);
});

test("el botón de ubicación centra inmediatamente el mapa en el GPS", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const centerStart = html.indexOf("function centerDashboardOnVehicle");
  const centerEnd = html.indexOf("function renderLocationState", centerStart);
  const recenterStart = html.indexOf("async function recenterHomeToGps");
  const recenterEnd = html.indexOf("function uuid", recenterStart);
  assert.ok(centerStart >= 0 && centerEnd > centerStart);
  assert.ok(recenterStart >= 0 && recenterEnd > recenterStart);

  const cameraCalls = [];
  const map = {
    stop() { cameraCalls.push("stop"); },
    resize() { cameraCalls.push("resize"); },
    easeTo(options) { cameraCalls.push(options); },
  };
  const state = { map, autoGpsCentered: false };
  const centerDashboardOnVehicle = Function(
    "state",
    `${html.slice(centerStart, centerEnd)}; return centerDashboardOnVehicle;`,
  )(state);
  assert.equal(
    centerDashboardOnVehicle(
      { longitude: -70.61, latitude: -33.42 },
      { zoom: 16.2, duration: 600 },
    ),
    true,
  );
  assert.equal(state.autoGpsCentered, true);
  assert.deepEqual(cameraCalls.slice(0, 2), ["stop", "resize"]);
  assert.deepEqual(cameraCalls[2].center, [-70.61, -33.42]);
  assert.equal(cameraCalls[2].zoom, 16.2);

  const button = {
    disabled: false,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
  const known = { longitude: -70.65, latitude: -33.45, accuracy: 25 };
  const fresh = { longitude: -70.60, latitude: -33.40, accuracy: 7 };
  const centered = [];
  let trackingCalls = 0;
  let renderCalls = 0;
  const LocationManager = {
    getState: () => ({ visualPosition: known, position: fresh }),
    getFreshPosition: async ({ force }) => {
      assert.equal(force, true);
      return fresh;
    },
    startTracking: () => { trackingCalls += 1; },
  };
  const recenterHomeToGps = Function(
    "$",
    "LocationManager",
    "state",
    "centerDashboardOnVehicle",
    "renderLocationState",
    "toast",
    "showGpsProblem",
    `${html.slice(recenterStart, recenterEnd)}; return recenterHomeToGps;`,
  )(
    () => button,
    LocationManager,
    state,
    (position, options) => centered.push({ position, options }),
    () => { renderCalls += 1; },
    () => undefined,
    () => assert.fail("no debe mostrar un error con GPS válido"),
  );

  const point = await recenterHomeToGps();
  assert.deepEqual(point, [-70.60, -33.40]);
  assert.equal(centered.length, 2);
  assert.equal(centered[0].position, known);
  assert.equal(centered[1].position, fresh);
  assert.equal(centered[1].options.zoom, 16.2);
  assert.equal(trackingCalls, 1);
  assert.equal(renderCalls, 1);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes.get("aria-busy"), "false");
  assert.equal(button.attributes.get("aria-label"), "Centrar mapa en mi ubicación");
  assert.match(html, /bindElementEvent\("#homeRecenter","click",\(\)=>\{void recenterHomeToGps\(\)/);
});

test("suaviza heading, posición y cámara FOLLOW/FREE", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const smoothStart = html.indexOf("function smoothHeading");
  const smoothEnd = html.indexOf("// LOCATION MANAGER", smoothStart);
  const smoothSource = html.slice(smoothStart, smoothEnd);
  const smoothHeading = Function(
    `${smoothSource}; return smoothHeading;`,
  )();
  const angularDistance = (a, b) =>
    Math.abs(((a - b + 540) % 360) - 180);

  assert.ok(angularDistance(smoothHeading(359, 1, 0.5), 0) < 0.001);
  assert.ok(angularDistance(smoothHeading(1, 359, 0.5), 0) < 0.001);
  const filterStart = html.indexOf("const GPS_VISUAL_ACCURACY_LIMIT_M=");
  const filterEnd = html.indexOf("// LOCATION MANAGER", filterStart);
  const filterGpsVisualPosition = Function(
    "haversine",
    "MIN_HEADING_SPEED_MPS",
    `${html.slice(filterStart, filterEnd)}; return filterGpsVisualPosition;`,
  )(
    (a, b) => Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320),
    3 / 3.6,
  );
  const previousGps = {
    longitude: -70.65,
    latitude: -33.45,
    timestamp: 1000,
    accuracy: 8,
    speed: 0,
    heading: 90,
  };
  const stationaryGps = filterGpsVisualPosition(previousGps, {
    ...previousGps,
    longitude: -70.649995,
    timestamp: 2000,
    accuracy: 7,
  });
  assert.equal(stationaryGps.longitude, previousGps.longitude);
  const inaccurateGps = filterGpsVisualPosition(previousGps, {
    ...previousGps,
    longitude: -70.64,
    timestamp: 2000,
    accuracy: 120,
    speed: 15,
  });
  assert.equal(inaccurateGps.longitude, previousGps.longitude);
  const movingGps = filterGpsVisualPosition(previousGps, {
    ...previousGps,
    longitude: -70.6499,
    timestamp: 2000,
    accuracy: 10,
    speed: 10,
  });
  assert.ok(movingGps.longitude > previousGps.longitude);
  assert.ok(movingGps.longitude < -70.6499);
  assert.match(html, /requestAnimationFrame\(frame\)/);
  const markerDurationStart = html.indexOf("function markerAnimationDuration");
  const markerDurationEnd = html.indexOf("function createVehicleMarker", markerDurationStart);
  const markerAnimationDuration = Function(
    `${html.slice(markerDurationStart, markerDurationEnd)}; return markerAnimationDuration;`,
  )();
  assert.equal(markerAnimationDuration(250), 220);
  assert.equal(markerAnimationDuration(1000), 880);
  assert.ok(markerAnimationDuration(250) < 250);
  assert.ok(markerAnimationDuration(1000) < 1000);
  assert.match(html, /duration=markerAnimationDuration\(sampleInterval,\{routeChanged\}\)/);
  assert.match(html, /progress=Math\.min\(1,\(now-started\)\/duration\),eased=progress/);
  assert.doesNotMatch(html, /if\(routeChanged\)marker\.setLngLat\(target\)/);
  assert.match(html, /RouteDistanceCalculator\.pointAtDistance\(state\.routeDistanceIndex,routeDistance\)/);
  assert.match(html, /routePoint\|\|\[/);
  assert.match(html, /renderDriveRouteProgress\(routeDistance,\{animated:true\}\)/);
  assert.match(html, /isAndroidNativeApp\(\)\?NAVIGATION_CAMERA_CONFIG\.FOLLOW_FRAME_INTERVAL_ANDROID_MS:NAVIGATION_CAMERA_CONFIG\.FOLLOW_FRAME_INTERVAL_WEB_MS/);
  assert.match(html, /stored\.drive&&isPerformanceConstrained\(\)\?32:14/);
  assert.match(html, /function renderNavigationTrack/);
  assert.match(html, /routeIndex:drive\?state\.routeDistanceIndex:null/);
  assert.match(html, /if\(stored\.drive\)\{[\s\S]*?NavigationCameraController\.queueFrame\(animatedPoint,navigationPosition\)/);
  assert.doesNotMatch(html, /NavigationCameraController\.followFrame\(animatedPoint/);
  assert.match(html, /lastRoutePaintAt:0/);
  assert.match(html, /now-\(stored\.lastRoutePaintAt\|\|0\)>=100/);
  assert.match(html, /routeDistanceMeters:Number\.isFinite\(routeDistance\)\?routeDistance:position\.routeDistanceMeters/);
  assert.match(html, /const CameraMode=Object\.freeze\(\{FOLLOW/);
  assert.match(html, /now-lastFrameAt<minimumInterval/);
  assert.match(html, /const MIN_HEADING_SPEED_MPS=2,MIN_HEADING_MOVE_M=4,MAX_HEADING_SOURCE_DIFFERENCE=65/);
  assert.match(html, /if\(effectiveSpeed<MIN_HEADING_SPEED_MPS\)return current/);
  assert.match(html, /headingDifference\(rawHeading,motionHeading\)<=MAX_HEADING_SOURCE_DIFFERENCE\?rawHeading:motionHeading/);
  assert.doesNotMatch(html, /else if\(Number\.isFinite\(state\.deviceHeading\)\)target=state\.deviceHeading/);
  assert.match(html, /const AUTO_FOLLOW_RESUME_MS=8000/);
  assert.match(html, /NavigationCameraController\.beginInteraction\(interaction\)/);
  assert.match(html, /NavigationCameraController\.endInteraction\(interaction\)/);
  assert.match(html, /NavigationCameraController\.recenter\(\)/);
  assert.match(html, /\["zoom","zoomstart","zoomend"\]/);
  assert.match(html, /targetY=mapHeight\*NAVIGATION_CAMERA_CONFIG\.PUCK_VERTICAL_ANCHOR/);
  assert.match(html, /function routeAlignedNavigationPosition/);
  assert.match(html, /function circularBearingMean/);
  assert.match(html, /function routeTangentBearing/);
  assert.match(html, /\[0,\.62\],\[lookAhead\*\.34,\.28\],\[lookAhead\*\.68,\.10\]/);
  assert.match(html, /routeSnapToleranceMeters\(position\.accuracy\)/);
  assert.match(html, /match\.distance<=Math\.min\(12,tolerance\*\.4\)/);
  assert.match(html, /headingDifference\(position\.heading,routeHeading\)<=65/);
  assert.match(html, /const GPS_VISUAL_ACCURACY_LIMIT_M=65/);
  assert.match(html, /reading\.timestamp<=location\.position\.timestamp/);
  assert.doesNotMatch(html, /followMode/);
  assert.doesNotMatch(html, /latestAccuracy>50/);
  assert.match(html, /\.vehicle-puck\{\s*width:48px;height:48px/);

  const cameraStart = html.indexOf("function interpolateCameraProfile");
  const cameraEnd = html.indexOf("function nearestRouteProgress", cameraStart);
  const cameraSource = html.slice(cameraStart, cameraEnd);
  const easeCalls = [];
  let stopCalls = 0;
  const mapContainer = { clientHeight: 800 };
  const map = {
    isStyleLoaded: () => false,
    getContainer: () => mapContainer,
    stop: () => { stopCalls += 1; },
    easeTo: (options) => easeCalls.push(options),
  };
  const state = {
    driveMap: map,
    cameraMode: "FOLLOW",
    heading: 82,
  };
  const button = {
    classList: { toggle() {} },
    setAttribute() {},
  };
  let clock = 1000;
  let resumeCallback = null;
  let resumeDelay = null;
  const location = {
    visualPosition: {
      longitude: -70.65,
      latitude: -33.45,
      heading: 84,
      accuracy: 60,
      speed: 12,
    },
    position: { accuracy: 60, speed: 12 },
  };
  const cameraImplementation = Function(
    "$",
    "state",
    "CameraMode",
    "LocationManager",
    "performance",
    "RouteDistanceCalculator",
    "navigationBearing",
    "navigationPitch",
    "haversine",
    "bearingBetween",
    "routeSnapToleranceMeters",
    "headingDifference",
    "isAndroidNativeApp",
    "NAVIGATION_CAMERA_CONFIG",
    "applyStandardMapConfig",
    "applyDriveDimensionConfig",
    "IS_DEV",
    "setTimeout",
    "clearTimeout",
    `${cameraSource}; return {controller:NavigationCameraController,navigationRouteBearingAt};`,
  )(
    (selector) => selector === "#centerDrive" ? button : null,
    state,
    { FOLLOW: "FOLLOW", FREE: "FREE", RECENTERING: "RECENTERING", OVERVIEW: "OVERVIEW" },
    { getState: () => location },
    { now: () => clock },
    {
      locatePoint: () => ({ distance: 0, coordinate: [-70.65, -33.45] }),
      pointAtDistance: (_index, meters) => [meters, 0],
    },
    (heading) => heading,
    () => 55,
    () => 10,
    () => 77,
    () => 16,
    (a, b) => Math.abs(a - b),
    () => false,
    {
      CAMERA_LOW_SPEED_FREEZE_KPH: 4.5,
      CAMERA_LOW_SPEED_RESUME_KPH: 7.5,
      BEARING_DEADBAND_DEG: 10,
      MAX_BEARING_ROTATION_RATE_DPS: 38,
      BEARING_SMOOTHING_TAU_MS: 850,
      LOOKAHEAD_PROFILE: [[0, 25], [50, 60]],
      PUCK_VERTICAL_ANCHOR: 0.70,
      ZOOM_PROFILE: [[0, 17.35], [50, 16.75]],
      ZOOM_MIN: 15.85,
      ZOOM_MAX: 17.35,
      ZOOM_SMOOTHING_TAU_MS: 900,
      PITCH_CRUISING: 55,
      PITCH_SMOOTHING_TAU_MS: 700,
      DIMENSION_TRANSITION_DURATION_MS: 680,
      DIMENSION_TRANSITION_MIN_DURATION_MS: 260,
      RECENTER_DURATION_MS: 850,
      FOLLOW_FRAME_INTERVAL_ANDROID_MS: 84,
      FOLLOW_FRAME_INTERVAL_WEB_MS: 50,
      DEBUG_INTERVAL_MS: 1000,
    },
    () => {},
    () => {},
    false,
    (callback, delay) => {
      resumeCallback = callback;
      resumeDelay = delay;
      return 9;
    },
    () => {
      resumeCallback = null;
    },
  );
  const controller = cameraImplementation.controller;
  state.routeDistanceIndex = { total: 1000 };
  assert.equal(cameraImplementation.navigationRouteBearingAt(100, 12, { camera: true }), 77);
  state.routeDistanceIndex = null;

  controller.updatePosition(location);
  assert.equal(easeCalls.length, 1, "una lectura GPS debe mover la cámara aunque el estilo siga cargando");
  assert.equal(stopCalls, 0);
  assert.deepEqual(easeCalls[0].center, [-70.65, -33.45]);
  assert.equal(easeCalls[0].bearing, 84);
  assert.equal(easeCalls[0].pitch, 55);
  const layout = controller.cameraLayout(map);
  assert.deepEqual(easeCalls[0].offset, layout.offset);
  const paddedCenter =
    layout.padding.top +
    (mapContainer.clientHeight - layout.padding.top - layout.padding.bottom) / 2;
  assert.ok(
    Math.abs(paddedCenter + layout.offset[1] - mapContainer.clientHeight * 0.70) <= 1,
    "la flecha debe quedar aproximadamente al 70% de la altura útil",
  );
  assert.equal(easeCalls[0].duration, 0);

  controller.beginInteraction("drag");
  assert.equal(state.cameraMode, "FREE");
  clock += 250;
  controller.updatePosition(location);
  assert.equal(easeCalls.length, 1, "FREE debe mover sólo el marcador");
  controller.endInteraction("drag");
  assert.equal(resumeDelay, 8000);
  assert.equal(typeof resumeCallback, "function");
  resumeCallback();
  assert.equal(state.cameraMode, "RECENTERING");
  assert.equal(resumeDelay, 890);
  assert.equal(typeof resumeCallback, "function");
  resumeCallback();
  assert.equal(state.cameraMode, "FOLLOW");
  assert.equal(easeCalls.length, 2, "el temporizador debe reactivar seguimiento continuo");

  state.routeDistanceIndex = {};
  location.visualPosition.longitude = -70.64;
  location.visualPosition.latitude = -33.44;
  controller.updatePosition(location, { force: true });
  assert.deepEqual(
    easeCalls.at(-1).center,
    [-70.65, -33.45],
    "la cámara debe usar la posición proyectada sobre la ruta",
  );
  clock += 60;
  assert.equal(
    controller.followFrame([-70.651, -33.451], { heading: 86, speed: 12 }).state,
    "FOLLOW",
  );
  assert.deepEqual(easeCalls.at(-1).center, [-70.651, -33.451]);
  assert.equal(easeCalls.at(-1).duration, 0);

  const locationRender = html.slice(
    html.indexOf("function renderLocationState"),
    html.indexOf("async function enableDeviceHeading"),
  );
  assert.doesNotMatch(locationRender, /NavigationCameraController\.updatePosition/);
  const driveUpdate = html.slice(
    html.indexOf("function updateDrive"),
    html.indexOf("const MANEUVER_REACHED_RADIUS_M"),
  );
  assert.ok(
    driveUpdate.indexOf("currentRouteProgressDistance") <
      driveUpdate.indexOf("animateVehicleMarker"),
    "la flecha debe animarse después de estabilizar el progreso de ruta",
  );
  assert.match(driveUpdate, /routeAlignedNavigationPosition\(position,progress\)/);
  assert.match(driveUpdate, /navigationProgress\(position,p\)/);
  assert.match(driveUpdate, /stabilizeNavigationProgress\(locatedProgress,position\)/);
  assert.match(driveUpdate, /animateVehicleMarker\(driveMarker,navigationPosition\)/);
  assert.match(driveUpdate, /routeDistanceMeters:navigationPosition\.routeDistanceMeters/);
  assert.match(driveUpdate, /if\(!navigationPosition\.routeMatched\)renderDriveRouteProgress\(\)/);
  assert.doesNotMatch(driveUpdate, /NavigationCameraController\.updatePosition/);
  assert.doesNotMatch(driveUpdate, /NavigationCameraController\.ensureVisible/);
  assert.doesNotMatch(cameraSource, /isStyleLoaded/);
  assert.doesNotMatch(driveUpdate, /state\.driveMap\?\.isStyleLoaded/);
  const stabilizeStart = html.indexOf("function stabilizeNavigationProgress");
  const stabilizeEnd = html.indexOf("function splitRouteGeometryByProgress", stabilizeStart);
  const stabilizeNavigationProgress = Function(
    "state",
    "RouteDistanceCalculator",
    `${html.slice(stabilizeStart, stabilizeEnd)}; return stabilizeNavigationProgress;`,
  )(
    { routeDistanceIndex: { total: 1000 }, currentRouteProgressDistance: 500 },
    { pointAtDistance: (_index, meters) => [meters, 0] },
  );
  const noisyRegression = stabilizeNavigationProgress(
    { coordinate: [480, 0], routeDistanceMeters: 480, remaining: 520, distance: 4 },
    { routeMatched: false },
  );
  assert.equal(noisyRegression.routeDistanceMeters, 500);
  assert.deepEqual(noisyRegression.coordinate, [500, 0]);
  const offRouteReading = { coordinate: [480, 0], routeDistanceMeters: 480, remaining: 520, distance: 80 };
  assert.equal(stabilizeNavigationProgress(offRouteReading, { routeMatched: false }), offRouteReading);
  const startTripSource = html.slice(
    html.indexOf("async function startTrip"),
    html.indexOf("const ARRIVAL_RADIUS_M"),
  );
  assert.ok(
    startTripSource.indexOf("createVehicleMarker(state.driveMap") <
      startTripSource.indexOf('state.driveMap.on("load"'),
    "la flecha debe crearse antes de esperar la carga completa del mapa",
  );

  const rerouteStart = html.indexOf("const REROUTE_COOLDOWN_MS=");
  const rerouteSource = html.slice(
    rerouteStart,
    html.indexOf("async function requestWakeLock"),
  );
  const detectionEnd = html.indexOf("function clearRerouteRetry", rerouteStart);
  const rerouteDetection = Function(
    `${html.slice(rerouteStart, detectionEnd)}; return {offRouteThresholdMeters, headingDifference, reliableOffRouteSample};`,
  )();
  assert.equal(rerouteDetection.reliableOffRouteSample({ distance: 50, accuracy: 10, speed: 5, heading: 0, routeHeading: 0 }), true);
  assert.equal(rerouteDetection.reliableOffRouteSample({ distance: 25, accuracy: 10, speed: 5, heading: 90, routeHeading: 0 }), true);
  assert.equal(rerouteDetection.reliableOffRouteSample({ distance: 50, accuracy: 70, speed: 5, heading: 0, routeHeading: 0 }), false);
  assert.equal(rerouteDetection.reliableOffRouteSample({ distance: 50, accuracy: 10, speed: 0, heading: 0, routeHeading: 0 }), false);
  assert.equal(rerouteDetection.reliableOffRouteSample({ distance: 25, accuracy: 10, speed: 5, heading: 5, routeHeading: 0 }), true, "una caletera paralela debe activar el recálculo");
  assert.equal(rerouteDetection.reliableOffRouteSample({ distance: 12, accuracy: 10, speed: 5, heading: 5, routeHeading: 0 }), false);
  assert.doesNotMatch(rerouteSource, /NavigationCameraController\.recenter\(\)/);
  assert.match(rerouteSource, /REROUTE_COOLDOWN_MS=4500/);
  assert.match(rerouteSource, /OFF_ROUTE_CONFIRMATIONS=3/);
  assert.match(rerouteSource, /function routeSnapToleranceMeters\(accuracy\)/);
  assert.match(rerouteSource, /function rerouteOriginRadiusMeters\(accuracy/);
  assert.match(rerouteSource, /bearingTolerance=relaxed\?55:32/);
  assert.match(rerouteSource, /const radiuses=\[radius,\.\.\.waypointRadii\.slice\(1\)\]\.join\(";"\)/);
  assert.match(rerouteSource, /radiuses=\$\{encodeURIComponent\(radiuses\)\}/);
  assert.match(rerouteSource, /data\?\.code==="NoSegment"/);
  assert.match(rerouteSource, /fetch\(url,\{signal:controller\.signal\}\)/);
  assert.match(rerouteSource, /setTimeout\(\(\)=>controller\.abort\(\),REROUTE_TIMEOUT_MS\)/);
  assert.match(rerouteSource, /scheduleRerouteRetry/);
  assert.doesNotMatch(rerouteSource, /radiuses=75%3Bunlimited/);
  assert.match(rerouteSource, /bearings=/);
  assert.match(rerouteSource, /avoid_maneuver_radius=/);
  assert.match(rerouteSource, /freshLocation=LocationManager\.getState\(\)/);
  assert.match(rerouteSource, /animateVehicleMarker\(state\.driveVehicleMarker,aligned\)/);
  assert.match(html, /rerouting\?\{\.\.\.position,routeMatched:false\}:routeAlignedNavigationPosition/);
  assert.match(html, /state\.offRouteCount>=OFF_ROUTE_CONFIRMATIONS/);
  assert.ok(
    rerouteSource.indexOf("response=await fetch") < rerouteSource.indexOf("state.route=nextRoute"),
    "la ruta activa debe conservarse hasta recibir una alternativa completa",
  );
});

test("cambia manualmente entre 3D y 2D con una sola transición fluida", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const start = html.indexOf("const ManeuverCameraState=");
  const end = html.indexOf("function nearestRouteProgress", start);
  const source = html.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /CRUISING_3D/);
  assert.match(source, /automatic2d:false/);
  assert.match(source, /profile\(baseZoom\)/);
  assert.match(html, /DIMENSION_TRANSITION_DURATION_MS:1100/);
  assert.match(html, /DIMENSION_TRANSITION_MIN_DURATION_MS:480/);
  assert.match(html, /function dimensionEase\(progress\)/);
  assert.match(html, /return t\*t\*t\*\(t\*\(t\*6-15\)\+10\)/);
  assert.match(source, /map\.easeTo\(\{pitch:targetPitch,duration,easing:dimensionEase,essential:true\}\)/);
  assert.match(source, /if\(enabled\)\{applyDriveDimensionConfig\(map,true\);map\.triggerRepaint\?\.\(\)\}/);
  assert.match(source, /applyDriveDimensionConfig\(map,enabled\)/);
  assert.match(html, /NavigationCameraController\.transitionDimension\(next\)/);
  assert.doesNotMatch(html, /const MANEUVER_CAMERA_CONFIG=/);
});

test("el probador GPS recorre la ruta sin usar el GPS real ni guardar viajes falsos", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /id="testGpsRoute">Probar GPS<\/button>/);
  assert.match(html, /id="gpsSimulator"/);
  assert.match(html, /id="gpsSimulatorToggle"/);
  assert.match(html, /id="gpsSimulatorSpeed"/);
  assert.match(html, /id="gpsSimulatorRestart"/);

  const simulatorStart = html.indexOf("const GPSSimulator=(()=>");
  const simulatorEnd = html.indexOf("async function startTrip", simulatorStart);
  assert.ok(simulatorStart >= 0 && simulatorEnd > simulatorStart);
  const simulatorSource = html.slice(simulatorStart, simulatorEnd);
  assert.match(simulatorSource, /RouteDistanceCalculator\.pointAtDistance/);
  assert.match(simulatorSource, /bearingBetween\(point,ahead\)/);
  assert.match(simulatorSource, /LocationManager\.acceptSimulatedPosition\(location\.position\)/);
  assert.doesNotMatch(simulatorSource, /updateDrive\(location\)/);
  assert.match(simulatorSource, /LocationManager\.beginSimulation\(\)/);
  assert.match(simulatorSource, /LocationManager\.endSimulation\(\)/);
  const locationManagerSource = html.slice(
    html.indexOf("const LocationManager=(()=>"),
    html.indexOf("async function useGPS", html.indexOf("const LocationManager=(()=>")),
  );
  assert.match(locationManagerSource, /acceptPosition\(nativePosition,\{simulated:true\}\)/);
  assert.match(locationManagerSource, /lastVisualPosition=filterGpsVisualPosition\(lastVisualPosition,reading\)/);
  assert.match(locationManagerSource, /reading\.heading=calculateHeading\(reading\)/);
  assert.match(simulatorSource, /setInterval\(tick,TICK_MS\)/);
  assert.match(simulatorSource, /function toggle\(\)/);
  assert.match(simulatorSource, /function setSpeed\(value\)/);
  assert.match(simulatorSource, /function restart\(\)/);

  const startTripSource = html.slice(
    html.indexOf("async function startTrip"),
    html.indexOf("const ARRIVAL_RADIUS_M"),
  );
  assert.match(startTripSource, /\{simulate=false,freeDrive=false,resumeSnapshot=null\}/);
  assert.match(startTripSource, /if\(simulate\)/);
  assert.match(startTripSource, /LocationManager\.stopTracking\(\)/);
  assert.match(startTripSource, /GPSSimulator\.start\(\{speed:50\}\)/);
  const mapLoadStart = startTripSource.indexOf('state.driveMap.on("load"');
  const mapLoadEnd = startTripSource.indexOf("for(const[interaction", mapLoadStart);
  const simulatorLaunch = startTripSource.indexOf("if(simulate)GPSSimulator.start({speed:50})");
  assert.ok(mapLoadStart >= 0 && mapLoadEnd > mapLoadStart);
  assert.doesNotMatch(startTripSource.slice(mapLoadStart, mapLoadEnd), /GPSSimulator\.start/);
  assert.ok(simulatorLaunch > mapLoadEnd, "el simulador no debe esperar el evento load del mapa");

  const restoreStart = html.indexOf("function restoreStyleContent");
  const restoreEnd = html.indexOf("function initMap", restoreStart);
  const restoreSource = html.slice(restoreStart, restoreEnd);
  assert.ok(restoreSource.indexOf("addRouteLayers(map)") < restoreSource.indexOf("addLiveMapLayers(map)"));
  assert.ok(restoreSource.indexOf("renderDriveRouteProgress()") < restoreSource.indexOf("addLiveMapLayers(map)"));
  assert.match(restoreSource, /try\{addLiveMapLayers\(map\)\}catch/);
  assert.doesNotMatch(html, /OpenStreetMap|openstreetmap|data-map-provider|createOpenStreetMapStyle/);
  assert.match(html, /const MAPBOX_STANDARD_STYLE="mapbox:\/\/styles\/mapbox\/standard"/);
  assert.match(html, /function standardBasemapProperties/);
  assert.match(html, /show3dObjects:enabled,show3dBuildings:enabled/);
  assert.match(html, /showPointOfInterestLabels:true/);
  assert.match(html, /function requiresAndroidRasterCompatibility/);
  assert.match(html, /MAX_VERTEX_UNIFORM_VECTORS/);
  assert.match(html, /function getMapStyle\(\)\{return requiresAndroidRasterCompatibility\(\)\?androidRasterMapStyle\(\):MAPBOX_STANDARD_STYLE\}/);
  assert.match(html, /function installAndroidMapCompatibilityFallback/);
  assert.match(html, /GL_MAX_VERTEX_UNIFORM\|Failed to link program/);
  assert.match(html, /function navigationPitch\(\)\{return state\.drive3d\?NAVIGATION_CAMERA_CONFIG\.PITCH_CRUISING:0\}/);
  assert.match(html, /id="home3dToggle"/);
  assert.match(html, /id="driveView3d"/);
  assert.match(html, /id="driveView2d"/);
  assert.match(html, /id="driveNorthUp"/);

  const finishTripSource = html.slice(
    html.indexOf("async function finishTrip"),
    html.indexOf("function tripHTML"),
  );
  assert.match(finishTripSource, /const wasSimulation=GPSSimulator\.isActive\(\)\|\|state\.gpsSimulationActive/);
  assert.match(finishTripSource, /const shouldSave=\(arrived\|\|saveTrip\)&&!wasSimulation/);
  assert.match(finishTripSource, /Simulación completada/);
  assert.match(html, /if\(state\.gpsSimulationActive\)return/);
});

test("permite conducir con GPS real sin elegir destino", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /id="newTripFreeDrive"/);
  assert.match(html, /Velocidad, tráfico, cámaras y registro del recorrido/);
  assert.doesNotMatch(html, /Conducir sin destino estará disponible próximamente/);
  assert.match(html, /async function startTrip\(\{simulate=false,freeDrive=false,resumeSnapshot=null\}=\{\}\)/);
  assert.match(html, /if\(!freeDrive&&!resuming&&!state\.destination\)/);
  assert.match(html, /state\.freeDriveActive=freeDrive/);
  assert.match(html, /if\(state\.freeDriveActive\)\{/);
  assert.match(html, /startTrip\(\{freeDrive:true\}\)/);
  assert.match(html, /to:wasFreeDrive\?"Recorrido libre"/);
  assert.match(html, /completion:wasFreeDrive\?"free-drive"/);
});

test("inicia conducción libre automáticamente al confirmar movimiento GPS", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /const AutoFreeDriveController=\(\(\)=>\{/);
  assert.match(html, /START_SPEED_MPS=3\.3/);
  assert.match(html, /REQUIRED_MOVING_SAMPLES=3/);
  assert.match(html, /REARM_STOP_MS=8000/);
  assert.match(html, /MAX_ACCURACY_M=50/);
  assert.match(html, /AutoFreeDriveController\.update\(location\)/);
  assert.match(html, /document\.visibilityState!=="visible"/);
  assert.match(html, /routePanelOpen/);
  assert.match(html, /void startTrip\(\{freeDrive:true\}\)/);
  assert.match(html, /AutoFreeDriveController\.suppressUntilStop\(\)/);
});

test("restaura una navegación real después de salir o recargar la app", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /const ACTIVE_TRIP_STORAGE_KEY="clarify\.activeTrip\.v1"/);
  assert.match(html, /function persistActiveTrip\(\{force=false\}=\{\}\)/);
  assert.match(html, /ACTIVE_TRIP_PERSIST_INTERVAL_MS=8000/);
  assert.match(html, /state\.arrivalFinalizing\|\|state\.gpsSimulationActive/);
  assert.match(html, /activeTripId=resuming\?/);
  assert.match(html, /activeSnapshotAlreadySaved\(snapshot\)/);
  assert.match(html, /track:sampledTrackCoordinates\(state\.track,1200\)/);
  assert.match(html, /function readActiveTripSnapshot\(\)/);
  assert.match(html, /async function restoreActiveTrip\(\)/);
  assert.match(html, /startTrip\(\{resumeSnapshot:snapshot\}\)/);
  assert.match(html, /persistActiveTrip\(\{force:true\}\);return/);
  assert.match(html, /window\.addEventListener\("pagehide",\(\)=>persistActiveTrip\(\{force:true\}\)\)/);
  assert.match(html, /initMapWithHostedToken\(\)\.then\(\(\)=>restoreActiveTrip\(\)\)/);
  assert.match(html, /clearActiveTripSnapshot\(\);\s*cancelActiveReroute/);
  const upsertStart = html.indexOf("function upsertTripRecord");
  const upsertEnd = html.indexOf("function saveTrips", upsertStart);
  const upsertTripRecord = Function(`${html.slice(upsertStart, upsertEnd)}; return upsertTripRecord;`)();
  const merged = upsertTripRecord([{ id: "same", total: 100 }, { id: "other", total: 20 }], { id: "same", total: 150 });
  assert.deepEqual(merged, [{ id: "same", total: 150 }, { id: "other", total: 20 }]);
});

test("mantiene la pantalla encendida durante la navegación activa", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /let wakeLockWanted=false,wakeLockRequestPending=false,wakeLockRetryTimer=null/);
  assert.match(html, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(html, /lock\.addEventListener\("release"/);
  assert.match(html, /scheduleWakeLockRetry\(500\)/);
  assert.match(html, /document\.visibilityState!=="visible"/);
  assert.match(html, /#driveMode","pointerdown"[\s\S]*?requestWakeLock\(\)/);
  assert.match(html, /wakeLockWanted=false;clearWakeLockRetry\(\)/);
});

test("Mapbox Standard cambia automáticamente entre luz de día y noche", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const start = html.indexOf("const MAP_DAY_START_MINUTES=");
  const end = html.indexOf("function standardMapConfig", start);
  assert.ok(start >= 0 && end > start);
  const preferredMapLightPreset = Function(
    `${html.slice(start, end)}; return preferredMapLightPreset;`,
  )();

  assert.equal(preferredMapLightPreset(new Date(2026, 7, 3, 6, 59)), "night");
  assert.equal(preferredMapLightPreset(new Date(2026, 7, 3, 7, 0)), "day");
  assert.equal(preferredMapLightPreset(new Date(2026, 7, 3, 19, 59)), "day");
  assert.equal(preferredMapLightPreset(new Date(2026, 7, 3, 20, 0)), "night");
  assert.match(html, /lightPreset:effectiveMapLightPreset\(\)/);
  assert.match(html, /setInterval\(syncMapLightPreset,60\*1000\)/);
  assert.match(html, /setConfigProperty\("basemap","lightPreset",preset\)/);
  assert.match(html, /classList\.toggle\("navigation-dark",night\)/);
  assert.match(html, /document\.documentElement\.classList\.toggle\("app-dark",night\)/);
  assert.match(html, /\/\* COMPLETE APP DARK THEME \*\//);
  assert.match(html, /html\.app-dark\{color-scheme:dark/);
  assert.match(html, /html\.app-dark \.bottom-nav/);
  assert.match(html, /html\.app-dark \.modal-card/);
  assert.match(html, /html\.app-dark \.history-screen/);
  assert.match(html, /html\.app-dark \.route-choice\{/);
  assert.match(html, /html\.app-dark \.route-actions\{/);
  assert.match(html, /html\.app-dark \.history-donut::after/);
  assert.match(html, /html\.app-dark \.drive-mode\.navigation-dark \.drive-speed/);
  assert.match(html, /id="homeLightToggle"/);
  assert.match(html, /id="driveLightToggle"/);
  assert.match(html, /const modes=\["auto","night","day"\]/);
  assert.match(html, /localStorage\.setItem\(MAP_LIGHT_OVERRIDE_KEY,state\.mapLightOverride\)/);
  assert.match(html, /restoreMapLightOverride\(\);syncOptionalLayerControls/);
});

test("aplica una paleta ejecutiva coherente en modo claro y oscuro", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /EXECUTIVE PALETTE/);
  assert.match(html, /--green:#173b57/);
  assert.match(html, /--lime:#d7b96f/);
  assert.match(html, /html\.app-dark\{--bg:#0b1118/);
  assert.match(html, /--nav-header:rgba\(20,47,69,\.97\)/);
  assert.match(html, /feature-setting-row\[aria-pressed="true"\] \.feature-switch\{background:#315f7d\}/);
});

test("SearchManager controla concurrencia, estados y búsquedas recientes", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const managerStart = html.indexOf("const SearchManager=(()=>");
  const managerEnd = html.indexOf("async function reverseGeocode", managerStart);
  assert.ok(managerStart >= 0 && managerEnd > managerStart);
  const managerSource = html.slice(managerStart, managerEnd);

  assert.match(managerSource, /new AbortController\(\)/);
  assert.match(managerSource, /controller\?\.abort\(\)/);
  assert.match(managerSource, /id!==requestId/);
  assert.match(managerSource, /MAX_RECENTS=10/);
  assert.match(managerSource, /ruta\.searchHistory/);
  assert.match(managerSource, /localStorage\.removeItem\(HISTORY_KEY\)/);
  assert.match(managerSource, /remember:saveRecent/);
  assert.match(managerSource, /Buscando destinos/);
  assert.match(managerSource, /Sin resultados/);
  assert.match(html, /SearchManager\.queue/);
  assert.match(html, /id="searchHistory"/);
  assert.match(html, /SearchManager\.showRecent\(\{force:true\}\)/);
  assert.match(html, /function searchProximity\(\)/);
  assert.match(html, /LocationManager\.getState\(\)/);
  assert.match(html, /search\/searchbox\/v1\/suggest/);
  assert.match(html, /search\/searchbox\/v1\/retrieve/);
});

test("el buscador resuelve la ruta con un solo toque y evita solicitudes duplicadas", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /function directSearch\(\)\{return SearchManager\.search\(\$\("#destinationInput"\)\.value,\{autoSelect:true\}\)\}/);
  assert.match(html, /if\(busy\)return null/);
  assert.match(html, /button\.disabled=busy/);
  assert.match(html, /else if\(autoSelect\)await select\(0\)/);
  assert.match(html, /id="searchBtn" type="button"/);
});

test("permite hasta cinco paradas y las conserva al recalcular", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /id="addRouteStop"/);
  assert.match(html, /id="routeStopList"/);
  assert.match(html, /state\.routeStops\.length>=5/);
  assert.match(html, /function routeWaypointCoordinates\(origin,\{remaining=!!state\.tripStart\}=\{\}\)/);
  assert.match(html, /routeWaypointString\(origin,\{remaining:false\}\)/);
  assert.match(html, /routeWaypointCoordinates\(p,\{remaining:true\}\)/);
  assert.match(html, /consumeReachedRouteStop\(p,accuracy\)/);
  assert.match(html, /remainingStops:state\.remainingStops/);
});

test("Android reproduce las indicaciones por el canal multimedia de navegación", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const java = await readFile(new URL("../android-app/app/src/main/java/cl/clarify/app/MainActivity.java", import.meta.url), "utf8");
  assert.match(html, /ClarifyAndroid\?\.stopNavigationSpeech/);
  assert.match(html, /ClarifyAndroid\.speakNavigation\(message,voiceKey\)/);
  assert.match(java, /USAGE_ASSISTANCE_NAVIGATION_GUIDANCE/);
  assert.match(java, /AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK/);
  assert.match(java, /@JavascriptInterface public boolean speakNavigation/);
  assert.match(java, /navigationTts\.shutdown\(\)/);
});

test("Android abre la cámara o galería para adjuntar la boleta", async () => {
  const [java, manifest] = await Promise.all([
    readFile(mainActivityUrl, "utf8"),
    readFile(androidManifestUrl, "utf8"),
  ]);
  assert.match(java, /onShowFileChooser/);
  assert.match(java, /MediaStore\.ACTION_IMAGE_CAPTURE/);
  assert.match(java, /FileProvider\.getUriForFile/);
  assert.match(java, /params\.isCaptureEnabled\(\)/);
  assert.match(manifest, /androidx\.core\.content\.FileProvider/);
  assert.match(manifest, /@xml\/file_paths/);
});

test("procesa cada ruta con costos independientes y etiquetas comparables", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const optionStart = html.indexOf("function routeOptionToll");
  const optionEnd = html.indexOf("function routeSignature", optionStart);
  const optionSource = html.slice(optionStart, optionEnd);
  const buildRouteOption = Function(
    "calcRouteTolls",
    "tollRate",
    "fuelCostForKm",
    "routeHasToll",
    `${optionSource}; return buildRouteOption;`,
  )(
    () => [{ _rate: { price: 1500 } }],
    () => ({ price: 0 }),
    (km) => km * 100,
    () => true,
  );
  const route = {
    distance: 10000,
    duration: 900,
    geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
    legs: [],
  };
  const option = buildRouteOption("tag", route, 0);
  assert.equal(option.distanceKm, 10);
  assert.equal(option.durationMin, 15);
  assert.equal(option.fuelCost, 1000);
  assert.equal(option.tollCost, 1500);
  assert.equal(option.totalCost, 2500);
  assert.equal(option.costPerKm, 250);

  const labelsStart = html.indexOf("function labelRouteOptions");
  const labelsEnd = html.indexOf("function routeDifference", labelsStart);
  const labelRouteOptions = Function(
    `${html.slice(labelsStart, labelsEnd)}; return labelRouteOptions;`,
  )();
  const split = labelRouteOptions([
    { durationSec: 600, totalCost: 3000 },
    { durationSec: 660, totalCost: 2000 },
    { durationSec: 720, totalCost: 3500 },
  ]);
  assert.deepEqual(
    split.map((item) => item.label),
    ["MÁS RÁPIDA", "MÁS ECONÓMICA", "ALTERNATIVA"],
  );
  assert.equal(
    labelRouteOptions([
      { durationSec: 600, totalCost: 2000 },
      { durationSec: 660, totalCost: 3000 },
    ])[0].label,
    "RECOMENDADA",
  );
});

test("RouteManager limita a tres rutas y seleccionar no consulta Directions", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const managerStart = html.indexOf("const RouteManager=(()=>");
  const managerEnd = html.indexOf("function chooseRouteOption", managerStart);
  assert.ok(managerStart >= 0 && managerEnd > managerStart);
  const managerSource = html.slice(managerStart, managerEnd);
  const selectStart = managerSource.indexOf("function selectRoute");
  const mergeStart = managerSource.indexOf("function mergeCandidates");
  const selectSource = managerSource.slice(selectStart, mergeStart);

  assert.match(html, /const RouteState=Object\.freeze/);
  assert.match(html, /routes:\[\],selectedRouteIndex:-1/);
  assert.match(managerSource, /driving-traffic/);
  assert.match(managerSource, /alternatives=true/);
  assert.match(managerSource, /slice\(0,3\)/);
  assert.match(managerSource, /Promise\.allSettled/);
  assert.match(managerSource, /controller\?\.abort\(\)/);
  assert.doesNotMatch(selectSource, /fetch\(/);
  assert.match(selectSource, /state\.selectedRouteIndex=index/);
  assert.match(html, /line-opacity":\.42/);
  assert.match(html, /line-color":"#1769e0"/);
  assert.match(html, /haversine\(state\.previewOrigin,point\)>75/);

  const testState = {
    routes: [
      { id: "tag-0", mode: "tag", route: { legs: [{ steps: ["uno"] }] }, tolls: [], hasToll: false },
      { id: "free-0", mode: "free", route: { legs: [{ steps: ["dos"] }] }, tolls: [], hasToll: false },
    ],
    selectedRouteIndex: 0,
  };
  let lineRenders = 0;
  let cardRenders = 0;
  const manager = Function(
    "state",
    "RouteProgressTracker",
    "TollAvoidanceManager",
    "renderRouteLines",
    "fitRouteOptions",
    "showRouteCard",
    "RouteState",
    "getMapboxToken",
    "$",
    "renderRouteStatus",
    "toast",
    "fetchDirectionsRoutes",
    "routeSignature",
    "routeHasToll",
    "calcRouteTolls",
    "labelRouteOptions",
    "buildRouteOption",
    `${managerSource}; return RouteManager;`,
  )(
    testState,
    { setRoute: () => ({ total: 1000 }), reset() {} },
    { onRouteChanged() {}, invalidate() {} },
    () => {
      lineRenders += 1;
    },
    () => {},
    () => {
      cardRenders += 1;
    },
    { IDLE: "IDLE", CALCULATING: "CALCULATING", READY: "READY", ERROR: "ERROR" },
    () => "",
    () => ({ classList: { add() {}, remove() {} } }),
    () => {},
    () => {},
    async () => [],
    () => "",
    () => false,
    () => [],
    (routes) => routes,
    () => ({}),
  );
  manager.selectRoute(1);
  assert.equal(testState.selectedRouteIndex, 1);
  assert.equal(testState.route, testState.routes[1].route);
  assert.equal(testState.routeMode, "free");
  assert.deepEqual(testState.routeSteps, ["dos"]);
  assert.equal(lineRenders, 1);
  assert.equal(cardRenders, 1);
});

test("presenta una capa Android mobile-first sin reemplazar los motores", async () => {
  const html = await readFile(sourceUrl, "utf8");

  assert.match(html, /--bottom-nav-height:68px/);
  assert.match(html, /--touch-size:48px/);
  assert.match(html, /overflow-x:hidden/);
  assert.match(html, /overflow-x:clip;overflow-y:visible/);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /min-height:100dvh/);
  assert.match(html, /class="mobile-app-header"/);
  assert.match(html, /class="mobile-wordmark" aria-label="Clarify">Clarify</);
  assert.match(html, /class="icon-button mobile-menu-button"/);
  assert.match(html, /class="hamburger-lines"/);
  assert.match(html, /function syncMobileSearchLayout\(\)/);
  assert.match(html, /header\.insertBefore\(search,\$\("\.mobile-menu-button"\)\)/);
  assert.match(html, /grid-template-areas:"wordmark search menu"/);
  assert.match(html, /grid-template-columns:max-content minmax\(0,1fr\) 44px/);
  assert.match(html, /class="search-leading-icon"/);
  assert.match(html, /mobile-app-header \.search-btn\{min-width:76px/);
  assert.match(html, /\.map-search\.mobile-search-hidden\{display:none\}/);
  assert.match(html, /classList\.toggle\("mobile-search-hidden",name!=="summary"\)/);
  assert.match(html, /class="bottom-nav"/);
  assert.match(html, /class="bottom-nav-add"/);
  assert.match(html, /class="sheet-layer hidden" id="newTripSheet"/);
  assert.match(html, /\.origin-row\{display:none\}/);
  assert.match(html, /\.map-pick-hint\{display:none\}/);
  assert.match(html, /class="route-card-scroll"/);
  assert.match(html, /\.route-card\{max-height:52dvh/);
  assert.match(html, /\.route-choices\{display:flex;overflow-x:auto/);
  assert.match(html, /#summaryView:has\(#routeCard:not\(\.hidden\)\)/);
  assert.match(html, /active\.offsetLeft-\(box\.clientWidth-active\.offsetWidth\)\/2/);
  assert.match(html, /id="vehicleReadCard"/);
  assert.match(html, /id="vehicleEditor"/);
  assert.match(html, /id="driveVoice"/);
  assert.match(html, /id="driveViewOptions"/);
  assert.match(html, /#centerDrive::before\{content:none!important\}/);
  assert.doesNotMatch(html, />◎ Centrar</);

  const locationStart = html.indexOf("const LocationManager=(()=>");
  const locationEnd = html.indexOf("async function useGPS", locationStart);
  const routeStart = html.indexOf("const RouteManager=(()=>");
  const routeEnd = html.indexOf("function chooseRouteOption", routeStart);
  assert.ok(locationStart >= 0 && locationEnd > locationStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(html.slice(locationStart, locationEnd), /watchPosition/);
  assert.match(html.slice(routeStart, routeEnd), /slice\(0,3\)/);
});

test("la navegación activa compacta mantiene mapa, progreso, TAG y costos accesibles", async () => {
  const html = await readFile(sourceUrl, "utf8");

  assert.match(html, /class="drive-mode navigation-light hidden"/);
  assert.match(html, /html:has\(#driveMode:not\(\.hidden\)\),body:has\(#driveMode:not\(\.hidden\)\)\{overflow:hidden\}/);
  assert.match(html, /height:100vh;height:100dvh/);
  assert.match(html, /class="next-maneuver hidden" id="nextManeuver"/);
  assert.match(html, /id="nextInstructionDistance"/);
  assert.match(html, /id="nextInstructionRoad"/);
  assert.match(html, /id="gpsDriveStatus"/);
  assert.match(html, /id="navigationStateChip"/);
  assert.match(html, /id="driveSpeed"/);
  assert.match(html, /id="driveSpeedLimit"/);
  assert.match(html, /id="driveSpeedLimitValue"/);
  assert.match(html, /id="driveSpeedLimitLabel">sin dato/);
  assert.match(html, /indicator\.classList\.remove\("hidden"\)/);
  assert.match(html, /now-state\.lastValidDriveSpeedAt>12000/);
  assert.doesNotMatch(html, /indicator\.classList\.toggle\("hidden",!valid\)/);
  assert.match(html, /\.drive-speed-limit\.is-estimated\{border-style:dashed\}/);
  assert.match(html, /\.drive-speed-limit\.is-unavailable\{/);
  assert.match(html, /\.drive-speed-limit\{/);
  assert.match(html, /\/\* COMBINED LIVE SPEEDOMETER \*\//);
  assert.match(html, /\.drive-speed\{left:max\(9px,[\s\S]*?width:72px;height:72px/);
  assert.match(html, /repeating-conic-gradient\(#7f888d 0 3deg,transparent 3deg 9deg\)/);
  assert.match(html, /\.drive-speed-limit\{z-index:106;left:max\(59px,[\s\S]*?width:48px;height:48px/);
  assert.match(html, /\.drive-mode\.is-simulating \.drive-speed-limit\{bottom:calc\(200px/);
  assert.match(html, /\/\* DYNAMIC NAVIGATION SAFE ZONE \*\//);
  assert.match(html, /\.drive-speed\{bottom:var\(--drive-bottom-clearance\)\}/);
  assert.match(html, /\.drive-toll-alert\{left:max\(118px,[\s\S]*?bottom:calc\(var\(--drive-bottom-clearance\) \+ 4px\)/);
  assert.match(html, /bottom\?\.getBoundingClientRect\(\)\.height\|\|0/);
  assert.match(html, /new ResizeObserver\(refreshNavigationLayout\)/);
  assert.match(html, /for\(const element of\[\$\("#driveBottom"\),\$\("#driveBanner"\),\$\("#driveProximityStack"\)\]\)/);
  assert.match(html, /--drive-proximity-max-height/);
  assert.match(html, /\/\* CLEAN SPEED LIMIT SIGN \*\//);
  assert.match(html, /\.drive-speed-limit\{left:max\(58px,[\s\S]*?width:38px;height:38px;border:3px solid #e94f43/);
  assert.match(html, /border-style:solid!important;overflow:hidden;isolation:isolate/);
  assert.match(html, /\.drive-speed-limit strong\{font-size:17px/);
  assert.match(html, /annotations=duration%2Cdistance%2Ccongestion_numeric%2Cmaxspeed/);
  assert.match(html, /renderDriveSpeedLimit\(state\.currentRouteProgressDistance\)/);
  assert.match(html, /SpeedLimitResolver\.resolve\(state\.speedLimitProfile,routeDistanceMeters\)/);
  assert.match(html, /indicator\.classList\.remove\("hidden"\)/);
  assert.match(html, /!state\.currentSpeedLimitEstimated&&Number\.isFinite\(state\.currentSpeedLimitKph\)/);
  assert.match(html, /id="driveViewSheet"/);
  assert.match(html, /id="driveCostButton"/);
  assert.match(html, /id="driveCostSheet"/);
  assert.match(html, /id="driveCostFuel"/);
  assert.match(html, /id="driveCostToll"/);
  assert.match(html, /id="driveCostOther"/);
  assert.match(html, /id="driveCostTotal"/);
  assert.match(html, /id="driveProximityStack"/);
  assert.match(html, /id="driveFuelAlert"/);
  assert.match(html, /id="completeTrip"[^>]*>Finalizar<\/button>/);
  assert.match(html, /id="exitTrip"[^>]*>Salir<\/button>/);
  assert.match(html, /grid-template-columns:minmax\(0,1fr\) auto auto/);
  assert.match(html, /\.drive-finish-button\{min-width:78px/);
  assert.match(html, /\.drive-fab\{width:48px;height:48px/);
  assert.match(html, /@media\(max-width:390px\)/);
  assert.match(html, /@media\(max-width:360px\)/);
  assert.match(html, /navigation-dark/);
  assert.match(html, /\/\* MINIMAL ACTIVE NAVIGATION \*\//);
  assert.match(html, /\.drive-mode \.maneuver-card\{width:min\(460px,100%\);grid-template-columns:42px/);
  assert.match(html, /\.drive-toll-exit-row\{display:none\}/);
  assert.match(html, /\.gps-simulator\{left:max\(9px,env\(safe-area-inset-left\)\);right:max\(61px/);
  assert.match(html, /\.drive-cost-row span em\{display:none\}/);
  assert.match(html, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(html, /\.drive-guidance-stats,\.drive-bottom-row\{display:contents\}/);
  assert.match(html, /\.drive-live-traffic\{position:absolute;left:50%;top:0/);
  assert.match(html, /\.drive-finish-button\{grid-column:1\/3/);
  assert.match(html, /\.drive-exit-button\{grid-column:3\/5/);
  assert.match(html, /freeDrive\?"costo\/km":"llegada"/);
  assert.match(html, /\$\("#driveTimeLabel"\)\.textContent="tiempo"/);
  assert.match(html, /CLP\.format\(km>0\?cost\.total\/km:0\)/);
  assert.match(html, /return\{fuel,toll,other,total:fuel\+toll\+other\}/);
  assert.match(html, /\.drive-proximity-stack\{position:absolute/);
  assert.match(html, /drive-proximity-icon camera/);
  assert.match(html, /drive-proximity-icon tag/);
  assert.match(html, /drive-proximity-icon fuel/);
  assert.match(html, /const FuelStationAlertManager=\(\(\)=>\{/);
  assert.match(html, /CameraAlertManager\.update\(\);FuelStationAlertManager\.update\(\)/);
  assert.match(html, /\.drive-proximity-stack\{bottom:calc\(var\(--drive-bottom-clearance\) \+ 152px\)\}/);
  assert.match(html, /\.drive-guidance-stats>div:nth-child\(3\) strong\{font-size:14px/);
  assert.match(html, /\.route-actions\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(html, /#startTrip\{grid-column:1\/-1\}/);
  assert.match(html, /#cancelRoute,#testGpsRoute\{display:block!important/);
  assert.match(html, /\.route-card\{position:fixed;z-index:89;top:auto/);
  assert.match(html, /bottom:calc\(var\(--bottom-nav-height\) \+ env\(safe-area-inset-bottom\) \+ 8px\)/);

  assert.match(html, /id:"route-shadow"[\s\S]*?"line-width":16/);
  assert.match(html, /id:"route-traveled-line"[\s\S]*?"line-width":9/);
  assert.match(html, /id:"route-line"[\s\S]*?"line-width":9/);
  assert.match(html, /setSourceData\(state\.driveMap,"route-traveled"/);
  assert.match(html, /if\(distance<=30\)return"AHORA"/);
  assert.match(html, /REROUTING/);
  assert.match(html, /GPS_WEAK/);
  assert.match(html, /ARRIVING/);
  assert.match(html, /data-avoid-toll=/);
  assert.match(html, /drive-toll-exit-row/);
  assert.match(html, /\.drive-toll-alert\{[\s\S]*?display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(html, /\.drive-toll-alert button\{grid-column:2;grid-row:3;min-height:44px/);

  const splitStart = html.indexOf("function splitRouteGeometryByProgress");
  const splitEnd = html.indexOf("function routeLineCollection", splitStart);
  assert.ok(splitStart >= 0 && splitEnd > splitStart);
  const splitRouteGeometryByProgress = Function(
    `${html.slice(splitStart, splitEnd)}; return splitRouteGeometryByProgress;`,
  )();
  const route = {
    geometry: { coordinates: [[0, 0], [1, 0], [2, 0]] },
  };
  const split = splitRouteGeometryByProgress(
    route,
    { cumulative: [0, 100, 200], total: 200 },
    150,
  );
  assert.deepEqual(split.traveled.at(-1), [1.5, 0]);
  assert.deepEqual(split.remaining[0], [1.5, 0]);
  assert.deepEqual(split.remaining.at(-1), [2, 0]);
});

test("selecciona un destino manual solo después de una pulsación larga", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const clickStart = html.indexOf("async function handleMapClick");
  const clickEnd = html.indexOf("async function chooseManualMapDestination", clickStart);
  const manualEnd = html.indexOf("async function selectDestination", clickEnd);
  assert.ok(clickStart >= 0 && clickEnd > clickStart && manualEnd > clickEnd);

  const clickSource = html.slice(clickStart, clickEnd);
  const manualSource = html.slice(clickEnd, manualEnd);
  assert.match(html, /const MAP_LONG_PRESS_MS=2000/);
  assert.match(html, /MAP_LONG_PRESS_MOVE_TOLERANCE_PX=12/);
  assert.match(html, /canvas\.addEventListener\("pointerdown"/);
  assert.match(html, /canvas\.addEventListener\("pointermove"/);
  assert.match(html, /canvas\.addEventListener\("pointercancel"/);
  assert.match(html, /setupMapLongPress\(state\.map\)/);
  assert.match(html, /Mantén pulsado 2 segundos/);
  assert.doesNotMatch(clickSource, /reverseGeocode|selectDestination/);
  assert.match(clickSource, /route-alternatives-line/);
  assert.match(manualSource, /reverseGeocode\(coord\)/);
  assert.match(manualSource, /selectDestination\(\{coord,name,address:name,type:"address"\}\)/);
});

test("guarda al llegar o finalizar manualmente, pero salir descarta el viaje", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const arrivalMatch = html.match(
    /const ARRIVAL_RADIUS_M=(\d+),ARRIVAL_ROUTE_RADIUS_M=\d+,ARRIVAL_ACCURACY_LIMIT_M=(\d+),ARRIVAL_CONFIRMATION_COUNT=(\d+);\s*(function arrivalSampleReached\(distanceM,accuracy\)\{[\s\S]*?\n\})/,
  );
  assert.ok(arrivalMatch, "debe existir una regla explícita de llegada");

  const [, radius, accuracyLimit, confirmations, functionSource] = arrivalMatch;
  const arrivalSampleReached = Function(
    `"use strict"; const ARRIVAL_RADIUS_M=${radius},ARRIVAL_ACCURACY_LIMIT_M=${accuracyLimit}; ${functionSource}; return arrivalSampleReached;`,
  )();

  assert.equal(Number(confirmations), 3);
  assert.equal(arrivalSampleReached(Number(radius), 20), true);
  assert.equal(arrivalSampleReached(Number(radius) + 1, 20), false);
  assert.equal(arrivalSampleReached(10, Number(accuracyLimit) + 1), false);

  const finishStart = html.indexOf("async function finishTrip({arrived=false,saveTrip=false}={})");
  const finishEnd = html.indexOf("function tripHTML", finishStart);
  const finishSource = html.slice(finishStart, finishEnd);
  assert.match(finishSource, /const shouldSave=\(arrived\|\|saveTrip\)&&!wasSimulation/);
  assert.match(finishSource, /if\(shouldSave\)\{/);
  assert.match(finishSource, /completion:wasFreeDrive\?"free-drive":arrived\?"arrival":"manual"/);
  assert.match(finishSource, /saveTrip&&!arrived/);
  assert.match(finishSource, /saveTrips\(upsertTripRecord\(getTrips\(\),trip\)\)/);
  assert.match(finishSource, /id:activeTripId\|\|uuid\(\)/);
  assert.match(finishSource, /state\.tripStart=null;activeTripId=""/);
  assert.match(finishSource, /El viaje no se guardó/);
  assert.match(html, /#completeTrip","click",\(\)=>void finishTrip\(\{arrived:hasReachedDestination\(\),saveTrip:true\}\)/);
  assert.match(html, /#exitTrip","click",\(\)=>void finishTrip\(\)/);
  assert.match(html, /routeReached=validAccuracy<=ARRIVAL_ACCURACY_LIMIT_M&&state\.routeRemainingM<=ARRIVAL_ROUTE_RADIUS_M/);
  assert.match(html, /remainingM=Math\.max\(0,state\.routeRemainingM\?\?state\.route\?\.distance\?\?0\)/);
});

test("mantiene coherentes ruta, maniobras y datos de conducción libre", async () => {
  const html = await readFile(sourceUrl, "utf8");
  assert.match(html, /if\(state\.driveMap\?\.getSource\("route"\)\)renderDriveRouteProgress\(state\.currentRouteProgressDistance\)/);
  assert.doesNotMatch(html, /if\(state\.map\?\.getSource\("route"\)\)setSourceData\(state\.map,"route",routeLineCollection\(nextRoute/);
  assert.match(html, /function buildRouteStepDistances\(steps,totalDistance\)/);
  assert.match(html, /state\.routeStepDistances=buildRouteStepDistances\(state\.routeSteps/);
  assert.match(html, /sequentialDistance=state\.routeStepDistances\?\.\[stepIndex\]/);
  assert.match(html, /const FreeDriveSpeedLimitController=/);
  assert.match(html, /annotations:"maxspeed"/);
  assert.match(html, /FreeDriveSpeedLimitController\.update\(position\)/);
  assert.match(html, /freeDrive\?"recorrido":"restante"/);
  assert.match(html, /lateralDistance=distance\*Math\.sin/);
  assert.match(html, /--drive-banner-clearance/);
});

test("calcula distancia sobre la ruta, ordena pórticos y formatea navegación", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const toolkitStart = html.indexOf("const MIN_EXIT_BEFORE_TOLL_METERS=");
  const toolkitEnd = html.indexOf("function routeHitsToll", toolkitStart);
  assert.ok(toolkitStart >= 0 && toolkitEnd > toolkitStart);

  const haversine = (a, b) => {
    const R = 6371000;
    const radians = (value) => value * Math.PI / 180;
    const dLat = radians(b[1] - a[1]);
    const dLon = radians(b[0] - a[0]);
    const lat1 = radians(a[1]);
    const lat2 = radians(b[1]);
    const value = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(value));
  };
  const pointInPoly = (point, polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      const hit = ((a[1] > point[1]) !== (b[1] > point[1]))
        && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / ((b[1] - a[1]) || 1e-12) + a[0];
      if (hit) inside = !inside;
    }
    return inside;
  };
  const edgeFraction = (a, b, c, d) => {
    const rx = b[0] - a[0];
    const ry = b[1] - a[1];
    const sx = d[0] - c[0];
    const sy = d[1] - c[1];
    const denominator = rx * sy - ry * sx;
    if (Math.abs(denominator) < 1e-12) return null;
    const qx = c[0] - a[0];
    const qy = c[1] - a[1];
    const t = (qx * sy - qy * sx) / denominator;
    const u = (qx * ry - qy * rx) / denominator;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
  };
  const segHitsPoly = (a, b, polygon) => pointInPoly(a, polygon)
    || pointInPoly(b, polygon)
    || polygon.some((point, index) => edgeFraction(
      a,
      b,
      point,
      polygon[(index + 1) % polygon.length],
    ) !== null);
  const tollPoly = (toll) => toll.polygon.map((point) => [point[1], point[0]]);

  const toolkit = Function(
    "haversine",
    "tollPoly",
    "pointInPoly",
    "segHitsPoly",
    `${html.slice(toolkitStart, toolkitEnd)}; return {RouteDistanceCalculator, SpeedLimitResolver, candidateExitsBeforeToll, formatNavigationDistance, MIN_EXIT_BEFORE_TOLL_METERS, MIN_AVOIDANCE_DECISION_DISTANCE, MAX_AVOIDANCE_ATTEMPTS};`,
  )(haversine, tollPoly, pointInPoly, segHitsPoly);

  const route = {
    geometry: {
      coordinates: [[0, 0], [0.01, 0], [0.02, 0], [0.03, 0]],
    },
    legs: [],
  };
  const index = toolkit.RouteDistanceCalculator.buildIndex(route);
  const midpointFromIndex = toolkit.RouteDistanceCalculator.pointAtDistance(index, index.total / 2);
  const midpointFromCoordinates = toolkit.RouteDistanceCalculator.pointAtDistance(route.geometry.coordinates, index.total / 2);
  assert.ok(Math.abs(midpointFromIndex[0] - 0.015) < 1e-9);
  assert.ok(Math.abs(midpointFromIndex[1]) < 1e-9);
  assert.deepEqual(midpointFromIndex, midpointFromCoordinates);
  const speedRoute = {
    geometry: route.geometry,
    legs: [{ annotation: { maxspeed: [
      { speed: 30, unit: "km/h" },
      { speed: 50, unit: "km/h" },
      { unknown: true },
    ] } }],
  };
  const speedProfile = toolkit.SpeedLimitResolver.buildProfile(speedRoute);
  assert.equal(toolkit.SpeedLimitResolver.atDistance(speedProfile, 100), 30);
  assert.equal(toolkit.SpeedLimitResolver.atDistance(speedProfile, 1500), 50);
  assert.equal(toolkit.SpeedLimitResolver.atDistance(speedProfile, 3000), null);
  const bridgedProfile = { segments: [
    { start: 0, end: 100, kph: 50 },
    { start: 100, end: 180, kph: null },
    { start: 180, end: 280, kph: 50 },
  ] };
  assert.deepEqual(
    toolkit.SpeedLimitResolver.resolve(bridgedProfile, 140),
    { kph: 50, estimated: true, source: "matching-neighbors", distance: 40 },
  );
  const changingProfile = { segments: [
    { start: 0, end: 100, kph: 80 },
    { start: 100, end: 180, kph: null },
    { start: 180, end: 280, kph: 50 },
  ] };
  assert.deepEqual(
    toolkit.SpeedLimitResolver.resolve(changingProfile, 150),
    { kph: 50, estimated: true, source: "ahead", distance: 30 },
  );
  assert.equal(toolkit.SpeedLimitResolver.resolve(changingProfile, 500), null);
  assert.equal(toolkit.SpeedLimitResolver.normalize({ speed: 50, unit: "mph" }), 80);
  assert.equal(toolkit.SpeedLimitResolver.normalize({ none: true }), null);
  const tolls = [
    {
      id: "P2",
      polygon: [[-0.0002, 0.0218], [-0.0002, 0.0222], [0.0002, 0.0222], [0.0002, 0.0218]],
    },
    {
      id: "P1",
      polygon: [[-0.0002, 0.0078], [-0.0002, 0.0082], [0.0002, 0.0082], [0.0002, 0.0078]],
    },
  ].map((toll) => ({ ...toll, ...toolkit.RouteDistanceCalculator.locateToll(index, toll) }))
    .sort((a, b) => a.distanceFromRouteStart - b.distanceFromRouteStart);

  assert.deepEqual(tolls.map((toll) => toll.id), ["P1", "P2"]);
  const current = toolkit.RouteDistanceCalculator.locatePoint(index, [0.005, 0]);
  const distanceToP2 = tolls[1].distanceFromRouteStart - current.routeDistanceMeters;
  assert.ok(distanceToP2 > 1800 && distanceToP2 < 2000);
  assert.equal(toolkit.formatNavigationDistance(82), "80 m");
  assert.equal(toolkit.formatNavigationDistance(157), "160 m");
  assert.equal(toolkit.formatNavigationDistance(846), "850 m");
  assert.equal(toolkit.formatNavigationDistance(1120), "1,1 km");
  assert.equal(toolkit.formatNavigationDistance(3780), "3,8 km");
  assert.equal(toolkit.MIN_EXIT_BEFORE_TOLL_METERS, 500);
  assert.equal(toolkit.MIN_AVOIDANCE_DECISION_DISTANCE, 1500);
  assert.equal(toolkit.MAX_AVOIDANCE_ATTEMPTS, 4);
});

test("estima cada TAG con la hora futura en que se cruza", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const estimatorStart = html.indexOf("function estimateTollCrossingAt");
  const estimatorEnd = html.indexOf("function calcRouteTolls", estimatorStart);
  assert.ok(estimatorStart >= 0 && estimatorEnd > estimatorStart);
  const estimateTollCrossingAt = Function(
    `${html.slice(estimatorStart, estimatorEnd)}; return estimateTollCrossingAt;`,
  )();
  const departureAt = new Date("2026-07-28T21:30:00.000Z");
  const crossingAt = estimateTollCrossingAt(
    { duration: 3600, distance: 1000 },
    500,
    1000,
    departureAt,
  );
  assert.equal(crossingAt.toISOString(), "2026-07-28T22:00:00.000Z");

  const calculationSource = html.slice(
    html.indexOf("function calcRouteTolls"),
    html.indexOf("const TollEngine"),
  );
  assert.match(calculationSource, /tollRate\(t,crossingAt\)/);
  assert.match(calculationSource, /_crossingAt:crossingAt\.toISOString\(\)/);
});

test("avanza una maniobra aunque el GPS salte más allá del giro", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const helperStart = html.indexOf("const MANEUVER_REACHED_RADIUS_M=");
  const helperEnd = html.indexOf("function maneuverRouteDistance", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = Function(
    `${html.slice(helperStart, helperEnd)}; return {shouldAdvanceManeuver, MANEUVER_REACHED_RADIUS_M, MANEUVER_PASS_MARGIN_M};`,
  )();

  assert.equal(helper.shouldAdvanceManeuver(200, 1000, 900), false);
  assert.equal(helper.shouldAdvanceManeuver(30, 1000, 900), true);
  assert.equal(helper.shouldAdvanceManeuver(120, 1000, 1040), true);
  assert.equal(helper.MANEUVER_REACHED_RADIUS_M, 45);
  assert.equal(helper.MANEUVER_PASS_MARGIN_M, 35);
});

test("la voz no repite ni alterna avisos en cada lectura GPS", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const voiceStart = html.indexOf("const VOICE_RESTART_DELAY_MS=");
  const voiceEnd = html.indexOf("async function recalculateFromCurrent", voiceStart);
  assert.ok(voiceStart >= 0 && voiceEnd > voiceStart);

  const timers = new Map();
  let timerId = 0;
  const fakeSetTimeout = (callback, delay) => {
    timerId += 1;
    timers.set(timerId, { callback, delay });
    return timerId;
  };
  const fakeClearTimeout = (id) => timers.delete(id);
  const spoken = [];
  let cancelCalls = 0;
  let resumeCalls = 0;
  const synthesis = {
    paused: true,
    cancel() { cancelCalls += 1; },
    resume() { resumeCalls += 1; this.paused = false; },
    speak(utterance) { spoken.push(utterance); },
    getVoices() { return [{ lang: "es-CL", name: "Chilean Spanish" }]; },
  };
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = Function(
    "window",
    "setTimeout",
    "clearTimeout",
    `${html.slice(voiceStart, voiceEnd)}; return NavigationVoiceController;`,
  )(
    { speechSynthesis: synthesis, SpeechSynthesisUtterance: FakeUtterance },
    fakeSetTimeout,
    fakeClearTimeout,
  );

  assert.equal(controller.speak("Gira a la derecha", "2-250"), true);
  assert.equal(controller.speak("Gira a la derecha", "2-250"), false);
  assert.equal(timers.size, 1);
  assert.equal(controller.speak("Ahora gira a la derecha", "2-60"), true);
  assert.equal(timers.size, 1, "el aviso cercano reemplaza al anterior sin acumular audio");
  for (const { callback, delay } of [...timers.values()]) {
    assert.equal(delay, 90);
    callback();
  }
  timers.clear();
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, "Ahora gira a la derecha");
  assert.equal(spoken[0].lang, "es-CL");
  assert.equal(spoken[0].voice.lang, "es-CL");
  assert.ok(cancelCalls >= 2);
  assert.equal(resumeCalls, 1);

  controller.setEnabled(false);
  assert.equal(controller.speak("No debe sonar", "3-250"), false);
  controller.setEnabled(true);
  controller.reset();
  assert.equal(controller.speak("Gira a la derecha", "2-250"), true);

  const instructionStart = html.indexOf("function updateInstruction");
  const instructionEnd = html.indexOf("function tickDrive", instructionStart);
  const instructionSource = html.slice(instructionStart, instructionEnd);
  assert.match(instructionSource, /if\(guidanceDistance<70\)speak/);
  assert.match(instructionSource, /else if\(guidanceDistance<260\)speak/);
  assert.doesNotMatch(html, /lastSpokenKey|driveVoiceEnabled/);
  assert.match(html, /NavigationVoiceController\.resume\(\)/);
});

test("avisa cada grupo de cámaras próximo a 500, 200 y 80 metros", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const thresholdStart = html.indexOf("const CAMERA_NOTICE_THRESHOLDS=");
  const thresholdEnd = html.indexOf("const CameraAlertManager=(()=>", thresholdStart);
  assert.ok(thresholdStart >= 0 && thresholdEnd > thresholdStart);
  const cameraNoticeThreshold = Function(
    `${html.slice(thresholdStart, thresholdEnd)}; return cameraNoticeThreshold;`,
  )();

  assert.equal(cameraNoticeThreshold(651), null);
  assert.equal(cameraNoticeThreshold(500), 500);
  assert.equal(cameraNoticeThreshold(201), 500);
  assert.equal(cameraNoticeThreshold(200), 200);
  assert.equal(cameraNoticeThreshold(81), 200);
  assert.equal(cameraNoticeThreshold(80), 80);
  assert.equal(cameraNoticeThreshold(0), 80);
  assert.equal(cameraNoticeThreshold(-1), null);

  assert.match(html, /id="driveCameraAlert" role="status" aria-live="polite"/);
  assert.match(html, /CAMERA_ROUTE_CORRIDOR_M=55/);
  assert.match(html, /CAMERA_GROUP_DISTANCE_M=45/);
  assert.match(html, /located\.distance<=CAMERA_ROUTE_CORRIDOR_M/);
  assert.match(html, /Atención\. \$\{countText\} en \$\{distanceText\}/);
  assert.match(html, /navigator\.vibrate/);
  assert.match(html, /Notification\.permission==="granted"/);
  assert.match(html, /CameraAlertManager\.update\(\);FuelStationAlertManager\.update\(\);\s*updateInstruction\(p\)/);
  assert.ok(
    [...html.matchAll(/CameraAlertManager\.prepare\(\)/g)].length >= 2,
    "debe preparar avisos al iniciar y después de recalcular",
  );
  assert.ok(
    [...html.matchAll(/CameraAlertManager\.reset\(\)/g)].length >= 2,
    "debe limpiar avisos al iniciar y terminar el viaje",
  );
});

test("elige una salida estructural anterior con margen y nunca una posterior", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const toolkitStart = html.indexOf("const MIN_EXIT_BEFORE_TOLL_METERS=");
  const toolkitEnd = html.indexOf("function routeHitsToll", toolkitStart);
  const haversine = (a, b) => Math.hypot(
    (b[0] - a[0]) * 111320,
    (b[1] - a[1]) * 111320,
  );
  const toolkit = Function(
    "haversine",
    "tollPoly",
    "pointInPoly",
    "segHitsPoly",
    `${html.slice(toolkitStart, toolkitEnd)}; return {RouteDistanceCalculator, candidateExitsBeforeToll};`,
  )(
    haversine,
    (toll) => toll.polygon,
    () => false,
    () => false,
  );
  const route = {
    geometry: { coordinates: [[0, 0], [0.01, 0], [0.02, 0], [0.03, 0]] },
    legs: [{
      steps: [
        { maneuver: { type: "depart", location: [0, 0] }, geometry: { coordinates: [[0, 0], [0.01, 0]] } },
        { exits: "13", destinations: "La Concepción", maneuver: { type: "off ramp", location: [0.012, 0] }, geometry: { coordinates: [[0.012, 0], [0.013, 0.001]] } },
        { exits: "14", maneuver: { type: "off ramp", location: [0.018, 0] }, geometry: { coordinates: [[0.018, 0], [0.019, 0.001]] } },
        { exits: "15", maneuver: { type: "off ramp", location: [0.024, 0] }, geometry: { coordinates: [[0.024, 0], [0.025, 0.001]] } },
      ],
    }],
  };
  const index = toolkit.RouteDistanceCalculator.buildIndex(route);
  const toll = { id: "P3", distanceFromRouteStart: haversine([0, 0], [0.02, 0]) };
  const candidates = toolkit.candidateExitsBeforeToll(route, toll, index);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, "Salida 13");
  assert.equal(candidates[0].destination, "La Concepción");
  assert.ok(candidates[0].distanceBeforeToll >= 500);
  assert.ok(candidates.every((candidate) => candidate.distanceFromRouteStart < toll.distanceFromRouteStart));
  assert.notDeepEqual(candidates[0].waypoint, candidates[0].coordinate);
});

test("valida el ID exacto del TAG y compara ahorro o sobrecosto", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const pureStart = html.indexOf("function validateAvoidedTolls");
  const pureEnd = html.indexOf("const TollAvoidanceManager=(()=>", pureStart);
  assert.ok(pureStart >= 0 && pureEnd > pureStart);
  const { validateAvoidedTolls, buildAvoidanceComparison } = Function(
    `${html.slice(pureStart, pureEnd)}; return {validateAvoidedTolls, buildAvoidanceComparison};`,
  )();
  const avoidedIds = new Set(["P3_OP"]);

  assert.equal(validateAvoidedTolls([{ id: "P3_OP" }], avoidedIds).avoided, false);
  assert.equal(validateAvoidedTolls([{ id: "P3_PO" }], avoidedIds).avoided, true);
  assert.equal(validateAvoidedTolls([], avoidedIds).avoided, true);

  const original = { distanceKm: 13.4, durationMin: 24, tollCost: 865, totalCost: 3490 };
  const cheaper = { distanceKm: 15.1, durationMin: 29, tollCost: 0, totalCost: 2810 };
  const costlier = { distanceKm: 28.4, durationMin: 39, tollCost: 0, totalCost: 3850 };
  const saving = buildAvoidanceComparison(original, cheaper, { id: "P3_OP" });
  const extraCost = buildAvoidanceComparison(original, costlier, { id: "P3_OP" });

  assert.equal(saving.savings, 680);
  assert.equal(saving.extraDurationMin, 5);
  assert.ok(Math.abs(saving.extraDistanceKm - 1.7) < 1e-9);
  assert.equal(extraCost.savings, -360);

  const managerSource = html.slice(
    html.indexOf("const TollAvoidanceManager=(()=>"),
    html.indexOf("function routeOptionToll"),
  );
  assert.match(managerSource, /TollEngine\.findTollsForRoute/);
  assert.match(managerSource, /slice\(0,MAX_AVOIDANCE_ATTEMPTS\)/);
  assert.match(managerSource, /RouteManager\.setSelectedRoute/);
  const applyStart = managerSource.indexOf("function useAlternative");
  const applyEnd = managerSource.indexOf("function invalidate", applyStart);
  const applySource = managerSource.slice(applyStart, applyEnd);
  assert.doesNotMatch(applySource, /tripStart=Date\.now|tripDistanceM=0|passedTolls=new Map/);
  assert.match(html, /id="avoidanceModal"/);
  assert.match(html, /data-avoid-toll/);
});

test("integra tráfico Mapbox y los 246 puntos oficiales de cámaras de la RM", async () => {
  const html = await readFile(sourceUrl, "utf8");
  const cameraDataUrl = new URL("../public/data/rm-camera-locations.json", import.meta.url);
  const cameraData = JSON.parse(await readFile(cameraDataUrl, "utf8"));
  const cameras = cameraData.points;

  assert.equal(cameraData.metadata.pointCount, 246);
  assert.equal(cameraData.metadata.busAndRestrictionCount, 227);
  assert.equal(cameraData.metadata.restrictionOnlyCount, 19);
  assert.equal(cameras.length, 246);
  assert.equal(new Set(cameras.map((camera) => camera[0])).size, cameras.length);
  assert.equal(new Set(cameras.map((camera) => `${camera[7]},${camera[8]}`)).size, cameras.length);
  const snapDistances = [];
  for (const camera of cameras) {
    assert.equal(camera.length, 13);
    assert.ok(camera[3] >= -71 && camera[3] <= -70.3);
    assert.ok(camera[4] >= -34 && camera[4] <= -33.2);
    assert.ok(["bus_and_rrvv", "rrvv_only"].includes(camera[5]));
    assert.ok(camera[7] >= -71 && camera[7] <= -70.3);
    assert.ok(camera[8] >= -34 && camera[8] <= -33.2);
    assert.ok(Number.isFinite(camera[9]) && camera[9] >= 0 && camera[9] <= 25);
    assert.equal(typeof camera[11], "string");
    assert.equal(typeof camera[12], "string");
    assert.ok(camera[12].length > 0);
    snapDistances.push(camera[9]);
  }
  assert.equal(cameraData.metadata.displayCoordinatePolicy, "snapped_to_named_drivable_road");
  assert.equal(cameraData.metadata.displayCoordinateSource, "Mapbox Streets named road geometry");
  assert.equal(cameraData.metadata.snappedAt, "2026-07-30");
  assert.equal(cameraData.metadata.namedRoadMatchCount, cameras.length);
  assert.equal(cameraData.metadata.unmatchedNamedRoadCount, 0);
  assert.equal(Math.max(...snapDistances), cameraData.metadata.maximumSnapDistanceM);
  const cameraById = new Map(cameras.map((camera) => [camera[0], camera]));
  assert.deepEqual(cameraById.get("rmcam-001").slice(1, 3), ["Santo Domingo - Teatinos", "Sentido Oriente-Poniente"]);
  assert.deepEqual(cameraById.get("rmcam-001").slice(7, 9), [-70.65563, -33.436697]);
  assert.deepEqual(cameraById.get("rmcam-227").slice(1, 3), ["Gran Avenida José Miguel Carrera - Av. Lo Martínez", "Sentido Sur - Norte"]);
  assert.deepEqual(cameraById.get("rmcam-227").slice(7, 9), [-70.6855899, -33.5675528]);
  assert.deepEqual(cameraById.get("rmcam-246").slice(1, 3), ["Presidente Errázuriz - Gertrudis Echeñique", "Punto UOCT"]);
  assert.deepEqual(cameraById.get("rmcam-246").slice(7, 9), [-70.5904006, -33.4205344]);
  assert.deepEqual(cameraById.get("rmcam-012").slice(7, 9), [-70.6584624, -33.4370035]);
  assert.deepEqual(cameraById.get("rmcam-177").slice(7, 9), [-70.6584813, -33.4369246]);
  assert.deepEqual(cameraById.get("rmcam-191").slice(10, 13), ["Avenida Dorsal", "primary", "Av. Dorsal"]);
  assert.deepEqual(cameraById.get("rmcam-192").slice(10, 13), ["Avenida Domingo Santa María", "secondary", "Av. Domingo Santa María"]);
  assert.notEqual(cameraById.get("rmcam-192")[10], "Blanco Encalada");

  assert.match(html, /mapbox:\/\/mapbox\.mapbox-traffic-v1/);
  assert.match(html, /"source-layer":"traffic"/);
  assert.match(html, /"congestion"/);
  assert.match(html, /filter:\["match",\["get","congestion"\],\["moderate","heavy","severe"\],true,false\]/);
  assert.match(html, /"moderate","#f4cc45","heavy","#f28e2b","severe","#d73027"/);
  assert.doesNotMatch(html, /"low","#35b779"/);
  assert.match(html, /"line-offset":1/);
  assert.match(html, /Muestra sólo congestión moderada, alta o severa/);
  assert.match(html, /id="driveLiveTraffic"/);
  assert.match(html, /id="driveTrafficState">Actualizando/);
  assert.match(html, /const REFRESH_MS=45\*1000,STALE_MS=100\*1000,REQUEST_TIMEOUT_MS=7000/);
  assert.match(html, /depart_at:"now"/);
  assert.match(html, /driving-traffic\/\$\{coords\}\?\$\{params\}/);
  assert.match(html, /LiveTrafficETAController\.start\(state\.route\)/);
  assert.match(html, /LiveTrafficETAController\.seed\(nextRoute\)/);
  assert.match(html, /cost=renderDriveCost\(\);\s*\$\("#liveKm"\)[\s\S]*?if\(state\.freeDriveActive\)/);
  assert.match(html, /else renderDriveGuidanceStats\(\)/);
  const trafficSummaryStart = html.indexOf("function summarizeLiveTraffic");
  const trafficSummaryEnd = html.indexOf("function renderLiveTrafficStatus", trafficSummaryStart);
  const summarizeLiveTraffic = Function(
    `${html.slice(trafficSummaryStart, trafficSummaryEnd)}; return summarizeLiveTraffic;`,
  )();
  assert.equal(
    summarizeLiveTraffic({
      duration: 600,
      duration_typical: 590,
      legs: [{ annotation: { congestion_numeric: [8, 14], duration: [200, 400] } }],
    }).level,
    "flowing",
  );
  const severeTraffic = summarizeLiveTraffic({
    duration: 900,
    duration_typical: 600,
    legs: [{ annotation: { congestion_numeric: [20, 80], duration: [100, 300] } }],
  });
  assert.equal(severeTraffic.level, "severe");
  assert.equal(severeTraffic.delayMinutes, 5);
  assert.match(html, /id:"bus-camera-points"/);
  assert.match(html, /id:"bus-camera-labels"/);
  assert.match(html, /id:"bus-camera-clusters"/);
  assert.match(html, /cluster:true,clusterMaxZoom:13/);
  assert.match(html, /"rrvv_only","clarify-rrvv-camera","clarify-camera"/);
  assert.match(html, /addLiveMapLayers\(state\.map\)/);
  assert.match(html, /state\.driveMap\.on\("style\.load",\(\)=>restoreStyleContent\(state\.driveMap,\{drive:true\}\)\)/);
  assert.match(html, /try\{addLiveMapLayers\(map\)\}catch/);
  assert.match(html, /id="driveTrafficToggle"/);
  assert.match(html, /id="driveBusCameraToggle"/);
  assert.match(html, /ruta\.mapLayerPrefs/);
  assert.match(html, /OFFICIAL_CAMERA_POINT_COUNT=246/);
  assert.match(html, /BUS_CAMERA_DATA_URL="\/data\/rm-camera-locations\.json\?v=20260730-named-roads"/);
  assert.match(html, /fetch\(BUS_CAMERA_DATA_URL,\{cache:"no-cache"\}\)/);
  assert.match(html, /sourceLongitude,sourceLatitude,sourceSnapDistance,sourceDisplayRoad,sourceDisplayHighway,sourceMatchedRoad/);
  assert.match(html, /Marcador alineado con/);
  assert.match(html, /una de las vías indicadas en el nombre oficial/);
  assert.match(html, /https:\/\/www\.fiscalizacion\.cl\/listado_vias_priorizadas\//);
  assert.match(html, /https:\/\/www\.google\.com\/maps\/d\/u\/0\/viewer\?mid=1p-1KF2rcDRD88qJ2Iv6G97yzWCgjQzS5/);
});
