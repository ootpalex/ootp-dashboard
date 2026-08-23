#!/usr/bin/env node
// Headless-Chrome (CDP) screenshot harness for the running dev server — no puppeteer needed (Node 22 WebSocket).
// Usage: node shoot-app.mjs --url http://localhost:3011 --league BLM-ATL --out shots --pages "Draft Board,Prospects" [--w 1440 --h 1000] [--full] [--pre "js"] [--per "js"]
//   --pre  JS evaluated once after the app has loaded (e.g. set localStorage toggles)  --per JS evaluated after each page click (e.g. click a sub-tab)
import { spawn } from "node:child_process"; import fs from "node:fs"; import path from "node:path";
const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, arr) => { if (x.startsWith("--")) acc.push([x.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] == null ? true : arr[i + 1]]); return acc; }, []));
const URL0 = a.url || "http://localhost:3011", W = +(a.w || 1440), H = +(a.h || 1000), OUT = a.out || "shots", PAGES = (a.pages || "").split(",").map(s => s.trim()).filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; const port = 9400 + Math.floor(Math.random() * 300);
const udir = fs.mkdtempSync("/tmp/cdp-"); const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${udir}`, `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(200); } }
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(URL0)}`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
await send("Page.enable"); await send("Runtime.enable"); await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const waitApp = async () => { for (let i = 0; i < 100; i++) { if (await ev(`document.querySelectorAll('[role=tab]').length > 0 && !/Loading/.test(document.body.innerText.slice(0,2000))`)) return true; await sleep(200); } return false; };
await waitApp();
if (a.league) { await ev(`localStorage.setItem('ssb_current_league', ${JSON.stringify(a.league)})`); await send("Page.reload"); await sleep(500); await waitApp(); }
if (a.pre && a.pre !== true) { await ev(a.pre); await sleep(800); }
const shot = async (name) => { let h = H; if (a.full) { h = Math.min(await ev("document.documentElement.scrollHeight"), 6000); await send("Emulation.setDeviceMetricsOverride", { width: W, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(300); } const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); if (a.full) await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false }); };
const results = [];
if (PAGES.length === 0) { await shot("current"); results.push({ page: "current", sw: await ev("document.documentElement.scrollWidth") }); }
for (const p of PAGES) {
  const ok = await ev(`(()=>{const b=[...document.querySelectorAll('[role=tab]')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(p)});if(!b)return false;b.click();return true})()`);
  await sleep(1200); for (let i = 0; i < 25; i++) { if (!(await ev("/Loading/.test(document.body.innerText.slice(0,3000))"))) break; await sleep(200); }
  if (a.per && a.per !== true) { await ev(a.per); await sleep(800); }
  const m = await ev("({sw:document.documentElement.scrollWidth, boundary:document.body.innerText.includes('Something went wrong'), h:document.documentElement.scrollHeight})");
  const slug = p.toLowerCase().replace(/[^a-z0-9]+/g, "-"); await shot(slug); results.push({ page: p, found: ok, ...m, file: `${OUT}/${slug}.png` });
}
console.log(JSON.stringify(results, null, 1)); ws.close(); chrome.kill(); await sleep(400); try { fs.rmSync(udir, { recursive: true, force: true }); } catch {}
