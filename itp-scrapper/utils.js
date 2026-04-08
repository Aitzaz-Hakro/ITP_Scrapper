(() => {
  if (window.ITPUtils) {
    return;
  }

  const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

  function sleep(minMs, maxMs) {
    const duration =
      typeof maxMs === "number"
        ? Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
        : minMs;

    return new Promise((resolve) => setTimeout(resolve, Math.max(0, duration)));
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function cleanText(value) {
    return normalizeText(value);
  }

  function cleanPhone(value) {
    let phone = cleanText(value)
      .replace(/^phone:\s*/i, "")
      .replace(/\s+/g, "")
      .replace(/[()\-.]/g, "")
      .replace(/[^\d+]/g, "");

    if (phone.startsWith("00")) {
      phone = `+${phone.slice(2)}`;
    }

    if (phone.includes("+")) {
      phone = `+${phone.replace(/\+/g, "")}`;
    }

    return phone;
  }

  function cleanAddress(value) {
    return cleanText(value)
      .replace(/^address:\s*/i, "")
      .replace(/\s*\u00b7\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function safeQuerySelector(selectors, root = document) {
    if (!selectors) return null;

    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      try {
        const element = root.querySelector(selector);
        if (element) return element;
      } catch {
        // Ignore invalid dynamic selector and continue.
      }
    }

    return null;
  }

  function safeQuerySelectorAll(selectors, root = document) {
    if (!selectors) return [];

    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      try {
        const elements = [...root.querySelectorAll(selector)];
        if (elements.length) return elements;
      } catch {
        // Ignore invalid dynamic selector and continue.
      }
    }

    return [];
  }

  function getTextFromElement(element) {
    if (!element) return "";

    const aria = element.getAttribute("aria-label");
    if (aria && aria.trim()) {
      return normalizeText(aria);
    }

    return normalizeText(element.innerText || element.textContent || "");
  }

  function getFirstText(selectors, root = document) {
    const element = safeQuerySelector(selectors, root);
    return cleanText(getTextFromElement(element));
  }

  async function waitForElement(selectors, options = {}) {
    const { root = document, timeout = 10000 } = options;
    const existing = safeQuerySelector(selectors, root);
    if (existing) return existing;

    return new Promise((resolve) => {
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        if (timerId) clearTimeout(timerId);
        resolve(value || null);
      };

      const observer = new MutationObserver(() => {
        const found = safeQuerySelector(selectors, root);
        if (found) finish(found);
      });

      observer.observe(root, {
        childList: true,
        subtree: true,
      });

      const timerId = setTimeout(() => finish(null), timeout);
    });
  }

  function extractEmails(text) {
    const source = String(text || "");
    const matches = source.match(EMAIL_REGEX) || [];

    const cleaned = matches
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email && !email.endsWith(".png") && !email.endsWith(".jpg") && !email.endsWith(".jpeg"));

    return [...new Set(cleaned)];
  }

  function extractEmailFromHTML(html) {
    const matches = extractEmails(html);
    return matches[0] || "";
  }

  function uniqueBy(items, keyFn) {
    const map = new Map();
    for (const item of items || []) {
      const key = keyFn(item);
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
    return [...map.values()];
  }

  function escapeCsvCell(value) {
    const text = cleanText(value);
    const escaped = text.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  function toCsv(rows, headers) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const headerEntries = headers || [
      ["name", "Name"],
      ["rating", "Rating"],
      ["address", "Address"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["website", "Website"],
      ["lastReview", "Last Review"],
    ];

    const headerLine = headerEntries.map((entry) => escapeCsvCell(entry[1])).join(",");
    const bodyLines = safeRows.map((row) => headerEntries.map(([key]) => escapeCsvCell(row[key] || "")).join(","));

    return [headerLine, ...bodyLines].join("\n");
  }

  function triggerDownloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function downloadCsv(csv, filename = "itp_scrapper_data.csv") {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    triggerDownloadBlob(blob, filename);
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    triggerDownloadBlob(blob, filename);
  }

  function parsePlaceKeyFromUrl(url) {
    try {
      const decoded = decodeURIComponent(String(url || ""));
      const match = decoded.match(/\/maps\/place\/([^/?]+)/i);
      if (match && match[1]) return match[1].toLowerCase();
      return decoded.toLowerCase();
    } catch {
      return String(url || "").toLowerCase();
    }
  }

  function withTimeout(taskPromise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout")), ms);
      taskPromise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  window.ITPUtils = {
    sleep,
    normalizeText,
    cleanText,
    cleanField: cleanText,
    cleanPhone,
    cleanAddress,
    safeQuerySelector,
    safeQuerySelectorAll,
    getFirstElement: safeQuerySelector,
    getFirstText,
    getTextFromElement,
    waitForElement,
    extractEmails,
    extractEmailFromHTML,
    uniqueBy,
    toCsv,
    downloadCsv,
    downloadBlob,
    parsePlaceKeyFromUrl,
    withTimeout,
  };
})();
