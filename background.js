importScripts("github-oauth-config.js");

const CONFIG_KEYS = ["githubRepo", "autoSync", "githubUsername"];

/** Returns safe extension settings without exposing the OAuth token. */
async function getConfig() {
  const storedConfig = await chrome.storage.local.get(CONFIG_KEYS);
  return {
    githubRepo: storedConfig.githubRepo || "",
    autoSync: storedConfig.autoSync ?? true,
    githubUsername: storedConfig.githubUsername || "",
  };
}

/** Retrieves the GitHub token. The token should be configured to never expire. */
async function getValidGitHubToken() {
  const { githubToken } = await chrome.storage.local.get(["githubToken"]);
  if (!githubToken) throw new Error("Please sign in with GitHub first.");
  return githubToken;
}

/** Makes an authenticated GitHub API request with consistent errors. */
async function githubRequest(path, options = {}) {
  const githubToken = await getValidGitHubToken();
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      await chrome.storage.local.remove(["githubToken", "githubUsername"]);
      throw new Error("Your GitHub session is invalid. Please sign in again.");
    }
    throw new Error(
      body.message || `GitHub request failed (${response.status}).`,
    );
  }
  return response.status === 204 ? null : response.json();
}

/** Fetches official LeetCode metadata, including its frontend number and HTML statement. */
async function getLeetCodeQuestion(slug) {
  if (!/^[a-z0-9-]+$/.test(slug || "")) return null;

  const response = await fetch("https://leetcode.com/graphql/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operationName: "questionData",
      variables: { titleSlug: slug },
      query:
        "query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { questionFrontendId title content } }",
    }),
  });
  if (!response.ok) return null;

  const question = (await response.json()).data?.question;
  if (!question?.questionFrontendId || !question?.title) return null;
  return {
    problemNumber: question.questionFrontendId,
    title: question.title,
    descriptionHtml: question.content || "",
  };
}

/** Encodes Unicode safely for GitHub's Contents API. */
function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/** Converts an external problem title into a safe folder name. */
function safeName(value) {
  return (
    String(value || "solution")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100) || "solution"
  );
}

/** Finds an unused numbered filename so no existing solution is overwritten. */
async function nextSolutionPath(repo, folder, extension, branch, isManual) {
  let entries = [];
  try {
    entries = await githubRequest(
      `/repos/${repo}/contents/${folder.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
    );
  } catch (error) {
    if (!/Not Found/i.test(error.message)) throw error;
  }

  const entriesList = Array.isArray(entries) ? entries : [];

  let count = 0;
  for (const entry of entriesList) {
    if (
      entry.name.startsWith("solution-") &&
      entry.name.endsWith(`.${extension}`)
    ) {
      count++;
    }
  }

  if (count >= 3) {
    if (!isManual) return null; // Abort auto-sync
    const sol3 = entriesList.find((e) => e.name === `solution-3.${extension}`);
    return {
      path: `${folder}/solution-3.${extension}`,
      sha: sol3 ? sol3.sha : undefined,
    };
  }

  const names = new Set(entriesList.map((entry) => entry.name));
  let number = 1;
  while (names.has(`solution-${number}.${extension}`)) number += 1;
  return { path: `${folder}/solution-${number}.${extension}` };
}

/** Uploads a new submission and creates the problem README only once. */
async function uploadSubmission(payload) {
  const config = await getConfig();
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.githubRepo || ""))
    throw new Error("Set repository as owner/repository in CodeSync settings.");
  if (!payload.code || payload.code.length > 2_000_000)
    throw new Error("Could not read a valid solution from the editor.");
  const repoInfo = await githubRequest(`/repos/${config.githubRepo}`);
  const branch = repoInfo.default_branch;
  const platform = payload.platform === "gfg" ? "gfg" : "leetcode";
  const leetHubFolderName = safeName(
    payload.problemNumber
      ? `${String(payload.problemNumber).padStart(4, "0")}-${payload.title}`
      : payload.title,
  );
  const folder =
    platform === "leetcode"
      ? `leetcode/${leetHubFolderName}`
      : `gfg/${leetHubFolderName}`;
  const extension = /^[a-z0-9]{1,8}$/.test(payload.extension)
    ? payload.extension
    : "txt";
  const solutionInfo = await nextSolutionPath(
    config.githubRepo,
    folder,
    extension,
    branch,
    payload.isManual,
  );
  if (!solutionInfo) return { skipped: true, repo: config.githubRepo };

  const codePath = solutionInfo.path;
  const put = (path, body) =>
    githubRequest(
      `/repos/${config.githubRepo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, branch }),
      },
    );
  await put(codePath, {
    message: `Add ${payload.title} (${platform})`,
    content: encodeBase64(payload.code),
    ...(solutionInfo.sha ? { sha: solutionInfo.sha } : {}),
  });
  const readmePath = `${folder}/README.md`;
  let existingReadme = null;
  try {
    existingReadme = await githubRequest(
      `/repos/${config.githubRepo}/contents/${readmePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
    );
  } catch (error) {
    if (!/Not Found/i.test(error.message)) throw error;
  }
  const description =
    payload.descriptionHtml || "Problem description could not be extracted.";
  const markdown = `# ${payload.displayTitle || payload.title}\n\n[Open problem](${payload.url})\n\n---\n\n${description}\n`;
  await put(readmePath, {
    message: `Update README for ${payload.title}`,
    content: encodeBase64(markdown),
    ...(existingReadme?.sha ? { sha: existingReadme.sha } : {}),
  });
  return { path: codePath, repo: config.githubRepo };
}

/** Starts GitHub's device OAuth flow; GitHub requires an OAuth App client ID. */
async function startGitHubSignIn() {
  if (!/^[a-zA-Z0-9._-]{10,}$/.test(GITHUB_OAUTH_CLIENT_ID || "")) {
    throw new Error(
      "GitHub sign-in is not configured yet. Set the extension OAuth Client ID once before release.",
    );
  }
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GITHUB_OAUTH_CLIENT_ID,
      scope: "repo read:user",
    }),
  });
  let data;
  const text = await response.text();
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `GitHub returned an invalid response (Status ${response.status}). Please check your OAuth app settings, especially "Enable Device Flow".`,
    );
  }
  if (!response.ok)
    throw new Error(
      data.error_description || "Could not start GitHub sign-in.",
    );
  await chrome.storage.session.set({
    pendingDeviceAuth: {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresAt: Date.now() + data.expires_in * 1000,
      interval: data.interval || 5,
    },
  });
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval || 5,
  };
}

