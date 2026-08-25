import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CRAWLER_PROFILE_DIR = join(homedir(), ".opencode", ".crawler-profile");

function getProfileDir() {
  if (!existsSync(CRAWLER_PROFILE_DIR)) mkdirSync(CRAWLER_PROFILE_DIR, { recursive: true });
  return CRAWLER_PROFILE_DIR;
}

function isLinkedInUrl(url) {
  try { return new URL(url).hostname.includes("linkedin.com"); } catch { return false; }
}

async function crawl(urls, maxChars, doScroll, maxScrolls) {
  const profileDir = getProfileDir();
  let browser;
  try {
    browser = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
      ],
    });

    const results = [];
    for (const url of urls) {
      try { new URL(url); } catch {
        results.push({ url, title: "", content: "", status: 0, meta: {}, error: "Invalid URL" });
        continue;
      }
      try {
        const page = await browser.newPage();
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", { get: () => false });
          Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
          window.chrome = { runtime: {} };
        });
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(3000);

        if (doScroll) {
          for (let i = 0; i < maxScrolls; i++) {
            const prevHeight = await page.evaluate(() => document.body.scrollHeight);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(3000);
            const newHeight = await page.evaluate(() => document.body.scrollHeight);
            const noMore = await page.evaluate(() => {
              const btn = document.querySelector(
                '[aria-label="See more"], [aria-label="Show more"], button[aria-label*="more"]'
              );
              if (btn && btn.offsetParent !== null) return false;
              return true;
            });
            if (newHeight === prevHeight && noMore) break;
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(2000);
        }

        let posts = undefined;
        let content = "";
        let title = "";
        let profileImgUrl = null;

        if (isLinkedInUrl(url)) {
          const linkedinData = await page.evaluate((limit) => {
            let imgUrl = null;
            const selectors = [
              "img.pv-top-card-profile-picture__image--show",
              "img.pv-top-card-profile-picture__image",
              "img.profile-photo",
              "img.presence-entity__image",
              ".presence-entity img",
              "img[data-delayed-url]",
              "img.artdeco-entity-image",
              ".pv-top-card img",
              "img[alt*='photo']",
              "img[alt*='profile']",
              "img[alt*='picture']",
            ];
            for (const sel of selectors) {
              const img = document.querySelector(sel);
              if (img) {
                const src = img.src || img.dataset?.delayedUrl || "";
                if (src && !src.includes("ghost.png") && !src.includes("generic-avatar") && !src.includes("data:image")) {
                  imgUrl = src;
                  break;
                }
              }
            }
            if (!imgUrl) {
              const topSection = document.querySelector(".pv-top-card, .profile-detail, header");
              if (topSection) {
                const imgs = topSection.querySelectorAll("img");
                let largest = "";
                let maxSize = 0;
                for (const img of imgs) {
                  const src = img.src || img.dataset?.delayedUrl || "";
                  const size = img.width || img.naturalWidth || 0;
                  if (src && size > maxSize && !src.includes("ghost.png") && !src.includes("data:image")) {
                    maxSize = size;
                    largest = src;
                  }
                }
                if (largest) imgUrl = largest;
              }
            }

            const postSelectors = [
              "article[data-urn]",
              ".feed-shared-update-v2",
              ".share-update-with-text",
              "[data-testid='feed-shared-update']",
              ".occludable-update",
              ".share-box-feed-entry",
            ];
            let postElements = [];
            for (const sel of postSelectors) {
              const found = document.querySelectorAll(sel);
              if (found.length > 0) { postElements = Array.from(found); break; }
            }
            if (postElements.length === 0) {
              postElements = Array.from(document.querySelectorAll("article, [role='article']"));
            }
            const posts = postElements.map((el) => {
              const textEl = el.querySelector(".feed-shared-text, .break-words, [data-testid='feed-shared-text']") || el.querySelector(".feed-shared-main-content") || el;
              const timeEl = el.querySelector("time");
              const reactionsEl = el.querySelector(".social-details-react-count, .reactions-count");
              const commentsEl = el.querySelector(".social-details-comments-count");
              return {
                text: textEl?.textContent?.trim()?.slice(0, 3000) || "",
                time: timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim() || undefined,
                likes: reactionsEl?.textContent?.trim() || undefined,
                comments: commentsEl?.textContent?.trim() || undefined,
              };
            }).filter((p) => p.text.length > 20);

            const clone = document.body.cloneNode(true);
            const removeSelectors = [
              "script", "style", "noscript", "svg", "nav", "header", "footer",
              ".global-nav", ".application-outlet", ".signup-rail",
              "[data-test-id='signup-rail']", ".feed-identity-module",
              ".artdeco-card", ".pv-top-card", ".scaffold-layout__sidebar",
              ".scaffold-layout__detail", ".org-footer", ".profile-detail",
              ".pv-actions", ".pv-profile-sticky-header",
            ];
            for (const sel of removeSelectors) {
              for (const e of clone.querySelectorAll(sel)) e.remove();
            }
            for (const el of clone.querySelectorAll("a, button")) {
              const text = el.textContent?.trim().toLowerCase() || "";
              if (["home", "my network", "jobs", "messaging", "notifications", "me",
                   "for business", "try premium", "sign in", "join now",
                   "enhance profile", "add section", "open to", "show details",
                   "show all", "view analytics", "create a post", "posts",
                   "comments", "videos", "images", "follow", "connect"].some(k => text === k)) {
                el.remove();
              }
            }
            const blockTags = ["DIV", "P", "BR", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "SECTION", "ARTICLE"];
            const walk = (node) => {
              if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
              if (node.nodeType !== Node.ELEMENT_NODE) return "";
              const el = node;
              const display = window.getComputedStyle(el).display;
              const isBlock = display === "block" || display === "flex" || display === "grid" || blockTags.includes(el.tagName);
              let result = "";
              for (const child of el.childNodes) { result += walk(child); }
              if (el.tagName === "BR") return result + "\n";
              if (isBlock) return result + "\n";
              return result;
            };
            const rawContent = walk(clone)
              .replace(/[ \t]+/g, " ")
              .replace(/\n\s+/g, "\n")
              .replace(/\n{3,}/g, "\n\n")
              .split("\n").map((line) => line.trim()).filter((line) => line.length > 0).join("\n").trim();
            return { posts, content: rawContent.slice(0, limit), imgUrl };
          }, maxChars);
          posts = linkedinData.posts.length > 0 ? linkedinData.posts : undefined;
          content = linkedinData.content;
          profileImgUrl = linkedinData.imgUrl;
        } else {
          content = await page.evaluate((limit) => {
            const el = document.body;
            if (!el) return "";
            const clone = el.cloneNode(true);
            for (const tag of ["script", "style", "noscript", "svg"]) {
              for (const e of clone.querySelectorAll(tag)) e.remove();
            }
            const walk = (node) => {
              if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
              if (node.nodeType !== Node.ELEMENT_NODE) return "";
              const el = node;
              const display = window.getComputedStyle(el).display;
              const isBlock = display === "block" || display === "flex" || display === "grid" ||
                ["DIV", "P", "BR", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TR", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "NAV"].includes(el.tagName);
              let result = "";
              for (const child of el.childNodes) { if (result.length >= limit) break; result += walk(child); }
              if (el.tagName === "BR") return result + "\n";
              if (isBlock) return result + "\n";
              return result;
            };
            return walk(clone).trim().replace(/\n{3,}/g, "\n\n").slice(0, limit);
          }, maxChars);
        }

        title = await page.title();
        const meta = await page.evaluate(() => {
          const m = {};
          const desc = document.querySelector('meta[name="description"]');
          if (desc) m.description = desc.getAttribute("content") || "";
          const ogTitle = document.querySelector('meta[property="og:title"]');
          if (ogTitle) m["og:title"] = ogTitle.getAttribute("content") || "";
          return m;
        });

        results.push({ url, title, meta: { ...meta, ...(profileImgUrl ? { profileImgUrl } : {}) }, content, posts, status: 200 });
        await page.close();
      } catch (err) {
        results.push({ url, title: "", content: "", status: 0, meta: {}, error: err.message || String(err) });
      }
    }
    return results;
  } finally {
    if (browser) await browser.close();
  }
}

const input = JSON.parse(process.argv[2]);
const results = await crawl(input.urls, input.maxChars, input.doScroll, input.maxScrolls);
process.stdout.write(JSON.stringify(results));
