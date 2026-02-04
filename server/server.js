// Run&Sport PRO FINAL (2026)
// - Frontend estático en /public
// - Catálogo editable en /server/catalog.json
// - WhatsApp checkout (frontend)
// - Mercado Pago Checkout Pro (server) con precios blindados
// - Multi-moneda: el frontend puede mostrar en la moneda del país del visitante

const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
require("dotenv").config();

const { MercadoPagoConfig, Preference } = require("mercadopago");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---------------- Paths ----------------
const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const CATALOG_PATH = path.join(__dirname, "catalog.json");

// ---------------- Helpers ----------------
function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) throw new Error("No existe server/catalog.json");
  const raw = fs.readFileSync(CATALOG_PATH, "utf-8");
  const data = JSON.parse(raw);
  if (!data?.shop) throw new Error("catalog.json inválido (falta shop)");
  if (!Array.isArray(data?.products)) throw new Error("catalog.json inválido (products)");
  return data;
}

function getProductById(catalog, id) {
  return catalog.products.find((p) => String(p.id) === String(id));
}

/**
 * BASE_URL:
 * - En Render debe ser: https://runandsport-pro.onrender.com
 * - En local: http://localhost:4000
 */
function getBaseUrl() {
  const PORT = process.env.PORT || 4000;
  const env = (process.env.BASE_URL || "").trim().replace(/\/+$/, ""); // sin "/" final
  return env ? env : `http://localhost:${PORT}`;
}

// ---------------- Mercado Pago ----------------
let mpPreference = null;
if (!process.env.MP_ACCESS_TOKEN) {
  console.warn("⚠️ Falta MP_ACCESS_TOKEN. Mercado Pago no va a funcionar.");
} else {
  const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
  mpPreference = new Preference(mpClient);
}

// ---------------- FX rates (cache) ----------------
const FX_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const fxCache = new Map(); // base -> { ts, rates }

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function getRates(base) {
  const b = String(base || "USD").toUpperCase();
  const cached = fxCache.get(b);
  if (cached && Date.now() - cached.ts < FX_TTL_MS) return cached.rates;

  try {
    const data = await fetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(b)}`);
    const rates = data?.rates;
    if (!rates || typeof rates !== "object") throw new Error("rates inválidas");
    fxCache.set(b, { ts: Date.now(), rates });
    return rates;
  } catch (e) {
    const fallbackUSD_UYU = safeNumber(process.env.USD_UYU_RATE, 40);
    const fallback = {
      USD: { UYU: fallbackUSD_UYU },
      UYU: { USD: 1 / fallbackUSD_UYU }
    };

    const rates = fallback[b] || { [b]: 1 };
    fxCache.set(b, { ts: Date.now(), rates });
    return rates;
  }
}

async function convert(amount, from, to) {
  const a = safeNumber(amount, 0);
  const f = String(from || "USD").toUpperCase();
  const t = String(to || "USD").toUpperCase();
  if (f === t) return a;

  const rates = await getRates(f);
  const rate = safeNumber(rates?.[t], 0);
  if (!rate) throw new Error(`No hay tipo de cambio ${f}->${t}`);
  return a * rate;
}

// Anti-cache para evitar JS viejo
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

// ---------------- Frontend ----------------
app.use(express.static(PUBLIC_DIR));

// ---------------- API ----------------

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Run&Sport PRO",
    now: new Date().toISOString()
  });
});

// Geo simple (sin CORS): devuelve país para moneda automática
app.get("/api/geo", (_req, res) => {
  try {
    const catalog = readCatalog();
    const cc = (catalog.shop?.country || "UY").toString().toUpperCase();
    res.json({ country_code: cc });
  } catch (e) {
    res.json({ country_code: "UY" });
  }
});

// Config útil para el frontend
app.get("/api/config", (_req, res) => {
  const catalog = readCatalog();
  res.json({
    shop: {
      ...catalog.shop,
      whatsapp: (process.env.SHOP_WHATSAPP || catalog.shop.whatsapp || "").toString()
    },
    baseUrl: getBaseUrl()
  });
});

// Catálogo
app.get("/api/catalog", (_req, res) => {
  try {
    const catalog = readCatalog();
    res.json({ shop: catalog.shop, products: catalog.products });
  } catch (e) {
    res.status(500).json({ error: "No se pudo leer catálogo", detail: e.message });
  }
});

// Tipos de cambio (para el frontend)
app.get("/api/fx", async (req, res) => {
  try {
    const base = String(req.query.base || "USD").toUpperCase();
    const rates = await getRates(base);
    res.json({ base, rates, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ error: "FX error", detail: e.message });
  }
});

// Crear preferencia Mercado Pago (Checkout Pro)
app.post("/api/create_preference", async (req, res) => {
  try {
    if (!mpPreference) return res.status(500).json({ error: "Falta MP_ACCESS_TOKEN" });

    const { cart } = req.body || {};
    if (!Array.isArray(cart) || cart.length === 0) return res.status(400).json({ error: "Carrito vacío" });

    const MP_CURRENCY = "UYU";
    const catalog = readCatalog();

    const items = [];
    for (const line of cart) {
      const id = String(line?.id || "").trim();
      const qty = Math.max(1, safeNumber(line?.quantity, 1));
      const p = getProductById(catalog, id);
      if (!p) throw new Error(`Producto no encontrado: ${id}`);

      const title = String(p.title || "Producto");
      const unit = safeNumber(p.price, 0);
      const cur = String(p.currency || catalog.shop.defaultCurrency || "UYU").toUpperCase();
      if (!unit || unit <= 0) throw new Error(`Precio inválido en: ${title}`);

      let priceUyu = unit;
      if (cur !== MP_CURRENCY) {
        priceUyu = await convert(unit, cur, MP_CURRENCY);
      }

      items.push({
        title,
        quantity: qty,
        currency_id: MP_CURRENCY,
        unit_price: Math.round(priceUyu)
      });
    }

    const baseUrl = getBaseUrl(); // <- usa BASE_URL si existe
    const isPublicHttps = /^https:\/\//i.test(baseUrl);

    // ✅ Si NO hay URL pública https, NO usamos auto_return (evita el error 400)
    const body = {
      items,
      statement_descriptor: "RUN&SPORT",
      external_reference: `RUNSPORT-${Date.now()}`
    };

    // ✅ Si hay https pública, ponemos back_urls + auto_return
    if (isPublicHttps) {
      body.back_urls = {
        success: `${baseUrl}/?pago=success`,
        pending: `${baseUrl}/?pago=pending`,
        failure: `${baseUrl}/?pago=failure`
      };
      body.auto_return = "approved";
      body.notification_url = `${baseUrl}/api/webhook/mercadopago`;

    }

    const response = await mpPreference.create({ body });

    res.json({
      id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });
  } catch (e) {
    console.error("❌ create_preference:", e);
    res.status(500).json({ error: "Error creando preferencia", detail: e.message || String(e) });
  }
});

// Webhook opcional
app.post("/api/webhook/mercadopago", (req, res) => {
  console.log("🔔 Webhook Mercado Pago", { query: req.query, body: req.body });
  res.sendStatus(200);
});

// Catch-all
app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("✅ Run&Sport PRO listo");
  console.log(`✅ http://localhost:${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/api/health`);
  console.log(`✅ BASE_URL: ${getBaseUrl()}`);
});

