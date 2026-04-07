(() => {
  const dom = {
    statusBadge: document.getElementById("statusBadge"),
    statusText: document.getElementById("statusText"),
    progressText: document.getElementById("progressText"),
    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    limitInput: document.getElementById("limitInput"),
    exportFormat: document.getElementById("exportFormat"),
    logPanel: document.getElementById("logPanel"),
    clearLogsBtn: document.getElementById("clearLogsBtn"),
    themeToggle: document.getElementById("themeToggle"),
  };

  const uiState = {
    activeTabId: null,
    logs: [],
  };

  function addLog(text) {
    if (!text) return;
    uiState.logs.push(text);
    if (uiState.logs.length > 120) {
      uiState.logs = uiState.logs.slice(-120);
    }
    renderLogs();
  }

  function renderLogs() {
    dom.logPanel.innerHTML = "";

    if (!uiState.logs.length) {
      const line = document.createElement("p");
      line.className = "log-line";
      line.textContent = "No logs yet.";
      dom.logPanel.appendChild(line);
      return;
    }

    for (const lineText of uiState.logs.slice(-80)) {
      const line = document.createElement("p");
      line.className = "log-line";
      line.textContent = lineText;
      dom.logPanel.appendChild(line);
    }

    dom.logPanel.scrollTop = dom.logPanel.scrollHeight;
  }

  function setStatus(status, text) {
    const normalized = (status || "Idle").toLowerCase();

    dom.statusBadge.textContent = status || "Idle";
    dom.statusBadge.className = `badge ${normalized}`;
    dom.statusText.textContent = text || "Ready.";

    const isRunning = normalized === "running";
    dom.startBtn.disabled = isRunning;
    dom.stopBtn.disabled = !isRunning;
  }

  function setProgress(scrapedCount, totalCount) {
    const safeScraped = Number(scrapedCount) || 0;
    const safeTotal = Number(totalCount) || Number(dom.limitInput.value) || 0;
    dom.progressText.textContent = `Scraped ${safeScraped} businesses${safeTotal ? ` / ${safeTotal}` : ""}`;
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function isMapsPage(url) {
    return typeof url === "string" && url.startsWith("https://www.google.com/maps/");
  }

  async function sendMessageToTab(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message);
  }

  async function ensureContentScript(tabId) {
    try {
      await sendMessageToTab(tabId, { type: "PING" });
      return;
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["utils.js", "content.js"],
      });
      await ITPUtils.sleep(250);
    }
  }

  async function refreshStatus() {
    const tab = await getActiveTab();
    if (!tab) {
      setStatus("Error", "No active tab found.");
      return;
    }

    uiState.activeTabId = tab.id;

    if (!isMapsPage(tab.url)) {
      setStatus("Idle", "Open a Google Maps search page to start scraping.");
      setProgress(0, Number(dom.limitInput.value));
      return;
    }

    try {
      await ensureContentScript(tab.id);
      const response = await sendMessageToTab(tab.id, { type: "GET_STATUS" });
      const contentState = response?.state;

      if (contentState) {
        setStatus(contentState.status || "Idle", contentState.statusText || "Ready.");
        setProgress(contentState.progress, contentState.targetLimit);
        uiState.logs = Array.isArray(contentState.logs) ? contentState.logs.slice(-80) : [];
        renderLogs();
      } else {
        setStatus("Idle", "Ready to scrape.");
      }
    } catch (error) {
      setStatus("Error", error.message || "Could not communicate with page script.");
    }
  }

  async function startScraping() {
    const tab = await getActiveTab();

    if (!tab || !isMapsPage(tab.url)) {
      setStatus("Error", "Please open a Google Maps result page first.");
      return;
    }

    uiState.activeTabId = tab.id;

    const limit = Math.min(500, Math.max(1, Number(dom.limitInput.value) || 100));
    dom.limitInput.value = String(limit);

    const exportFormat = dom.exportFormat.value;

    setStatus("Running", "Starting scraper...");
    setProgress(0, limit);
    addLog(`${new Date().toLocaleTimeString()} - Request sent to content script.`);

    try {
      await ensureContentScript(tab.id);

      await sendMessageToTab(tab.id, {
        type: "START_SCRAPING",
        config: { limit, exportFormat },
      });
    } catch (error) {
      setStatus("Error", error.message || "Could not start scraping.");
      addLog(`${new Date().toLocaleTimeString()} - Start failed: ${error.message}`);
    }
  }

  async function stopScraping() {
    const tab = await getActiveTab();
    if (!tab) return;

    try {
      await sendMessageToTab(tab.id, { type: "STOP_SCRAPING" });
      setStatus("Idle", "Stop requested...");
      addLog(`${new Date().toLocaleTimeString()} - Stop requested.`);
    } catch (error) {
      setStatus("Error", error.message || "Could not stop scraping.");
    }
  }

  async function applyThemeOnLoad() {
    try {
      const storage = await chrome.storage.local.get("itpTheme");
      const storedTheme = storage.itpTheme;

      if (storedTheme === "light" || storedTheme === "dark") {
        document.body.className = storedTheme === "light" ? "theme-light" : "theme-dark";
        return;
      }

      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.body.className = prefersDark ? "theme-dark" : "theme-light";
    } catch {
      document.body.className = "theme-dark";
    }
  }

  async function toggleTheme() {
    const isDark = document.body.classList.contains("theme-dark");
    document.body.className = isDark ? "theme-light" : "theme-dark";

    const saveTheme = isDark ? "light" : "dark";
    await chrome.storage.local.set({ itpTheme: saveTheme });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.source !== "itp-scrapper") return;

    const senderTabId = sender?.tab?.id;
    if (uiState.activeTabId && senderTabId && senderTabId !== uiState.activeTabId) {
      return;
    }

    if (message.type === "SCRAPE_STATUS") {
      setStatus(message.status || "Idle", message.statusText || "");
      setProgress(message.scraped || message.progress || 0, message.targetLimit || Number(dom.limitInput.value));
      return;
    }

    if (message.type === "SCRAPE_PROGRESS") {
      setProgress(message.scraped || message.progress || 0, message.targetLimit || Number(dom.limitInput.value));
      return;
    }

    if (message.type === "SCRAPE_LOG") {
      addLog(message.log);
      return;
    }

    if (message.type === "SCRAPE_DONE") {
      setStatus("Completed", `Finished. Exported ${message.count || 0} businesses.`);
      setProgress(message.count || 0, Number(dom.limitInput.value));
      addLog(`${new Date().toLocaleTimeString()} - Export completed.`);
    }
  });

  dom.startBtn.addEventListener("click", startScraping);
  dom.stopBtn.addEventListener("click", stopScraping);
  dom.clearLogsBtn.addEventListener("click", () => {
    uiState.logs = [];
    renderLogs();
  });
  dom.themeToggle.addEventListener("click", toggleTheme);

  (async () => {
    await applyThemeOnLoad();
    renderLogs();
    await refreshStatus();
  })();
})();
