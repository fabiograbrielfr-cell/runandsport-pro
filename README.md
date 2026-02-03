# Run&Sport PRO (Proyecto listo)

Este proyecto es una tienda online **simple y sólida** (HTML/CSS/JS + Node/Express) con:

- ✅ Catálogo por categorías (deportes, tenis, pádel, beach tennis, electrónica, movilidad eléctrica)
- ✅ Ficha de producto con **galería de fotos** (miniaturas)
- ✅ Carrito + checkout por **WhatsApp**
- ✅ Checkout por **Mercado Pago (Checkout Pro)** (precios blindados en el servidor)
- ✅ **Multi-moneda**: el usuario puede elegir moneda o dejar **AUTO** (detecta país).  
  *Mercado Pago se procesa en UYU (UY). Para exterior se recomienda WhatsApp (cotiza envío).*
- ✅ Sección de redes sociales (editable)

---

## 1) Instalar y correr

En la carpeta del proyecto:

```bash
npm install
copy .env.example .env   # en Windows PowerShell
npm start
```

Abrí:
- http://localhost:4000

---

## 2) Configuración Mercado Pago

En `.env` pegá tu token:

```
MP_ACCESS_TOKEN=TU_TOKEN_REAL
BASE_URL=http://localhost:4000
```

> Si usás dominio o ngrok, **BASE_URL** debe ser la URL pública (https://...)

---

## 3) Editar productos (fácil)

Todo se edita en:

`server/catalog.json`

Cada producto tiene:
- `id` (único)
- `category`
- `title`, `desc`, `tag`
- `price` y `currency` (UYU o USD)
- `images` (lista de rutas dentro de `/public`)
- `specs` (lista de características)

### Ejemplo rápido:

```json
{
  "id": "nuevo1",
  "category": "tenis",
  "title": "Mi Producto",
  "desc": "Descripción...",
  "tag": "Accesorios",
  "price": 990,
  "currency": "UYU",
  "images": ["images/tenis/nuevo1-1.jpg", "images/tenis/nuevo1-2.jpg"],
  "specs": ["Detalle 1", "Detalle 2"],
  "featured": true
}
```

---

## 4) Poner fotos reales

Actualmente las imágenes son **SVG demo** (para que todo funcione).

Para reemplazar por tus fotos:
1. Copiá imágenes a `public/images/...`
2. Actualizá las rutas en `server/catalog.json`

---

## 5) Datos que conviene definir (para dejarlo PERFECTO)

Podés cambiarlo todo en `server/catalog.json` y `.env`:

- Nombre exacto de la tienda (si querés otro)
- WhatsApp (ya está: 59896786514)
- Links de Instagram/Facebook/TikTok/YouTube
- Métodos y costos reales de envío (UY e internacional)
- Monedas que querés mostrar por defecto (UYU / USD)

