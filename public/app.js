// Run&Sport PRO – app.js (2026)
// Funciona con:
// - /api/config
// - /api/catalog
// - /api/fx?base=XXX
// - /api/create_preference

const $ = (sel) => document.querySelector(sel);

function cap(s){ return (s||"").charAt(0).toUpperCase() + (s||"").slice(1); }

function placeholderSVG(label="Run&Sport"){
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <defs>
      <linearGradient id="g" x1="0" x2="1">
        <stop offset="0" stop-color="#22c55e" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#38bdf8" stop-opacity="0.35"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="#061226"/>
    <rect x="60" y="60" width="1080" height="680" rx="36" fill="url(#g)" stroke="rgba(148,163,184,.25)"/>
    <text x="50%" y="48%" text-anchor="middle" fill="rgba(226,232,240,.92)" font-size="44" font-family="Arial">
      ${label}
    </text>
    <text x="50%" y="58%" text-anchor="middle" fill="rgba(148,163,184,.9)" font-size="22" font-family="Arial">
      Imagen demo (reemplazá por fotos reales)
    </text>
  </svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function imgPath(src){
  if(!src) return "";
  if(src.startsWith("/")) return src;
  return "/" + src;
}

// ---------------- Estado ----------------
let SHOP = null;
let PRODUCTS = [];

const state = {
  cat: "all",
  q: "",
  sort: "featured",
  cart: loadCart(),
  modalProduct: null,
  modalQty: 1,

  displayCurrency: loadCurrency(),
  detectedCountry: null,

  fx: new Map(), // base -> rates
  shippingOptions: [], // [{id,label,price,currency}]
  selectedShippingId: null
};

// ---------------- Storage ----------------
function loadCart(){
  try { return JSON.parse(localStorage.getItem("rs_cart") || "{}"); }
  catch { return {}; }
}
function saveCart(){
  localStorage.setItem("rs_cart", JSON.stringify(state.cart || {}));
}
function loadCurrency(){
  return localStorage.getItem("rs_currency") || "AUTO";
}
function saveCurrency(v){
  localStorage.setItem("rs_currency", v);
}

// ---------------- Fetch helpers ----------------
async function fetchJSON(url, opts){
  const res = await fetch(url, opts);
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function loadConfig(){
  const cfg = await fetchJSON("/api/config");
  SHOP = cfg.shop || null;

  // Social links
  const social = SHOP?.social || {};
  setLink("#social-ig", social.instagram);
  setLink("#social-fb", social.facebook);
  setLink("#social-tt", social.tiktok);
  setLink("#social-yt", social.youtube);
}

async function loadCatalog(){
  const data = await fetchJSON("/api/catalog");
  SHOP = data.shop || SHOP;
  PRODUCTS = data.products || [];
}

// ---------------- Currency logic ----------------
const COUNTRY_TO_CURRENCY = {
  UY: "UYU",
  AR: "ARS",
  BR: "BRL",
  US: "USD",
  CL: "CLP",
  PE: "PEN",
  PY: "PYG",
  BO: "BOB",
  CO: "COP",
  MX: "MXN",
  ES: "EUR",
  FR: "EUR",
  DE: "EUR",
  IT: "EUR",
  PT: "EUR"
};

function currencyForCountry(cc){
  return COUNTRY_TO_CURRENCY[String(cc||"").toUpperCase()] || (SHOP?.defaultCurrency || "UYU");
}

async function detectCountry(){
  // Pro: pedimos el país a nuestro backend (sin CORS)
  try{
    const data = await fetchJSON("/api/geo");
    const cc = data?.country_code;
    if(cc){
      state.detectedCountry = cc;
      return cc;
    }
  }catch(e){
    console.warn("geo fallback:", e?.message || e);
  }
  state.detectedCountry = SHOP?.country || "UY";
  return state.detectedCountry;
}


function getDisplayCurrency(){
  if(state.displayCurrency !== "AUTO") return state.displayCurrency;
  return currencyForCountry(state.detectedCountry || (SHOP?.country || "UY"));
}

function formatMoney(amount, currency){
  const cur = String(currency||"UYU").toUpperCase();
  const n = Number(amount||0);
  try{
    return new Intl.NumberFormat("es-UY", { style:"currency", currency: cur, maximumFractionDigits: 0 }).format(n);
  }catch{
    // fallback
    return `${cur} ${Math.round(n).toLocaleString("es-UY")}`;
  }
}

async function ensureRates(base){
  const b = String(base||"USD").toUpperCase();
  if(state.fx.has(b)) return state.fx.get(b);
  const data = await fetchJSON(`/api/fx?base=${encodeURIComponent(b)}`);
  state.fx.set(b, data.rates || {});
  return data.rates || {};
}

async function convert(amount, from, to){
  const a = Number(amount||0);
  const f = String(from||"UYU").toUpperCase();
  const t = String(to||"UYU").toUpperCase();
  if(f === t) return a;
  const rates = await ensureRates(f);
  const rate = Number(rates?.[t] || 0);
  if(!rate) return a; // fallback: no rompe
  return a * rate;
}

// ---------------- UI: productos ----------------
const productsEl = $("#products");
const payNotice = $("#pay-notice");

// Drawer
const drawer = $("#drawer");
const backdrop = $("#backdrop");
const cartCount = $("#cart-count");
const cartItems = $("#cart-items");
const cartTotal = $("#cart-total");
const drawerSub = $("#drawer-sub");
const shipSelect = $("#ship");

// Modal
const modal = $("#modal");
const modalClose = $("#modal-close");
const modalImg = $("#modal-img");
const modalThumbs = $("#modal-thumbs");
const modalTitle = $("#modal-title");
const modalDesc = $("#modal-desc");
const modalCat = $("#modal-cat");
const modalTag = $("#modal-tag");
const modalStock = $("#modal-stock");
const modalPrice = $("#modal-price");
const modalSpecs = $("#modal-specs");
const mMinus = $("#m-minus");
const mPlus = $("#m-plus");
const mQty = $("#m-qty");
const mAdd = $("#m-add");
const mWsp = $("#m-wsp");

// ---------------- Visible list ----------------
function getVisible(){
  let list = [...PRODUCTS];

  if(state.cat !== "all") list = list.filter(p => p.category === state.cat);

  if(state.q.trim()){
    const q = state.q.trim().toLowerCase();
    list = list.filter(p =>
      `${p.title} ${p.desc} ${p.tag} ${p.category}`.toLowerCase().includes(q)
    );
  }

  switch(state.sort){
    case "price_asc": list.sort((a,b)=>(a.price||0)-(b.price||0)); break;
    case "price_desc": list.sort((a,b)=>(b.price||0)-(a.price||0)); break;
    case "name_asc": list.sort((a,b)=>String(a.title||"").localeCompare(String(b.title||""),"es")); break;
    default:
      list.sort((a,b)=>(b.featured===true)-(a.featured===true));
      break;
  }

  return list;
}

async function priceLabel(p){
  const cur = getDisplayCurrency();
  const value = await convert(p.price, p.currency || (SHOP?.defaultCurrency||"UYU"), cur);
  return formatMoney(value, cur);
}

function primaryImg(p){
  const imgs = Array.isArray(p.images) ? p.images : [];
  return imgs[0] || null;
}

async function renderProducts(){
  const list = getVisible();
  if(!list.length){
    productsEl.innerHTML = `<div class="small">No hay productos para tu búsqueda/filtro.</div>`;
    return;
  }

  const ph = placeholderSVG();

  const cards = await Promise.all(list.map(async (p)=>{
    const qty = state.cart[p.id] || 0;
    const label = await priceLabel(p);
    const src = primaryImg(p) ? imgPath(primaryImg(p)) : ph;

    return `
      <article class="card">
        <button class="ghost-btn" style="border:none;background:transparent;padding:0;text-align:left;cursor:pointer"
          onclick="openModal('${p.id}')">
          <img src="${src}" alt="${p.title}" onerror="this.onerror=null;this.src='${ph}'">
        </button>

        <div class="body">
          <h3 style="cursor:pointer" onclick="openModal('${p.id}')">${p.title}</h3>
          <div class="meta">
            <span class="chip">${cap(p.category)}</span>
            <span class="chip">${p.tag || "Producto"}</span>
            ${p.featured ? `<span class="chip">Destacado</span>` : ""}
            <span class="price">${label}</span>
          </div>
          <p class="desc">${p.desc}</p>
        </div>

        <div class="foot">
          <div class="qty">
            <button onclick="chg('${p.id}',-1)">−</button>
            <span>${qty}</span>
            <button onclick="chg('${p.id}',1)">+</button>
          </div>
          <button class="btn primary" onclick="add('${p.id}')">Agregar</button>
        </div>
      </article>
    `;
  }));

  productsEl.innerHTML = cards.join("");
}

// ---------------- Cart ----------------
function cartList(){
  return Object.entries(state.cart).map(([id,quantity])=>{
    const p = PRODUCTS.find(x=>x.id===id);
    if(!p) return null;
    return { ...p, quantity };
  }).filter(Boolean);
}

async function computeCartTotal(){
  const cur = getDisplayCurrency();
  const list = cartList();
  let sum = 0;
  for(const p of list){
    const value = await convert(p.price, p.currency || (SHOP?.defaultCurrency||"UYU"), cur);
    sum += value * p.quantity;
  }

  // shipping (en moneda display)
  const ship = state.shippingOptions.find(x=>x.id === state.selectedShippingId);
  if(ship){
    if(ship.currency === cur) sum += Number(ship.price||0);
    else sum += await convert(ship.price, ship.currency, cur);
  }

  return { sum, cur };
}

async function renderCart(){
  const list = cartList();
  const count = list.reduce((s,p)=>s+p.quantity,0);
  cartCount.textContent = count;
  drawerSub.textContent = `${count} producto${count===1?"":"s"}`;

  const ph = placeholderSVG();

  if(!list.length){
    cartItems.innerHTML = `<div class="small">Tu carrito está vacío.</div>`;
    cartTotal.textContent = formatMoney(0, getDisplayCurrency());
    return;
  }

  const rows = await Promise.all(list.map(async (p)=>{
    const label = await priceLabel(p);
    const src = primaryImg(p) ? imgPath(primaryImg(p)) : ph;
    return `
      <div class="item">
        <img src="${src}" alt="${p.title}" onerror="this.onerror=null;this.src='${ph}'">
        <div class="info">
          <div class="t">${p.title}</div>
          <div class="s">${label} • Cantidad: ${p.quantity}</div>
          <div class="r">
            <div class="small">${cap(p.category)} • ${p.tag || "Producto"}</div>
            <div class="rm" onclick="rm('${p.id}')">Quitar</div>
          </div>
        </div>
      </div>
    `;
  }));

  cartItems.innerHTML = rows.join("");

  const { sum, cur } = await computeCartTotal();
  cartTotal.textContent = formatMoney(sum, cur);
}

// ---------------- Shipping ----------------
async function buildShippingOptions(){
  const s = SHOP?.shipping || {};
  const cur = getDisplayCurrency();

  const local = Array.isArray(s.local) ? s.local : [];
  const intl = Array.isArray(s.international) ? s.international : [];

  const opts = [];

  // local in default currency (UYU)
  for(const o of local){
    opts.push({
      id: o.id,
      label: o.label,
      price: Number(o.price || 0),
      currency: SHOP?.defaultCurrency || "UYU"
    });
  }

  // international is in USD
  for(const o of intl){
    opts.push({
      id: o.id,
      label: `🌎 ${o.label}`,
      price: Number(o.priceUSD || 0),
      currency: "USD"
    });
  }

  state.shippingOptions = opts;

  // default selection
  if(!state.selectedShippingId && opts.length){
    state.selectedShippingId = opts[0].id;
  }

  // render select
  const optionsHtml = await Promise.all(opts.map(async (o)=>{
    const v = o.currency === cur ? o.price : await convert(o.price, o.currency, cur);
    return `<option value="${o.id}">${o.label} • ${formatMoney(v, cur)}</option>`;
  }));

  shipSelect.innerHTML = optionsHtml.join("");
  shipSelect.value = state.selectedShippingId || "";
}

shipSelect.addEventListener("change", async (e)=>{
  state.selectedShippingId = e.target.value;
  await renderCart();
});

// ---------------- Cart actions (global) ----------------
window.chg = async (id, d) => {
  const cur = state.cart[id] || 0;
  const next = Math.max(0, cur + d);
  if(next===0) delete state.cart[id];
  else state.cart[id] = next;
  saveCart();
  await sync();
};

window.add = async (id) => {
  state.cart[id] = (state.cart[id] || 0) + 1;
  saveCart();
  await sync();
  openCart();
};

window.rm = async (id) => {
  delete state.cart[id];
  saveCart();
  await sync();
};

// Drawer open/close
function openCart(){
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden","false");
  backdrop.hidden = false;
}
function closeCart(){
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden","true");
  backdrop.hidden = true;
}
$("#open-cart").addEventListener("click", openCart);
$("#close-cart").addEventListener("click", closeCart);
backdrop.addEventListener("click", closeCart);

// ---------------- WhatsApp checkout ----------------
function getWspNumber(){
  const raw = (SHOP?.whatsapp || "59896786514");
  return String(raw).replace(/\D/g,"");
}
function openWsp(text){
  const number = getWspNumber();
  const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener");
}

async function buildWspMessage(){
  const list = cartList();
  const cur = getDisplayCurrency();
  const ship = state.shippingOptions.find(x=>x.id === state.selectedShippingId);

  const lines = ["Hola Run&Sport! Quiero comprar:"];

  for(const p of list){
    const label = await priceLabel(p);
    lines.push(`- ${p.title} x${p.quantity} (${label} c/u)`);
  }

  lines.push("—");
  if(ship){
    const shipValue = ship.currency === cur ? ship.price : await convert(ship.price, ship.currency, cur);
    lines.push(`Envío: ${ship.label} (${formatMoney(shipValue, cur)})`);
  }

  const { sum } = await computeCartTotal();
  lines.push(`Total aprox.: ${formatMoney(sum, cur)}`);
  lines.push("—");
  lines.push("Nombre:");
  lines.push("Ciudad / Dirección:");
  lines.push("Consulta/Nota:");

  return lines.join("\n");
}

$("#btn-wsp").addEventListener("click", async ()=>{
  const list = cartList();
  if(!list.length) return openWsp("Hola! Quiero consultar por productos en Run&Sport.");
  openWsp(await buildWspMessage());
});
$("#btn-wsp-cart").addEventListener("click", async ()=>{
  const list = cartList();
  if(!list.length) return;
  openWsp(await buildWspMessage());
});
$("#wsp-float").addEventListener("click", async (e)=>{
  e.preventDefault();
  $("#btn-wsp").click();
});

// ---------------- Mercado Pago ----------------
$("#btn-pay").addEventListener("click", async ()=>{
  const list = cartList();
  if(!list.length) return;

  const payload = {
    cart: list.map(p=>({ id:p.id, quantity:p.quantity })),
    currency: getDisplayCurrency()
  };

  const btn = $("#btn-pay");
  try{
    btn.textContent = "Generando link de pago...";
    btn.disabled = true;

    const data = await fetchJSON("/api/create_preference",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });

    window.location.href = data.init_point || data.sandbox_init_point;
  }catch(err){
    alert("Error: " + (err.message || err));
  }finally{
    btn.textContent = "Pagar con Mercado Pago";
    btn.disabled = false;
  }
});

// ---------------- Payment notice ----------------
(function paymentStatus(){
  const pago = new URLSearchParams(window.location.search).get("pago");
  if(!pago) return;
  payNotice.hidden = false;
  if(pago==="success") payNotice.textContent="✅ Pago aprobado. ¡Gracias por tu compra!";
  if(pago==="pending") payNotice.textContent="⏳ Pago pendiente. Si necesitás ayuda, escribinos por WhatsApp.";
  if(pago==="failure") payNotice.textContent="❌ Pago rechazado o cancelado.";
})();

// ---------------- Modal ----------------
function setMainImage(src, label){
  const ph = placeholderSVG(label);
  modalImg.onerror = null;
  modalImg.src = src ? imgPath(src) : ph;
  modalImg.onerror = () => { modalImg.src = ph; };
}

function renderThumbs(p){
  const imgs = Array.isArray(p.images) ? p.images : [];
  if(!imgs.length){
    modalThumbs.innerHTML = "";
    return;
  }

  modalThumbs.innerHTML = imgs.map((src, idx)=>(
    `<img class="thumb ${idx===0?'active':''}" src="${imgPath(src)}" alt="Vista ${idx+1}" onclick="pickImg(${idx})"
      onerror="this.onerror=null;this.src='${placeholderSVG(p.title)}'">`
  )).join("");

  window.pickImg = (i)=>{
    const nodes = modalThumbs.querySelectorAll(".thumb");
    nodes.forEach(n=>n.classList.remove("active"));
    if(nodes[i]) nodes[i].classList.add("active");
    setMainImage(imgs[i], p.title);
  };
}

async function fillModal(p){
  state.modalProduct = p;
  state.modalQty = 1;
  mQty.textContent = "1";

  modalTitle.textContent = p.title;
  modalDesc.textContent = p.desc;
  modalCat.textContent = cap(p.category);
  modalTag.textContent = p.tag || "Producto";
  modalStock.textContent = (p.stock === "out_of_stock") ? "Sin stock" : "Stock";
  modalStock.style.borderColor = (p.stock === "out_of_stock") ? "rgba(248,113,113,.35)" : "rgba(34,197,94,.35)";

  modalPrice.textContent = await priceLabel(p);

  // specs
  const specs = Array.isArray(p.specs) ? p.specs : [];
  modalSpecs.innerHTML = specs.map(s=>`<li>${s}</li>`).join("");

  // images
  const src = primaryImg(p);
  setMainImage(src, p.title);
  renderThumbs(p);
}

window.openModal = async (id) => {
  const p = PRODUCTS.find(x=>x.id===id);
  if(!p) return;
  await fillModal(p);
  modal.hidden = false;
};

function closeModal(){
  modal.hidden = true;
  state.modalProduct = null;
  document.body.style.overflow = ""; // importante: destraba scroll/click
}

modalClose.addEventListener("click", closeModal);
// cerrar tocando afuera del cuadro
modal.addEventListener("click", (e)=>{ if(e.target === modal) closeModal(); });
// cerrar con ESC
document.addEventListener("keydown", (e)=>{ if(e.key === "Escape" && !modal.hidden) closeModal(); });

modal.addEventListener("click",(e)=>{ if(e.target === modal) closeModal(); });

mMinus.addEventListener("click", ()=>{
  state.modalQty = Math.max(1, state.modalQty - 1);
  mQty.textContent = String(state.modalQty);
});
mPlus.addEventListener("click", ()=>{
  state.modalQty = state.modalQty + 1;
  mQty.textContent = String(state.modalQty);
});

mAdd.addEventListener("click", async ()=>{
  const p = state.modalProduct;
  if(!p) return;
  state.cart[p.id] = (state.cart[p.id] || 0) + state.modalQty;
  saveCart();
  await sync();
  closeModal();
  openCart();
});

mWsp.addEventListener("click", async ()=>{
  const p = state.modalProduct;
  if(!p) return;
  const cur = getDisplayCurrency();
  const label = await priceLabel(p);
  openWsp(`Hola Run&Sport! Quiero consultar/comprar:\n- ${p.title} x${state.modalQty}\nPrecio aprox.: ${label}\n¿Está disponible?`);
});

// ---------------- Filters ----------------
$("#search").addEventListener("input",(e)=>{ state.q = e.target.value; sync(); });
$("#btn-clear").addEventListener("click", ()=>{ $("#search").value = ""; state.q = ""; sync(); });
$("#sort").addEventListener("change",(e)=>{ state.sort = e.target.value; sync(); });

document.querySelectorAll(".pill[data-cat]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".pill[data-cat]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.cat = btn.dataset.cat;
    sync();
  });
});

