const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#0f172a"/>
  <path d="M16 44 28 14h8l12 30h-8l-2.2-6H26.2L24 44h-8Zm12.4-12h7.2L32 22.2 28.4 32Z" fill="#f8fafc"/>
  <path d="M17 50h30" stroke="#38bdf8" stroke-width="4" stroke-linecap="round"/>
</svg>`;

export function GET() {
  return new Response(faviconSvg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
