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
  // Amazon sidebar filters
  cat: "all",
  q: "",
  sort: "featured",
  minPrice: null,
  maxPrice: null,
  onlyStock: false,
  onlyFeatured: false,

  // Cart + modal
  cart: loadCart(),
  modalProduct: null,
  modalQty: 1,

  // Currency
  displayCurrency: loadCurrency(),
  detectedCountry: null,

  // FX + Shipping
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
// ⬇️ IMPORTANTE: ahora el grid es #grid (Amazon layout)
const productsEl = $("#grid") || $("#products"); // fallback por si volvés atrás
const resultsInfoEl = $("#resultsInfo");         // Amazon: contador
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

// ---------------- Helpers producto ----------------
function norm(s){
  return (s||"").toString().toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu,"");
}

function isInStock(p){
  if(p.stock === "in_stock") return true;
  if(p.stock === "out_of_stock") return false;
  if(typeof p.stock === "number") return p.stock > 0;
  if(typeof p.stock === "boolean") return p.stock;
  return true; // default
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

// ---------------- Visible list (Amazon sidebar) ----------------
function getVisible(){
  let list = [...PRODUCTS];

  // category
  if(state.cat !== "all") list = list.filter(p => p.category === state.cat);

  // stock / featured
  if(state.onlyStock) list = list.filter(isInStock);
  if(state.onlyFeatured) list = list.filter(p => !!p.featured);

  // price (filtra por precio base del producto; la moneda display puede variar, pero es consistente)
  if(state.minPrice !== null && Number.isFinite(state.minPrice)){
    list = list.filter(p => Number(p.price||0) >= state.minPrice);
  }
  if(state.maxPrice !== null && Number.isFinite(state.maxPrice)){
    list = list.filter(p => Number(p.price||0) <= state.maxPrice);
  }

  // search: title + desc + tag + category + specs
  const q = norm(state.q).trim();
  if(q){
    list = list.filter(p => {
      const hay = [
        p.title, p.desc, p.tag, p.category,
        ...(Array.isArray(p.specs) ? p.specs : [])
      ].map(norm).join(" | ");
      return hay.includes(q);
    });
  }

  // sort
  switch(state.sort){
    case "price_asc": list.sort((a,b)=>(a.price||0)-(b.price||0)); break;
    case "price_desc": list.sort((a,b)=>(b.price||0)-(a.price||0)); break;
    case "title_asc": list.sort((a,b)=>String(a.title||"").localeCompare(String(b.title||""),"es")); break;
    default:
      // destacados primero; si empatan, menor precio primero
      list.sort((a,b)=>{
        const fa = a.featured===true ? 1 : 0;
        const fb = b.featured===true ? 1 : 0;
        if(fa !== fb) return fb - fa;
        return (a.price||0) - (b.price||0);
      });
      break;
  }

  return list;
}

function renderResultsInfo(count){
  if(!resultsInfoEl) return;
  const catLabel = state.cat === "all" ? "Todas" : cap(state.cat);
  const q = (state.q||"").trim();
  resultsInfoEl.textContent = `${count} resultado(s) • ${catLabel}${q ? ` • búsqueda: "${q}"` : ""}`;
}

async function renderProducts(){
  if(!productsEl) return;

  const list = getVisible();
  renderResultsInfo(list.length);

  if(!list.length){
    productsEl.innerHTML = `<div class="small">No hay productos para tu búsqueda/filtro.</div>`;
    return;
  }

  const ph = placeholderSVG();

  const cards = await Promise.all(list.map(async (p)=>{
    const qty = state.cart[p.id] || 0;
    const label = await priceLabel(p);
    const src = primaryImg(p) ? imgPath(primaryImg(p)) : ph;

    const badge = p.featured ? "Destacado" : (p.badge || "");
    const badgeClass = p.featured ? "hot" : (badge?.toLowerCase().includes("oferta") ? "sale" : "");

    return `
      <article class="card">
        <div class="img-wrap">
          <button class="ghost-btn"
            style="border:none;background:transparent;padding:0;text-align:left;cursor:pointer;width:100%"
            onclick="openModal('${p.id}')">
            <img src="${src}" alt="${p.title}" onerror="this.onerror=null;this.src='${ph}'">
          </button>

          ${badge ? `<div class="badge-top ${badgeClass}">${badge}</div>` : ""}
        </div>

        <div class="body">
          <h3 style="cursor:pointer" onclick="openModal('${p.id}')">${p.title}</h3>

          <div class="meta">
            <span class="chip">${cap(p.category)}</span>
            <span class="chip">${p.tag || "Producto"}</span>
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
        </div>

        <div class="card-actions">
          <button class="btn light" onclick="openModal('${p.id}')">Ver</button>
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
  state.cartTotalUYU = sum; // ✅ guarda total para PayPal

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
  lines.push("—");
  lines.push("Estado del pago:");
  lines.push("• Si pagás con Abitab/Redpagos: queda PENDIENTE hasta que se abone en el local.");
  lines.push("• Con tarjeta: puede aprobarse al instante o quedar pendiente por validación.");
  lines.push("Apenas figure APROBADO, coordinamos envío/entrega.");

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

// qty
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
  const label = await priceLabel(p);
  openWsp(`Hola Run&Sport! Quiero consultar/comprar:\n- ${p.title} x${state.modalQty}\nPrecio aprox.: ${label}\n¿Está disponible?`);
});

// ---------------- Amazon Sidebar UI (eventos) ----------------
function buildCategorySidebar(){
  const catList = $("#catList");
  if(!catList) return;

  const counts = {};
  for(const p of PRODUCTS){
    const c = p.category || "otros";
    counts[c] = (counts[c]||0) + 1;
  }
  const cats = Object.keys(counts).sort((a,b)=> (counts[b]-counts[a]) || a.localeCompare(b));

  const total = PRODUCTS.length;
  catList.innerHTML = [
    `<button class="cat-btn ${state.cat==="all" ? "active" : ""}" data-cat="all">
      Todas <span class="cat-meta">(${total})</span>
    </button>`,
    ...cats.map(c => `
      <button class="cat-btn ${state.cat===c ? "active" : ""}" data-cat="${c}">
        ${cap(c)} <span class="cat-meta">(${counts[c]})</span>
      </button>
    `)
  ].join("");

  catList.addEventListener("click", (e)=>{
    const btn = e.target.closest(".cat-btn");
    if(!btn) return;

    state.cat = btn.dataset.cat || "all";

    [...catList.querySelectorAll(".cat-btn")].forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");

    sync();
  });
}

function bindAmazonControls(){
  // buscador (topbar)
  const q = $("#q");
  if(q){
    q.addEventListener("input", ()=>{
      state.q = q.value || "";
      clearTimeout(window.__rs_qt);
      window.__rs_qt = setTimeout(sync, 180);
    });
  }

  const btnClear = $("#btnClear");
  if(btnClear){
    btnClear.addEventListener("click", ()=>{
      if(q) q.value = "";
      state.q = "";
      sync();
    });
  }

  // precio
  const minI = $("#minPrice");
  const maxI = $("#maxPrice");
  const btnApply = $("#btnApplyPrice");
  if(btnApply){
    btnApply.addEventListener("click", ()=>{
      const minV = Number(minI?.value ?? "");
      const maxV = Number(maxI?.value ?? "");
      state.minPrice = Number.isFinite(minV) ? minV : null;
      state.maxPrice = Number.isFinite(maxV) ? maxV : null;
      sync();
    });
  }

  // checks
  const onlyStock = $("#onlyStock");
  if(onlyStock){
    onlyStock.addEventListener("change", ()=>{
      state.onlyStock = !!onlyStock.checked;
      sync();
    });
  }

  const onlyFeatured = $("#onlyFeatured");
  if(onlyFeatured){
    onlyFeatured.addEventListener("change", ()=>{
      state.onlyFeatured = !!onlyFeatured.checked;
      sync();
    });
  }

  // sort
  const sortBy = $("#sortBy");
  if(sortBy){
    sortBy.addEventListener("change", ()=>{
      state.sort = sortBy.value || "featured";
      sync();
    });
  }

  // reset
  const btnReset = $("#btnReset");
  if(btnReset){
    btnReset.addEventListener("click", ()=>{
      state.cat = "all";
      state.q = "";
      state.sort = "featured";
      state.minPrice = null;
      state.maxPrice = null;
      state.onlyStock = false;
      state.onlyFeatured = false;

      // reset UI
      if(q) q.value = "";
      if(minI) minI.value = "";
      if(maxI) maxI.value = "";
      if(onlyStock) onlyStock.checked = false;
      if(onlyFeatured) onlyFeatured.checked = false;
      if(sortBy) sortBy.value = "featured";

      // activar "Todas"
      const catList = $("#catList");
      if(catList){
        [...catList.querySelectorAll(".cat-btn")].forEach(b=>b.classList.remove("active"));
        const first = catList.querySelector(`[data-cat="all"]`);
        if(first) first.classList.add("active");
      }

      sync();
    });
  }
}

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

  // ✅ PayPal solo exterior (se actualiza cada vez que cambia el carrito)
  setupPayPalOnlyExterior(() => state.cartTotalUYU || 0);
}


// ---------------- Init ----------------
(async function init(){
  try{
    // FIX CRÍTICO: asegurarse de que el modal arranca cerrado
    const m = document.querySelector("#modal");
    if (m) m.hidden = true;

    document.body.style.overflow = "";

    await loadConfig();
    await loadCatalog();

    // detectar país solo para AUTO
    await detectCountry();

    // set select value
    const cur = document.querySelector("#currency");
    if (cur) cur.value = state.displayCurrency;

    // construir sidebar + listeners
    buildCategorySidebar();
    bindAmazonControls();

    // shipping + render
    await buildShippingOptions();
    await sync();
  }catch(e){
    if(productsEl) productsEl.innerHTML = `<div class="small">❌ Error cargando tienda: ${e.message}</div>`;
    console.error(e);
  }
})();

// ==============================
// PayPal SOLO EXTERIOR (sin tocar MP)
// ==============================

// 1) Detectar país del visitante (simple y bastante confiable)
async function detectCountryPayPal(){

  try{
    // ipapi.co suele funcionar bien sin key para country
    const r = await fetch("https://ipapi.co/json/");
    const j = await r.json();
    return (j && j.country_code) ? String(j.country_code).toUpperCase() : null;
  }catch(e){
    return null; // si falla, no mostramos PayPal
  }
}

// 2) Armar link PayPal "Buy Now" (simple, sin SDK)
// Reemplazás TU_PAYPAL_ME por tu usuario PayPal.me (ej: runandsport)
function buildPayPalMeLink(totalUYU, note){
  // Si querés cobrar en USD, cambiá "UYU" por "USD".
  const currency = "USD";

  // Convertimos UYU -> USD usando un tipo fijo para NO depender de APIs.
  // Cambiá el 40 por el tipo que prefieras (ej: 40 UYU ≈ 1 USD).
  const FX = 40;

  const amount = Math.max(1, Math.round((Number(totalUYU) / FX) * 100) / 100); // 2 decimales
  const base = "https://www.paypal.me/TU_PAYPAL_ME";
  const url = `${base}/${amount}${currency}`;
  // Nota: PayPal.me no siempre admite "note" como parámetro; lo dejamos para mostrar al usuario si querés
  return url;
}

// 3) Mostrar PayPal solo si NO es Uruguay
async function setupPayPalOnlyExterior(getCartTotalUYU){
  const box = document.getElementById("paypalBox");
  const btn = document.getElementById("paypalBtn");
  if(!box || !btn) return;

  const country = await detectCountryPayPal();


  // Solo exterior: si es UY, oculto.
  if(country === "UY"){
    box.style.display = "none";
    return;
  }

  // Si no pudimos detectar país, por seguridad NO lo mostramos.
  if(!country){
    box.style.display = "none";
    return;
  }

  // Exterior: lo muestro y armo link
  const totalUYU = getCartTotalUYU();
  const note = "Run&Sport compra internacional";
  btn.href = buildPayPalMeLink(totalUYU, note);
  box.style.display = "block";
}
