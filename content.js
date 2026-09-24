(() => {
if (window.__CODESYNC_INJECTED__) return;
window.__CODESYNC_INJECTED__ = true;

let isUploading = false;
let isWaitingForResult = false;
let lastSubmissionKey = "";

/** Returns the platform that owns the current problem page. */
function getPlatform() {
  return location.hostname.includes("geeksforgeeks") ? "gfg" : "leetcode";
}

/** Converts a coding-platform language label into its standard file extension. */
function getLanguageExtension(language) {
  const value = String(language || "")
    .toLowerCase()
    .replace(/\s+/g, " ");
  const languages = [
    ["python", "py"],
    ["python3", "py"],
    ["pandas", "py"],
    ["c++", "cpp"],
    ["cpp", "cpp"],
    ["typescript", "ts"],
    ["javascript", "js"],
    ["java", "java"],
    ["c#", "cs"],
    ["csharp", "cs"],
    ["kotlin", "kt"],
    ["golang", "go"],
    ["go", "go"],
    ["rust", "rs"],
    ["swift", "swift"],
    ["ruby", "rb"],
    ["php", "php"],
    ["scala", "scala"],
    ["dart", "dart"],
    ["sql", "sql"],
    ["mysql", "sql"],
    ["postgresql", "sql"],
    ["mssql", "sql"],
    ["oracle", "sql"],
    ["c", "c"],
  ];

  const exactMatch = languages.find(([name]) => value === name);
  if (exactMatch) return exactMatch[1];

  const partialMatch = languages.find(([name]) => value.includes(name));
  return partialMatch ? partialMatch[1] : "txt";
}

async function fetchLatestSubmissionCode(slug) {
  try {
    const csrfToken = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
    const listQuery = `
      query submissionList($offset: Int!, $limit: Int!, $questionSlug: String!) {
        questionSubmissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
          submissions { id statusDisplay lang }
        }
      }
    `;
    const listRes = await fetch("/graphql/", {
      method: "POST",
      credentials: "same-origin",
      headers: { 
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken
      },
      body: JSON.stringify({
        operationName: "submissionList",
        query: listQuery,
        variables: { offset: 0, limit: 1, questionSlug: slug }
      })
    });
    
    const listText = await listRes.text();
    let listData;
    try {
      listData = JSON.parse(listText);
    } catch (err) {
      console.warn("LeetCode GraphQL List Error:", listRes.status, listText.slice(0, 200));
      return null;
    }

    const sub = listData?.data?.questionSubmissionList?.submissions?.[0];
    if (sub) {
      const detailQuery = `
        query submissionDetails($submissionId: Int!) {
          submissionDetails(submissionId: $submissionId) {
            code
            lang { name }
          }
        }
      `;
      const detailRes = await fetch("/graphql/", {
        method: "POST",
        credentials: "same-origin",
        headers: { 
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken
        },
        body: JSON.stringify({
          operationName: "submissionDetails",
          query: detailQuery,
          variables: { submissionId: parseInt(sub.id, 10) }
        })
      });
      
      const detailText = await detailRes.text();
      let detailData;
      try {
        detailData = JSON.parse(detailText);
      } catch (err) {
        console.warn("LeetCode GraphQL Detail Error:", detailRes.status, detailText.slice(0, 200));
        return null;
      }

      if (detailData?.data?.submissionDetails?.code) {
        return {
          code: detailData.data.submissionDetails.code,
          lang: detailData.data.submissionDetails.lang.name
        };
      }
    }
  } catch (e) {
    // Suppress console.error so it doesn't trigger an 'Errors' badge in chrome://extensions/
    console.debug("Failed to fetch latest submission (fallback to DOM extraction):", e);
  }
  return null;
}

/** Reads source text from Monaco, Ace, CodeMirror, or a plain textarea editor. */
function getCodeFromEditor() {
  const editorSelectors = [
    ".monaco-editor .view-line",
    ".ace_editor .ace_line",
    ".cm-editor .cm-line",
    ".CodeMirror-code pre",
  ];

  for (const selector of editorSelectors) {
    const lines = [...document.querySelectorAll(selector)];
    if (lines.length) {
      return lines
        .sort(
          (a, b) =>
            a.getBoundingClientRect().top - b.getBoundingClientRect().top,
        )
        .map((line) => line.textContent || "")
        .join("\n");
    }
  }

  return document.querySelector("textarea")?.value || "";
}

/** Finds the selected language while avoiding unrelated page buttons. */
function getSelectedLanguage() {
  const selectors = [
    '[data-e2e-locator="lang-select"]',
    '[data-cy="lang-select"]',
    'button[id^="headlessui-listbox-button"]',
    '[class*="language"] [class*="single-value"]',
    ".language-select",
    "#language",
  ];

  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const text = element.textContent?.trim() || "";
      if (getLanguageExtension(text) !== "txt") return text;
    }
  }

  const mode = document
    .querySelector(".monaco-editor [data-mode-id]")
    ?.getAttribute("data-mode-id");
  return mode || "text";
}