// Currency selector
$("#currency").addEventListener("change", async (e)=>{
  state.displayCurrency = e.target.value;
  saveCurrency(state.displayCurrency);
  await buildShippingOptions();
  await sync();
});

function setLink(sel, url){
  const el = $(sel);
  if(!el) return;
  if(url && String(url).trim()){
    el.href = String(url).trim();
    el.style.opacity = "1";
  }else{
    el.href = "#";
    el.style.opacity = ".55";
  }
}

// ---------------- Sync ----------------
async function sync(){
  await renderProducts();
  await renderCart();
}

// ---------------- Init ----------------
(async function init(){
  try{
    // FIX CRÍTICO: asegurarse de que el modal arranca cerrado
    const m = document.querySelector("#modal");
    if (m) {
      m.hidden = true;
      m.style.display = "none";
    }
    document.body.style.overflow = "";

    await loadConfig();
    await loadCatalog();

    // detectar país solo para AUTO
    await detectCountry();

    // set select value
    const cur = document.querySelector("#currency");
    if (cur) cur.value = state.displayCurrency;

    await buildShippingOptions();
    await sync();
  }catch(e){
    productsEl.innerHTML = `<div class="small">❌ Error cargando tienda: ${e.message}</div>`;
    console.error(e);
  }
})();
