import { mkdir, writeFile } from "node:fs/promises";
await mkdir("assets", { recursive: true });
const svg = (body, w = 600, h = 600) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const pieces = {
  light:
    '<rect width="600" height="600" fill="#e8dfc9"/><rect x="80" y="60" width="240" height="350" fill="#b3beab"/><path d="M320 60L570 265V570H320Z" fill="#f7edcf"/><path d="M80 410H320L570 570H190Z" fill="#c1b79d"/><path d="M200 60V410M80 235H320" stroke="#e8dfc9" stroke-width="15"/><circle cx="460" cy="100" r="25" fill="#e0bb6e"/>',
  route:
    '<rect width="600" height="600" fill="#dce6d7"/><path d="M-30 500C130 580 70 120 290 80S350 520 650 360" fill="none" stroke="#72927a" stroke-width="70"/><path d="M-30 500C130 580 70 120 290 80S350 520 650 360" fill="none" stroke="#f6f7eb" stroke-width="2" stroke-dasharray="8 12"/><circle cx="165" cy="295" r="25" fill="#d5b278"/><circle cx="396" cy="300" r="16" fill="#f2e5c3"/>',
  rest: '<rect width="600" height="600" fill="#dedfd7"/><circle cx="310" cy="270" r="180" fill="#f0eee2"/><rect x="150" y="325" width="300" height="27" rx="8" fill="#758477"/><path d="M175 352V460M425 352V460" stroke="#758477" stroke-width="18"/><path d="M175 325V270M425 325V270" stroke="#758477" stroke-width="14"/><rect x="150" y="225" width="300" height="60" rx="10" fill="#98a592"/>',
  type: '<rect width="600" height="600" fill="#e6dfd2"/><rect x="90" y="75" width="420" height="450" fill="#faf8ee"/><text x="135" y="170" font-family="serif" font-size="16" letter-spacing="5" fill="#8b977d">OBSERVATION NO. 01</text><text x="135" y="265" font-family="serif" font-size="63" fill="#536b51">Look.</text><text x="135" y="340" font-family="serif" font-size="63" fill="#536b51">Slowly.</text><path d="M135 390H455" stroke="#a8b29b"/><text x="135" y="440" font-family="sans-serif" font-size="13" letter-spacing="2" fill="#8b977d">LIGHT / PATH / REST</text>',
  icon: '<rect width="64" height="64" rx="16" fill="#315f4e"/><text x="16" y="48" font-family="Georgia,serif" font-size="54" fill="#fff">p.</text>',
};
for (const [name, body] of Object.entries(pieces))
  await writeFile(
    `assets/${name}.svg`,
    svg(body, name === "icon" ? 64 : 600, name === "icon" ? 64 : 600),
  );
console.log("Wrote five original SVG assets.");
