import { chromium, type BrowserContext, type Page, type Locator } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";

export interface InteractiveElement {
  ref: number;
  tag: string;
  type?: string;
  text: string;
  locator: Locator;
  isSensitive: boolean;
}

export type BrowserConfirmationHandler = (actionDescription: string) => Promise<boolean> | boolean;

let defaultBrowserConfirmationHandler: BrowserConfirmationHandler = async (action) => {
  console.log(`[Guardrail Browser Confirmation] Auto-acknowledging: ${action}`);
  return true;
};

export function setBrowserConfirmationHandler(handler: BrowserConfirmationHandler) {
  defaultBrowserConfirmationHandler = handler;
}

let browserContext: BrowserContext | null = null;
let activePage: Page | null = null;
const currentElementMap = new Map<number, InteractiveElement>();

const USER_DATA_DIR = path.resolve(process.cwd(), "browser_profile");

/**
 * Ensures Playwright dedicated profile exists and browser context is launched.
 */
export async function getOrCreateBrowser(): Promise<{ context: BrowserContext; page: Page }> {
  if (browserContext && activePage && !activePage.isClosed()) {
    return { context: browserContext, page: activePage };
  }

  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  console.log(`[Browser] 🌐 Launching browser (Headless: ${config.browserHeadless}, Profile: "${USER_DATA_DIR}")`);

  browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: config.browserHeadless,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const pages = browserContext.pages();
  activePage = pages.length > 0 ? pages[0] : await browserContext.newPage();

  activePage.on("close", () => {
    activePage = null;
    currentElementMap.clear();
  });

  return { context: browserContext, page: activePage };
}

function isSensitivePage(title: string, url: string, bodyText: string): boolean {
  const sensitiveKeywords = [
    "sign in", "log in", "login", "signin",
    "password", "checkout", "payment", "credit card", "billing",
    "purchase", "order summary", "authenticate", "2-step"
  ];
  const combined = (title + " " + url + " " + bodyText.slice(0, 1000)).toLowerCase();
  return sensitiveKeywords.some((kw) => combined.includes(kw));
}

export async function enumerateInteractiveElements(page: Page): Promise<string> {
  currentElementMap.clear();

  const title = await page.title().catch(() => "Untitled");
  const url = page.url();

  const selector = `
    button,
    a[href],
    input:not([type="hidden"]),
    select,
    textarea,
    [role="button"],
    [role="link"],
    [role="checkbox"],
    [role="menuitem"]
  `;

  const locators = page.locator(selector);
  const count = await locators.count().catch(() => 0);

  const elementsSummary: string[] = [];
  let refCounter = 1;
  const maxElements = 40;

  const bodySnippet = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 800) : "").catch(() => "");
  const pageSensitive = isSensitivePage(title, url, bodySnippet);

  for (let i = 0; i < count && refCounter <= maxElements; i++) {
    const loc = locators.nth(i);

    const isVisible = await loc.isVisible().catch(() => false);
    if (!isVisible) continue;

    const data = await loc.evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      const type = (el as HTMLInputElement).type || "";
      const text = (el.textContent || "").trim().replace(/\s+/g, " ");
      const placeholder = (el as HTMLInputElement).placeholder || "";
      const ariaLabel = el.getAttribute("aria-label") || "";
      const name = (el as HTMLInputElement).name || "";
      const value = (el as HTMLInputElement).value || "";
      const role = el.getAttribute("role") || "";

      let label = text || ariaLabel || placeholder || name || value || role;
      if (label.length > 50) label = label.slice(0, 47) + "...";

      const isPassword = type.toLowerCase() === "password";
      return { tag, type, label, isPassword };
    }).catch(() => null);

    if (!data) continue;

    const isSensitive = pageSensitive || data.isPassword || /log\s*in|sign\s*in|pay|buy|checkout/i.test(data.label);

    currentElementMap.set(refCounter, {
      ref: refCounter,
      tag: data.tag,
      type: data.type,
      text: data.label,
      locator: loc,
      isSensitive,
    });

    const typeStr = data.type ? ` type="${data.type}"` : "";
    const sensWarn = isSensitive ? " [SENSITIVE/AUTH/PAYMENT]" : "";
    elementsSummary.push(`[${refCounter}] <${data.tag}${typeStr}> "${data.label}"${sensWarn}`);
    refCounter++;
  }

  const sensitivityNotice = pageSensitive
    ? "\n⚠️ NOTICE: This appears to be a login, checkout, or payment page. Sensitive actions require explicit confirmation."
    : "";

  return `Page Title: "${title}"\nURL: ${url}${sensitivityNotice}\n\nInteractive Elements:\n` +
    (elementsSummary.length > 0 ? elementsSummary.join("\n") : "(No interactive elements detected)");
}

