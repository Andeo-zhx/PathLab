import puppeteer from 'puppeteer-core';


const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const page = await browser.newPage();

async function probe(w, h, dpr, zoom) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
  if (zoom) await page.evaluate((z) => document.body.style.zoom = z, zoom).catch(() => {});
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
  await sleep(900);
  const m = await page.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left) }; };
    return {
      inner: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      topbar: g('.topbar'),
      panel: g('.writing-region'),
      rail: g('.tool-rail'),
      brandFont: getComputedStyle(document.querySelector('.brand-name')).fontSize,
      titleFont: getComputedStyle(document.querySelector('.empty-guide .eg-title')).fontSize,
      bodyFont: getComputedStyle(document.body).fontSize,
    };
  });
  console.log(w + 'x' + h + ' dpr=' + dpr + (zoom ? ' zoom=' + zoom : ''), JSON.stringify(m));
}

await probe(1600, 1000, 1);
await probe(2840, 1476, 1);
await probe(1420, 738, 2);
await probe(2840, 1476, 0.45);
await browser.close();