/** Guesses a file extension from source syntax when a platform hides its language control. */
function inferExtensionFromCode(code) {
  if (/^\s*#include\s*[<"]|\busing\s+namespace\s+std\b/m.test(code))
    return "cpp";
  if (/^\s*package\s+main\b|\bfunc\s+\w+\s*\(/m.test(code)) return "go";
  if (/^\s*def\s+\w+\s*\(|\bfrom\s+\w+\s+import\b|\bimport\s+\w+/m.test(code))
    return "py";
  if (/\bpublic\s+class\s+\w+|\bclass\s+Solution\s*\{/m.test(code))
    return "java";
  if (/\bconsole\.log\s*\(|\bfunction\s+\w+\s*\(/m.test(code)) return "js";
  if (/\bfn\s+\w+\s*\(|\bimpl\s+\w+/m.test(code)) return "rs";
  return "txt";
}

/** Keeps problem-description HTML while removing executable and unsafe elements. */
function getProblemDescriptionHtml() {
  const selectors = [
    '[data-track-load="description_content"]',
    '[data-cy="question-content"]',
    '[class*="problem-statement"]',
    '[class*="problem_content"]',
    ".problemContent",
  ];
  const source = selectors
    .map((selector) => document.querySelector(selector))
    .find(Boolean);
  if (!source) return "";

  const documentCopy = new DOMParser().parseFromString(
    source.innerHTML,
    "text/html",
  );
  documentCopy
    .querySelectorAll("script, style, iframe, object, embed, form")
    .forEach((element) => element.remove());
  documentCopy.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.startsWith("on") ||
        /^javascript:/i.test(attribute.value)
      )
        element.removeAttribute(attribute.name);
    }
  });
  return documentCopy.body.innerHTML.slice(0, 500000);
}

/** Converts a GFG URL slug into a readable title when its page heading is unreliable. */
function getGfgTitleFromUrl() {
  const slug = location.pathname.match(/\/problems\/([^/]+)/)?.[1] || "";
  return slug
    .replace(/-\d+$/, "")
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Extracts code directly from window.monaco or window.ace using an injected script. */
function extractCodeFromMainWorld() {
  return new Promise((resolve) => {
    let timeout;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    const cleanup = () => {
      clearTimeout(timeout);
      document.removeEventListener("CodeSync_Data", listener);
      if (script.parentNode) script.remove();
    };
    const listener = (event) => {
      cleanup();
      resolve(event.detail);
    };
    timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 1000);
    document.addEventListener("CodeSync_Data", listener);
    script.onerror = () => {
      cleanup();
      resolve(null);
    };
    (document.head || document.documentElement).appendChild(script);
  });
}

/** Extracts safe problem metadata for the background upload worker. */
async function getProblemInfo() {
  const isGfg = getPlatform() === "gfg";
  const gfgTitleElement = document.querySelector(
    '[class*="problemName"], [class*="problem_name"], [class*="problems_header"] h1, h1[class*="problem"]',
  );
  const titleElement = isGfg
    ? gfgTitleElement
    : document.querySelector('[data-cy="question-title"], .problemName, h1');
  const pageTitle = document.title
    .replace(/\s*[-|].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const gfgMetaTitle = document
    .querySelector('meta[property="og:title"]')
    ?.getAttribute("content");
  const rawTitle = (
    titleElement?.textContent ||
    (isGfg ? gfgMetaTitle || getGfgTitleFromUrl() : pageTitle)
  )
    .replace(/\s+/g, " ")
    .trim();
  const match = rawTitle.match(/^(\d+)\.\s*(.+)/);
  let title = (match?.[2] || rawTitle)
    .replace(/\s*[|–-]\s*(practice\s*)?\|?\s*geeksforgeeks.*$/i, "")
    .trim()
    .slice(0, 150);
  if (isGfg && !gfgTitleElement) title = getGfgTitleFromUrl() || title;
  let problemNumber = match?.[1] || "";
  let descriptionHtml = getProblemDescriptionHtml();

  let language = getSelectedLanguage();
  let code = getCodeFromEditor();

  const mainWorldData = await extractCodeFromMainWorld();
  if (mainWorldData && mainWorldData.code) {
    code = mainWorldData.code;
    if (mainWorldData.lang) {
      language = mainWorldData.lang;
    }
  }

  if (getPlatform() === "leetcode") {
    const slug = location.pathname.match(/\/problems\/([^/]+)/)?.[1];
    
    // Attempt to get metadata from background
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_LEETCODE_QUESTION",
        slug,
      });
      if (response?.ok && response.data) {
        title = response.data.title;
        problemNumber = response.data.problemNumber;
        descriptionHtml = response.data.descriptionHtml || descriptionHtml;
      }
    } catch (e) {
      if (e.message.includes("Extension context invalidated") || e.message.includes("message channel closed")) {
        throw e; // Throw it up to stop the watcher interval entirely
      }
      console.warn("Failed to fetch LeetCode metadata", e);
    }

    // Fetch the absolute exact latest code from LeetCode API to bypass all CSP and virtualization issues
    if (slug) {
      const apiData = await fetchLatestSubmissionCode(slug);
      if (apiData && apiData.code) {
        code = apiData.code;
        if (apiData.lang) {
          language = apiData.lang;
        }
      }
    }
  }

  const selectedExtension = getLanguageExtension(language);

  return {
    platform: getPlatform(),
    title,
    problemNumber,
    displayTitle: problemNumber ? `${problemNumber}. ${title}` : title,
    language,
    extension:
      selectedExtension === "txt"
        ? inferExtensionFromCode(code)
        : selectedExtension,
    code,
    descriptionHtml,
    url: location.href.split("?")[0],
    runtime:
      (document.body.innerText.match(/Runtime\s*:?\s*([^\n]+)/i) || [])[1] ||
      "N/A",
    memory:
      (document.body.innerText.match(/Memory\s*:?\s*([^\n]+)/i) || [])[1] ||
      "N/A",
  };
}

/** Sends an accepted submission to the background worker without page notifications. */
async function uploadAcceptedSolution(isManual = false) {
  if (isUploading)
    return { ok: false, error: "A sync is already in progress." };

  const payload = await getProblemInfo();
  if (!payload.code.trim()) {
    return { ok: false, error: "No code was found in the editor." };
  }
  payload.isManual = isManual;

  isUploading = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "UPLOAD_SUBMISSION",
      payload,
    });
    if (!response?.ok) {
      return {
        ok: false,
        error: response?.error || "GitHub rejected the upload.",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "The extension could not reach GitHub.",
    };
  } finally {
    isUploading = false;
  }
}

