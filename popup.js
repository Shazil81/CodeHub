/** Sends a typed request to the background worker and normalizes errors. */
function request(type, extra = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...extra }, (response) => {
      if (response?.ok) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || "Extension connection failed."));
      }
    });
  });
}

(async () => {
  const authSection = document.getElementById("auth-section");
  const repoInput = document.getElementById("repo-input");
  const autoSyncCheckbox = document.getElementById("autosync-checkbox");
  const saveBtn = document.getElementById("save-btn");
  const noticeBox = document.getElementById("notice-box");

  let config = { githubRepo: "", autoSync: true, githubUsername: "" };
  let authorization = null;
  let busy = false;
  let authPollInterval = null;

  function startAuthPolling() {
    if (authPollInterval) clearInterval(authPollInterval);
    if (!authorization) return;
    
    authPollInterval = setInterval(async () => {
      if (busy) return; // Prevent concurrent requests
      busy = true;
      try {
        const result = await request("POLL_AUTH");
        if (result.pending) {
          busy = false;
          return;
        }
        clearInterval(authPollInterval);
        config.githubUsername = result.username;
        authorization = null;
        showNotice(`Signed in as ${result.username}.`);
        renderAuthUI();
      } catch (error) {
        clearInterval(authPollInterval);
        showNotice(error.message);
      } finally {
        busy = false;
      }
    }, (authorization.interval || 5) * 1000);
  }

  function showNotice(msg) {
    if (!msg) {
      noticeBox.style.display = "none";
      return;
    }
    noticeBox.textContent = msg;
    noticeBox.style.display = "block";
  }

  function renderAuthUI() {
    authSection.innerHTML = '<div class="label">GitHub account</div>';

    if (config.githubUsername) {
      authSection.innerHTML += `
        <div class="signed">
          <span>Connected as <b>${config.githubUsername}</b></span>
          <button class="link" id="btn-signout">Sign out</button>
        </div>
      `;
      document.getElementById("btn-signout").addEventListener("click", signOut);
    } else if (authorization) {
      authSection.innerHTML += `
        <div class="authorization">
          <p class="account-copy">Enter this code on GitHub:</p>
          <div class="device-code">${authorization.userCode}</div>
          <button class="secondary" id="btn-copy">Copy code</button>
          <a class="primary authorization-link" href="${authorization.verificationUri}" target="_blank" rel="noreferrer">Open GitHub authorization</a>
          <button class="secondary" id="btn-complete" ${busy ? "disabled" : ""}>I have authorized</button>
        </div>
      `;
      document.getElementById("btn-copy").addEventListener("click", copyCode);
      document
        .getElementById("btn-complete")
        .addEventListener("click", completeSignIn);
    } else {
      authSection.innerHTML += `
        <p class="account-copy">Connect your GitHub account securely.</p>
        <button class="primary" id="btn-signin" ${busy ? "disabled" : ""}>Sign in with GitHub</button>
      `;
      document.getElementById("btn-signin").addEventListener("click", signIn);
    }
  }

  async function loadInitialData() {
    try {
      const [savedConfig, authStatus] = await Promise.all([
        request("GET_CONFIG"),
        request("GET_AUTH_STATUS"),
      ]);
      config = savedConfig;
      repoInput.value = config.githubRepo || "";
      autoSyncCheckbox.checked = config.autoSync;
      authorization = authStatus.pending ? authStatus : null;
      renderAuthUI();
      if (authorization) startAuthPolling();
    } catch (error) {
      showNotice(error.message);
    }
  }

  saveBtn.addEventListener("click", async () => {
    busy = true;
    saveBtn.disabled = true;
    try {
      config = await request("SAVE_CONFIG", {
        repo: repoInput.value.trim(),
        autoSync: autoSyncCheckbox.checked,
      });
      showNotice("Settings saved.");
    } catch (error) {
      showNotice(error.message);
    } finally {
      busy = false;
      saveBtn.disabled = false;
      renderAuthUI();
    }
  });

  async function signIn() {
    busy = true;
    renderAuthUI();
    showNotice("");
    try {
      await request("SAVE_CONFIG", {
        repo: repoInput.value.trim(),
        autoSync: autoSyncCheckbox.checked,
      });
      authorization = await request("START_AUTH");
      showNotice("Copy the code and authorize this device on GitHub.");
      startAuthPolling();
    } catch (error) {
      showNotice(error.message);
    } finally {
      busy = false;
      renderAuthUI();
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(authorization.userCode);
      showNotice("Code copied.");
    } catch {
      showNotice("Select and copy the code manually.");
    }
  }

  async function completeSignIn() {
    if (authPollInterval) clearInterval(authPollInterval);
    busy = true;
    renderAuthUI();
    try {
      const result = await request("POLL_AUTH");
      if (result.pending) {
        showNotice(
          "GitHub authorization is not complete yet. Submit the code and try again.",
        );
        busy = false;
        renderAuthUI();
        return;
      }
      config.githubUsername = result.username;
      authorization = null;
      showNotice(`Signed in as ${result.username}.`);
    } catch (error) {
      showNotice(error.message);
    } finally {
      busy = false;
      renderAuthUI();
    }
  }

  async function signOut() {
    await request("SIGN_OUT");
    config.githubUsername = "";
    showNotice("GitHub signed out.");
    renderAuthUI();
  }

  loadInitialData();
})();