/** Polls an approved device authorization and saves its revocable token locally. */
async function pollGitHubSignIn() {
  const { pendingDeviceAuth } =
    await chrome.storage.session.get("pendingDeviceAuth");
  if (!pendingDeviceAuth || Date.now() > pendingDeviceAuth.expiresAt)
    throw new Error("Sign-in expired. Please start again.");
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GITHUB_OAUTH_CLIENT_ID,
      device_code: pendingDeviceAuth.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  let data;
  const text = await response.text();
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `GitHub authorization polling failed (Status ${response.status}).`,
    );
  }
  if (data.error === "authorization_pending" || data.error === "slow_down")
    return {
      pending: true,
      interval:
        pendingDeviceAuth.interval + (data.error === "slow_down" ? 5 : 0),
    };
  if (data.error || !data.access_token)
    throw new Error(data.error_description || "GitHub sign-in failed.");
  await chrome.storage.local.set({
    githubToken: data.access_token,
  });
  const user = await githubRequest("/user");
  await chrome.storage.local.set({ githubUsername: user.login });
  await chrome.storage.session.remove("pendingDeviceAuth");
  return { pending: false, username: user.login };
}

/** Returns a live authorization code after the extension popup is reopened. */
async function getAuthStatus() {
  const { pendingDeviceAuth } =
    await chrome.storage.session.get("pendingDeviceAuth");
  if (!pendingDeviceAuth || Date.now() > pendingDeviceAuth.expiresAt) {
    return { pending: false };
  }

  return {
    pending: true,
    userCode: pendingDeviceAuth.userCode,
    verificationUri: pendingDeviceAuth.verificationUri,
  };
}

/** Routes messages so tokens stay isolated from page scripts and the popup. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    GET_CONFIG: getConfig,
    GET_LEETCODE_QUESTION: () => getLeetCodeQuestion(message.slug),
    SAVE_CONFIG: async () => {
      const { repo, autoSync } = message;
      if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo))
        throw new Error("Repository must look like owner/repository.");
      await chrome.storage.local.set({
        githubRepo: repo || "",
        autoSync: Boolean(autoSync),
      });
      return getConfig();
    },
    START_AUTH: startGitHubSignIn,
    POLL_AUTH: pollGitHubSignIn,
    GET_AUTH_STATUS: getAuthStatus,
    SIGN_OUT: async () => {
      await chrome.storage.local.remove(["githubToken", "githubUsername"]);
      return { ok: true };
    },
    UPLOAD_SUBMISSION: () => uploadSubmission(message.payload),
  };
  const handler = handlers[message.type];
  if (!handler) return false;
  handler()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) =>
      sendResponse({ ok: false, error: error.message || "Unexpected error." }),
    );
  return true;
});

// Inject content.js into existing matching tabs when the extension starts or re-enables.
// Since content.js is wrapped in an IIFE with an injection check, it will not run twice.
chrome.tabs.query({ url: ["*://*.leetcode.com/problems/*", "*://*.geeksforgeeks.org/problems/*"] })
  .then(tabs => {
    for (const tab of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      }).catch(() => {});
    }
  })
  .catch(() => {});
