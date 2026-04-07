(() => {
  if (window.__ITP_SCRAPPER_INIT__) {
    return;
  }
  window.__ITP_SCRAPPER_INIT__ = true;

  const state =
    window.__ITP_SCRAPPER_STATE__ ||
    {
      isRunning: false,
      shouldStop: false,
      status: "Idle",
      statusText: "Ready",
      progress: 0,
      targetLimit: 100,
      logs: [],
      rows: [],
      exportFormat: "csv",
    };

  window.__ITP_SCRAPPER_STATE__ = state;

  const SELECTORS = {
    listingFeed: [
      'div[role="feed"]',
      'div[aria-label*="Results"][role="feed"]',
      'div[aria-label*="Results"] div[role="feed"]',
    ],
    listingLinks: ['a[href*="/maps/place/"]'],
    detailName: ['h1.DUwDvf', 'h1[class][aria-level="1"]', 'h1'],
    rating: [
      'div[role="main"] span[role="img"][aria-label*="star"]',
      'div[role="main"] span[aria-label*="stars"]',
      'div[role="main"] div.F7nice span[aria-hidden="true"]',
    ],
    addressButton: [
      'button[data-item-id="address"]',
      'button[aria-label^="Address:"]',
      'div[role="main"] [data-item-id="address"]',
    ],
    phoneButton: [
      'button[data-item-id^="phone"]',
      'button[aria-label^="Phone:"]',
      'div[role="main"] [data-item-id*="phone"]',
    ],
    websiteLink: [
      'a[data-item-id="authority"]',
      'a[data-item-id*="authority"]',
      'a[aria-label^="Website:"]',
    ],
    reviewsButton: [
      'button[aria-label*="reviews"]',
      'button[jsaction*="pane.reviewChart.moreReviews"]',
      'button[data-tab-index="1"]',
    ],
    reviewsDialog: [
      'div[role="dialog"]',
      'div.m6QErb[aria-label*="Reviews"]',
      'div[aria-label*="Reviews"]',
    ],
    reviewText: [
      'div[role="dialog"] span.wiI7pd',
      'div[role="dialog"] div.MyEned',
      'div[role="dialog"] div[data-review-id] span',
    ],
  };

  function sendRuntime(type, payload = {}) {
    chrome.runtime.sendMessage({
      source: "itp-scrapper",
      type,
      ...payload,
    });
  }

  function addLog(message) {
    const line = `${new Date().toLocaleTimeString()} - ${message}`;
    state.logs.push(line);
    if (state.logs.length > 200) {
      state.logs = state.logs.slice(-200);
    }
    sendRuntime("SCRAPE_LOG", { log: line });
  }

  function setStatus(status, statusText) {
    state.status = status;
    state.statusText = statusText;

    sendRuntime("SCRAPE_STATUS", {
      status,
      statusText,
      progress: state.progress,
      targetLimit: state.targetLimit,
      scraped: state.rows.length,
    });
  }

  function emitProgress() {
    sendRuntime("SCRAPE_PROGRESS", {
      progress: state.progress,
      targetLimit: state.targetLimit,
      scraped: state.rows.length,
    });
  }

  function getListingFeed() {
    return ITPUtils.getFirstElement(SELECTORS.listingFeed);
  }

  function getListingAnchors(feed) {
    if (!feed) return [];

    const anchors = [...feed.querySelectorAll(SELECTORS.listingLinks[0])].filter((anchor) => {
      const href = anchor.getAttribute("href") || "";
      return href.includes("/maps/place/");
    });

    const byKey = new Map();
    for (const anchor of anchors) {
      const key = ITPUtils.parsePlaceKeyFromUrl(anchor.href || anchor.getAttribute("href"));
      if (!byKey.has(key)) {
        byKey.set(key, anchor);
      }
    }

    return [...byKey.values()];
  }

  async function openListing(anchor) {
    if (!anchor) return false;

    try {
      anchor.scrollIntoView({ behavior: "smooth", block: "center" });
      await ITPUtils.sleep(250, 550);
      anchor.click();
      await ITPUtils.sleep(700, 1200);
      return true;
    } catch {
      return false;
    }
  }

  async function waitForDetailsReady() {
    for (let i = 0; i < 18; i += 1) {
      const name = ITPUtils.getFirstText(SELECTORS.detailName);
      if (name) return true;
      await ITPUtils.sleep(200, 350);
    }
    return false;
  }

  function getRatingValue() {
    const ratingElement = ITPUtils.getFirstElement(SELECTORS.rating);
    if (!ratingElement) return "";

    const source =
      ratingElement.getAttribute("aria-label") ||
      ratingElement.textContent ||
      ratingElement.innerText ||
      "";

    const valueMatch = source.match(/[0-9]+([.,][0-9]+)?/);
    return ITPUtils.cleanField(valueMatch ? valueMatch[0].replace(",", ".") : source);
  }

  function readFieldFromAriaPrefix(element, prefix) {
    if (!element) return "";
    const aria = element.getAttribute("aria-label") || "";
    if (!aria.toLowerCase().startsWith(prefix.toLowerCase())) {
      return ITPUtils.cleanField(aria || ITPUtils.getTextFromElement(element));
    }
    return ITPUtils.cleanField(aria.slice(prefix.length));
  }

  function extractAddress() {
    const button = ITPUtils.getFirstElement(SELECTORS.addressButton);
    if (!button) return "";

    const child = button.querySelector(".fontBodyMedium") || button.querySelector("div") || button;
    const value = ITPUtils.getTextFromElement(child);

    if (value) return ITPUtils.cleanField(value);
    return readFieldFromAriaPrefix(button, "Address:");
  }

  function extractPhone() {
    const button = ITPUtils.getFirstElement(SELECTORS.phoneButton);
    if (!button) return "";

    const value = ITPUtils.getTextFromElement(button);
    if (value) return ITPUtils.cleanField(value);

    return readFieldFromAriaPrefix(button, "Phone:");
  }

  function extractWebsite() {
    const websiteElement = ITPUtils.getFirstElement(SELECTORS.websiteLink);
    if (!websiteElement) return "";

    const href = websiteElement.getAttribute("href") || "";
    if (href.startsWith("http")) {
      return ITPUtils.cleanField(href);
    }

    return ITPUtils.cleanField(readFieldFromAriaPrefix(websiteElement, "Website:"));
  }

  function extractEmailFromDetailsPanel() {
    const mailto = document.querySelector('a[href^="mailto:"]');
    if (mailto) {
      return ITPUtils.cleanField((mailto.getAttribute("href") || "").replace(/^mailto:/i, ""));
    }

    const mainPanel = document.querySelector('div[role="main"]');
    const panelText = mainPanel ? mainPanel.innerText : "";
    const emails = ITPUtils.extractEmails(panelText);
    return emails[0] || "";
  }

  async function extractEmailFromWebsite(websiteUrl) {
    if (!websiteUrl || !/^https?:\/\//i.test(websiteUrl)) return "";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(websiteUrl, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        credentials: "omit",
      });

      if (!response.ok) return "";
      const html = await response.text();
      const emails = ITPUtils.extractEmails(html);
      return emails[0] || "";
    } catch {
      return "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function extractLatestVisibleReview() {
    const reviewsButton = ITPUtils.getFirstElement(SELECTORS.reviewsButton);
    if (!reviewsButton) return "";

    try {
      reviewsButton.click();
      await ITPUtils.sleep(1000, 1400);

      const dialog = await ITPUtils.waitForElement(SELECTORS.reviewsDialog, { timeout: 4500 });
      if (!dialog) return "";

      dialog.scrollBy({ top: 300, behavior: "smooth" });
      await ITPUtils.sleep(500, 900);

      const reviewText = ITPUtils.getFirstText(SELECTORS.reviewText);

      const closeButton = dialog.querySelector('button[aria-label="Close"]');
      if (closeButton) {
        closeButton.click();
      } else {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }

      await ITPUtils.sleep(300, 600);

      return ITPUtils.cleanField(reviewText);
    } catch {
      return "";
    }
  }

  async function extractBusinessDetails() {
    const ready = await waitForDetailsReady();
    if (!ready) {
      return null;
    }

    const name = ITPUtils.getFirstText(SELECTORS.detailName);
    const rating = getRatingValue();
    const address = extractAddress();
    const phone = extractPhone();
    const website = extractWebsite();

    let email = extractEmailFromDetailsPanel();
    if (!email && website) {
      email = await extractEmailFromWebsite(website);
    }

    const lastReview = await extractLatestVisibleReview();

    return {
      name: ITPUtils.cleanField(name),
      rating: ITPUtils.cleanField(rating),
      address: ITPUtils.cleanField(address),
      email: ITPUtils.cleanField(email),
      phone: ITPUtils.cleanField(phone),
      website: ITPUtils.cleanField(website),
      lastReview: ITPUtils.cleanField(lastReview),
    };
  }

  async function scrapeListings() {
    const feed = getListingFeed() || (await ITPUtils.waitForElement(SELECTORS.listingFeed, { timeout: 15000 }));
    if (!feed) {
      throw new Error("Google Maps listing panel was not detected.");
    }

    const processed = new Set();
    const results = [];

    let noNewItemsCycles = 0;

    while (!state.shouldStop && results.length < state.targetLimit && noNewItemsCycles < 18) {
      const listingAnchors = getListingAnchors(feed);
      let cycleNewCount = 0;

      for (const anchor of listingAnchors) {
        if (state.shouldStop || results.length >= state.targetLimit) {
          break;
        }

        const key = ITPUtils.parsePlaceKeyFromUrl(anchor.href || anchor.getAttribute("href"));
        if (!key || processed.has(key)) {
          continue;
        }

        processed.add(key);
        const opened = await openListing(anchor);
        if (!opened) {
          continue;
        }

        try {
          const row = await extractBusinessDetails();
          if (!row) continue;

          if (!row.name && !row.address) {
            continue;
          }

          results.push(row);
          cycleNewCount += 1;

          state.rows = results;
          state.progress = results.length;

          addLog(`Scraped ${row.name || "Unknown Business"} (${results.length}/${state.targetLimit})`);
          emitProgress();

          await ITPUtils.sleep(650, 1400);
        } catch (error) {
          addLog(`Skipped one listing due to parsing issue: ${error.message}`);
        }
      }

      if (state.shouldStop || results.length >= state.targetLimit) {
        break;
      }

      const beforeScrollCount = getListingAnchors(feed).length;
      feed.scrollBy({ top: Math.max(feed.clientHeight * 0.82, 600), behavior: "smooth" });
      await ITPUtils.sleep(950, 1500);

      const afterScrollCount = getListingAnchors(feed).length;
      if (cycleNewCount === 0 && afterScrollCount <= beforeScrollCount) {
        noNewItemsCycles += 1;
      } else {
        noNewItemsCycles = 0;
      }
    }

    return ITPUtils.uniqueBy(results, (item) =>
      `${(item.name || "").toLowerCase()}__${(item.address || "").toLowerCase()}`
    );
  }

  function exportRows(rows, format) {
    const normalizedFormat = ["csv", "json", "both"].includes(format) ? format : "csv";

    if (normalizedFormat === "csv" || normalizedFormat === "both") {
      const csv = ITPUtils.toCsv(rows);
      ITPUtils.downloadBlob(csv, "itp_scrapper_data.csv", "text/csv;charset=utf-8");
    }

    if (normalizedFormat === "json" || normalizedFormat === "both") {
      const json = JSON.stringify(rows, null, 2);
      ITPUtils.downloadBlob(json, "itp_scrapper_data.json", "application/json");
    }
  }

  async function runScraper(config = {}) {
    if (state.isRunning) {
      return {
        ok: false,
        message: "Scraper is already running.",
      };
    }

    state.isRunning = true;
    state.shouldStop = false;
    state.rows = [];
    state.progress = 0;
    state.targetLimit = Number(config.limit) > 0 ? Number(config.limit) : 100;
    state.exportFormat = config.exportFormat || "csv";
    state.logs = [];

    setStatus("Running", "Scanning listings and extracting details...");
    addLog(`Scrape started with limit ${state.targetLimit}`);

    try {
      const rows = await scrapeListings();
      state.rows = rows;
      state.progress = rows.length;

      if (state.shouldStop) {
        setStatus("Idle", "Scraping stopped by user.");
        addLog("Scraping stopped before completion.");
        return {
          ok: true,
          stopped: true,
          rows,
        };
      }

      exportRows(rows, state.exportFormat);

      setStatus("Completed", `Completed. ${rows.length} businesses scraped.`);
      emitProgress();
      addLog("Data export complete.");

      sendRuntime("SCRAPE_DONE", {
        rows,
        count: rows.length,
        exportFormat: state.exportFormat,
      });

      return {
        ok: true,
        rows,
      };
    } catch (error) {
      setStatus("Error", error.message || "Scraping failed.");
      addLog(`Error: ${error.message || "Unknown"}`);
      return {
        ok: false,
        error: error.message || "Unknown error",
      };
    } finally {
      state.isRunning = false;
      state.shouldStop = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "PING") {
      sendResponse({ ok: true, source: "itp-scrapper-content" });
      return;
    }

    if (message.type === "GET_STATUS") {
      sendResponse({
        ok: true,
        state: {
          isRunning: state.isRunning,
          status: state.status,
          statusText: state.statusText,
          progress: state.progress,
          targetLimit: state.targetLimit,
          rowsCount: state.rows.length,
          logs: state.logs.slice(-50),
        },
      });
      return;
    }

    if (message.type === "STOP_SCRAPING") {
      state.shouldStop = true;
      setStatus("Idle", "Stop requested. Finishing current step...");
      addLog("Stop requested by popup.");
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "START_SCRAPING") {
      runScraper(message.config || {}).then((result) => {
        sendResponse(result);
      });
      return true;
    }

    if (message.type === "EXPORT_LAST") {
      if (!state.rows.length) {
        sendResponse({ ok: false, message: "No data to export." });
        return;
      }
      exportRows(state.rows, message.format || state.exportFormat || "csv");
      sendResponse({ ok: true, count: state.rows.length });
      return;
    }
  });
})();
