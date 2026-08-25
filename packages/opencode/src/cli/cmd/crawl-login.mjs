import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CRAWLER_PROFILE_DIR = join(homedir(), ".opencode", ".crawler-profile");

function getProfileDir() {
  if (!existsSync(CRAWLER_PROFILE_DIR)) mkdirSync(CRAWLER_PROFILE_DIR, { recursive: true });
  return CRAWLER_PROFILE_DIR;
}

async function openLoginBrowser(loginUrl) {
  const profileDir = getProfileDir();
  let browser;
  try {
    try {
      browser = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check",
          "--no-sandbox",
        ],
      });
    } catch {
      browser = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        viewport: { width: 1280, height: 800 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check",
          "--no-sandbox",
        ],
      });
    }

    const page = browser.pages()[0] || await browser.newPage();
    page.setDefaultTimeout(0);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      window.chrome = { runtime: {} };
    });
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    process.stderr.write("\nChrome browser opened for LinkedIn login.\n");
    process.stderr.write("Please log in manually in the browser window.\n");

    await page.waitForFunction(
      () => {
        const url = window.location.href;
        if (url.includes("/feed") || url.includes("/in/") || url.includes("/mynetwork") || url.includes("/jobs")) return true;
        const userMenu = document.querySelector(".feed-identity-module, .global-nav__me, img.profile-photo");
        if (userMenu) return true;
        return false;
      },
      { timeout: 0 },
    );

    process.stderr.write("Login detected! Saving session and closing browser...\n");
    await browser.close();
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }
}

const loginUrl = process.argv[2];
await openLoginBrowser(loginUrl);
process.stderr.write("Login session saved. You can now crawl LinkedIn profiles.\n");