/** Shows the optional manual upload action only after an accepted result appears. */
function showManualPushButton() {
  if (document.getElementById("codesync-manual-push")) return;

  const button = document.createElement("button");
  button.id = "codesync-manual-push";
  button.type = "button";
  button.textContent = "Push to GitHub";
  button.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483646;border:0;border-radius:8px;padding:10px 14px;background:#1d8f75;color:#fff;font:600 13px system-ui;cursor:pointer;box-shadow:0 4px 12px #0006";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Pushing...";
    const result = await uploadAcceptedSolution(true);
    const shortError = result.error?.slice(0, 55) || "Unknown error";
    button.textContent = result.ok ? "Pushed ✓" : `Failed: ${shortError}`;
    button.title = result.ok ? "" : result.error;
    setTimeout(
      () => {
        button.textContent = "Push to GitHub";
        button.title = "";
        button.disabled = false;
      },
      result.ok ? 2500 : 5000,
    );
  });
  document.body.append(button);
}

/** Reads only submission-result panels so ordinary problem text cannot trigger syncing. */
function getSubmissionResultText() {
  const resultSelectors = [
    '[data-e2e-locator="submission-result"]',
    '[data-e2e-locator="submission-result-content"]',
    "#submission-result",
    '[class*="submission-result"]',
    '[class*="submission_result"]',
    '[class*="result-panel"]',
  ];
  const panels = resultSelectors.flatMap((selector) => [
    ...document.querySelectorAll(selector),
  ]);
  const panelText = panels.map((panel) => panel.innerText || "").join("\n");
  if (panelText) return panelText;

  // Fallback for GeeksForGeeks and unknown UI changes: find exact text node labels
  const walker = document.createTreeWalker(
    document.body, 
    NodeFilter.SHOW_TEXT, 
    {
      acceptNode: function(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const el = node.parentElement;
        // Only accept visible elements
        if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }, 
    false
  );
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue.trim();
    if (text.length > 0 && text.length < 50) {
      if (/^(?:Solution\s+)?Accepted$|^Correct$|^Success$|^Problem\s+Solved\s+Successfully$|^Congratulations/i.test(text)) {
        return text;
      }
      if (/^(?:Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Compile Error|Runtime Error|Output Limit Exceeded)$/i.test(text)) {
        return text;
      }
      if (/^(?:Pending|Judging)$/i.test(text)) {
        return text;
      }
    }
  }

  return "";
}

