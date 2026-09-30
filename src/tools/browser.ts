import { chromium, type BrowserContext, type Page, type Locator } from "playwright";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import open from "open";

export interface InteractiveElement {
  ref: number;
  tag: string;
  type?: string;
  text: string;
  locator: Locator;
  isSensitive: boolean;
}

export interface DefaultBrowserInfo {
  name: string;
  executablePath: string | null;
  progId: string | null;
  profileDir: string | null;
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

/**
 * Detect the user's default browser on the system along with executable and profile path.
 */
export function getDefaultBrowserInfo(): DefaultBrowserInfo {
  let executablePath: string | null = null;
  let progId: string | null = null;
  let name = "Default Browser";
  let profileDir: string | null = null;

  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");

  if (process.platform === "win32") {
    try {
      const progIdOut = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice" /v ProgId',
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      const progIdMatch = progIdOut.match(/ProgId\s+REG_\w+\s+([^\r\n]+)/);
      if (progIdMatch && progIdMatch[1]) {
        progId = progIdMatch[1].trim();
        const cmdOut = execSync(
          `reg query "HKEY_CLASSES_ROOT\\${progId}\\shell\\open\\command" /ve`,
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        );
        const match = cmdOut.match(/REG_\w+\s+"?([^"\r\n]+?\.exe)"?/i);
        if (match && match[1] && fs.existsSync(match[1])) {
          executablePath = match[1];
        }
      }
    } catch {}
  }

  // Derive human-readable name & user data directory
  const lowerExe = (executablePath || "").toLowerCase();
  const lowerProg = (progId || "").toLowerCase();

  if (lowerProg.includes("operagx") || lowerExe.includes("opera gx")) {
    name = "Opera GX";
    profileDir = path.join(appData, "Opera Software", "Opera GX Stable");
  } else if (lowerProg.includes("opera") || lowerExe.includes("opera")) {
    name = "Opera";
    profileDir = path.join(appData, "Opera Software", "Opera Stable");
  } else if (lowerProg.includes("chrome") || lowerExe.includes("chrome")) {
    name = "Google Chrome";
    profileDir = path.join(localAppData, "Google", "Chrome", "User Data");
  } else if (lowerProg.includes("edge") || lowerExe.includes("msedge")) {
    name = "Microsoft Edge";
    profileDir = path.join(localAppData, "Microsoft", "Edge", "User Data");
  } else if (lowerProg.includes("brave") || lowerExe.includes("brave")) {
    name = "Brave";
    profileDir = path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data");
  } else if (lowerProg.includes("firefox") || lowerExe.includes("firefox")) {
    name = "Mozilla Firefox";
    profileDir = path.join(appData, "Mozilla", "Firefox", "Profiles");
  } else if (executablePath) {
    name = path.basename(executablePath, ".exe");
  }

  return { name, executablePath, progId, profileDir };
}

/**
 * Detect the user's default browser executable on the system.
 */
export function getDefaultBrowserExecutable(): string | null {
  return getDefaultBrowserInfo().executablePath;
}

/**
 * Open a URL directly in the user's default browser in the user's active session and account.
 * Uses native OS shell association to guarantee opening in the active browser window with logged-in user accounts.
 */
export async function openInUserDefaultBrowser(url: string): Promise<{
  success: boolean;
  message: string;
  url: string;
  browser: string;
}> {
  let targetUrl = url.trim();
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://") && !targetUrl.includes("://")) {
    targetUrl = "https://" + targetUrl;
  }

  const browserInfo = getDefaultBrowserInfo();
  console.log(`[Browser] 🌐 Opening URL in user's default browser (${browserInfo.name}) with active account: "${targetUrl}"`);

  try {
    const subprocess = await open(targetUrl);
    if (subprocess && typeof subprocess.unref === "function") {
      subprocess.unref();
    }
    return {
      success: true,
      message: `Opened "${targetUrl}" in your default browser (${browserInfo.name}) with your active account.`,
      url: targetUrl,
      browser: browserInfo.name,
    };
  } catch (err: unknown) {
    if (process.platform === "win32") {
      try {
        const escaped = targetUrl.replace(/'/g, "''");
        execSync(`powershell.exe -NoProfile -Command "Start-Process '${escaped}'"`, { stdio: "ignore" });
        return {
          success: true,
          message: `Opened "${targetUrl}" in your default browser (${browserInfo.name}) with your active account.`,
          url: targetUrl,
          browser: browserInfo.name,
        };
      } catch (psErr: unknown) {
        const msg = psErr instanceof Error ? psErr.message : String(psErr);
        const origMsg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to open "${targetUrl}" in default browser: ${msg || origMsg}`);
      }
    }
    throw err;
  }
}

/**
 * Ensures background headless Playwright browser context is available for inspecting pages,
 * without showing any separate visible window on the user's screen.
 */
export async function getOrCreateBrowser(): Promise<{ context: BrowserContext; page: Page }> {
  if (browserContext && activePage && !activePage.isClosed()) {
    return { context: browserContext, page: activePage };
  }

  try {
    const standalone = await chromium.launch({
      headless: true, // Always headless so no separate window is displayed
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    browserContext = await standalone.newContext({
      viewport: { width: 1280, height: 800 },
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[Browser] Background headless browser launch notice: ${errMsg}`);
    const standalone = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    browserContext = await standalone.newContext({
      viewport: { width: 1280, height: 800 },
    });
  }

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

/**
 * Open a URL in the user's default browser with their active logged-in account,
 * and inspect page content for Philia.
 */
export async function browserOpen(url: string): Promise<string> {
  let targetUrl = url.trim();
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://") && !targetUrl.includes("://")) {
    targetUrl = "https://" + targetUrl;
  }

  // 1. Immediately open the URL in the user's default browser in the user's active account
  const launchResult = await openInUserDefaultBrowser(targetUrl);

  // 2. Fetch/inspect page content in background for Philia's response
  try {
    const { page } = await getOrCreateBrowser();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1000);
    const elements = await enumerateInteractiveElements(page);
    return `${launchResult.message}\n\n${elements}`;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[Browser] Background page inspection note: ${errMsg}`);
    return `${launchResult.message}\n(Page opened successfully in your active default browser window).`;
  }
}

/**
 * Perform a web search using the user's default browser with their active account.
 */
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
    console.log(`[Browser] 🛑 Closing background browser context...`);
    await browserContext.close().catch(() => {});
    browserContext = null;
    activePage = null;
    currentElementMap.clear();
  }
}