export async function browserOpen(url: string): Promise<string> {
  let targetUrl = url;
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    targetUrl = "https://" + targetUrl;
  }

  console.log(`[Browser] 🌐 Navigating to "${targetUrl}"...`);
  const { page } = await getOrCreateBrowser();

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1000);
  } catch (err) {
    console.warn(`[Browser] Navigation timeout/warning: ${err}`);
  }

  return await enumerateInteractiveElements(page);
}

export async function browserSearch(query: string): Promise<string> {
  console.log(`[Browser] 🔍 browserSearch(query="${query}")`);
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  return await browserOpen(searchUrl);
}

export async function browserClick(ref: number): Promise<string> {
  console.log(`[Browser] 🖱️ browserClick(ref=${ref})`);
  const { page } = await getOrCreateBrowser();

  const element = currentElementMap.get(ref);
  if (!element) {
    throw new Error(`Invalid element ref [${ref}]. Please call browserReadPage() to view valid interactive element refs.`);
  }

  if (element.isSensitive) {
    const actionDesc = `Click sensitive element [${ref}] <${element.tag}> "${element.text}" on ${page.url()}`;
    console.log(`[Browser Guardrail] ⚠️ ${actionDesc}`);
    const confirmed = await defaultBrowserConfirmationHandler(actionDesc);
    if (!confirmed) {
      return `Action cancelled: User declined permission to click sensitive element [${ref}] "${element.text}".`;
    }
  }

  await element.locator.click({ timeout: 10000 });
  await page.waitForTimeout(1500);

  return await enumerateInteractiveElements(page);
}

export async function browserType(ref: number, text: string, pressEnter: boolean = false): Promise<string> {
  console.log(`[Browser] ⌨️ browserType(ref=${ref}, text="${text}", pressEnter=${pressEnter})`);
  const { page } = await getOrCreateBrowser();

  const element = currentElementMap.get(ref);
  if (!element) {
    throw new Error(`Invalid element ref [${ref}]. Please call browserReadPage() to view valid interactive element refs.`);
  }

  await element.locator.fill(text, { timeout: 10000 });

  if (pressEnter) {
    console.log(`[Browser] ↵ Pressing Enter...`);
    await element.locator.press("Enter");
    await page.waitForTimeout(1500);
  }

  return await enumerateInteractiveElements(page);
}

export async function browserReadPage(): Promise<string> {
  console.log(`[Browser] 📄 browserReadPage()`);
  const { page } = await getOrCreateBrowser();

  const elementsSummary = await enumerateInteractiveElements(page);

  const textContent = await page.evaluate(() => {
    const main = document.querySelector("main") || document.querySelector("article") || document.body;
    if (!main) return "";
    return main.innerText.slice(0, 3000);
  }).catch(() => "");

  return `${elementsSummary}\n\nReadable Page Text Excerpt:\n${textContent.slice(0, 1500)}`;
}

export async function browserClose(): Promise<void> {
  if (browserContext) {
    console.log(`[Browser] 🛑 Closing browser context...`);
    await browserContext.close().catch(() => {});
    browserContext = null;
    activePage = null;
    currentElementMap.clear();
  }
}