let isCheckingResult = false;
let resultTextAtSubmit = "";

/** Detects an accepted result on the page. */
async function watchSubmissionResult() {
  if (isUploading || isCheckingResult || !isWaitingForResult) return;
  isCheckingResult = true;

  try {
    const resultText = getSubmissionResultText();

    // If the text hasn't changed since submit, we are still looking at the OLD result.
    if (resultTextAtSubmit !== "" && resultText === resultTextAtSubmit) {
      return;
    }

    // If it HAS changed, the old result is gone! Clear the lock.
    if (resultText !== resultTextAtSubmit) {
      resultTextAtSubmit = ""; 
    }

    if (!resultText) return; 

    // Wait until it's not in a judging/pending state
    if (/\b(?:Pending|Judging)\b/i.test(resultText)) return;

    const isAccepted =
      /\b(?:Solution\s+)?Accepted\b|\bCorrect\b|\bSuccess\b|Problem\s+Solved\s+Successfully|Congratulations!\s*You\s+have\s+solved/i.test(
        resultText,
      );

    const isFailed = 
      /\b(?:Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Compile Error|Runtime Error|Output Limit Exceeded)\b/i.test(
        resultText,
      );

    if (isAccepted || isFailed) {
      isWaitingForResult = false;
    }

    if (!isAccepted) return;

    const info = await getProblemInfo();
    const codeSnippet = info.code.length > 40 ? info.code.substring(0, 20) + info.code.substring(info.code.length - 20) : info.code;
    const submissionKey = `${info.platform}:${info.url}:${info.code.length}:${codeSnippet}`;
    if (submissionKey === lastSubmissionKey) return;

    lastSubmissionKey = submissionKey;
    showManualPushButton();

    const response = await chrome.runtime.sendMessage({ type: "GET_CONFIG" });
    if (response?.ok && response.data.autoSync) {
      await uploadAcceptedSolution(false);
    }
  } finally {
    isCheckingResult = false;
  }
}

// Continuously poll for results. This is extremely lightweight 
// because getSubmissionResultText only queries a few specific selectors.
function getProblemSlug() {
  return location.pathname.match(/\/problems\/([^/]+)/)?.[1] || "";
}

let lastWatchedSlug = getProblemSlug();
const watcherIntervalId = setInterval(() => {
  const currentSlug = getProblemSlug();
  if (lastWatchedSlug !== currentSlug) {
    lastWatchedSlug = currentSlug;
    document.getElementById("codesync-manual-push")?.remove();
    isWaitingForResult = false;
    lastSubmissionKey = "";
    resultTextAtSubmit = "";
  }

  watchSubmissionResult().catch((e) => {
    if (e?.message?.includes("Extension context invalidated") || e?.message?.includes("message channel closed")) {
      clearInterval(watcherIntervalId);
    }
  });
}, 1000);

/** Reset the submission key so the user can re-push code if they submit again. */
function resetSubmissionKey() {
  isWaitingForResult = true;
  resultTextAtSubmit = getSubmissionResultText();
  lastSubmissionKey = "";
  document.getElementById("codesync-manual-push")?.remove();
}

// Support for mouse clicks on submit buttons
document.addEventListener("click", (event) => {
  let current = event.target;
  while (current && current !== document.body) {
    const label = `${current.innerText || ""} ${current.getAttribute("data-e2e-locator") || ""} ${current.getAttribute("aria-label") || ""} ${current.className || ""}`.toLowerCase();
    
    if (label.includes("submit")) {
      const isButton = current.tagName === 'BUTTON' || current.tagName === 'INPUT' || current.getAttribute('role') === 'button' || label.includes("console-submit-button");
      if (isButton) {
        resetSubmissionKey();
        return;
      }
    }
    current = current.parentElement;
  }
}, true);

// Support for keyboard shortcuts (Ctrl+Enter / Cmd+Enter)
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    resetSubmissionKey();
  }
}, true);

})();
