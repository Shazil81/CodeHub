# CodeHub 🚀

**A powerful Chrome Extension that seamlessly syncs your accepted LeetCode and GeeksforGeeks solutions directly to your GitHub repository.**

CodeHub simplifies your coding journey by automatically (or manually) pushing your successful problem-solving code to your GitHub account without the need for manual copy-pasting or dealing with Personal Access Tokens.

---

## ✨ Features

- **Multi-Platform Support**: Works seamlessly with both **LeetCode** and **GeeksforGeeks (GFG)**.
- **Automated Syncing**: Automatically push accepted submissions to GitHub as soon as they pass all test cases.
- **Manual Push Support**: Manually push solutions using the floating "Push to GitHub" button that appears upon successful submission.
- **Smart Organization**: Preserves code cleanly in your repository with versioning so no previous solution is overwritten.
  - LeetCode: `0001-two-sum/solution-1.py`
  - GFG: `gfg/problem-name/solution-1.ext`
- **Markdown Notes**: The first-time submission of a problem automatically generates a `README.md` containing the full problem description.
- **Secure Authentication**: Uses GitHub OAuth (Device Flow) to authenticate securely—no complex Personal Access Tokens (PATs) required.
- **Privacy First**: OAuth tokens are stored locally and securely, never synced or exposed to web pages.

---

## 🛠️ Setup & Installation

### For Users (Developer Mode)

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top right corner.
4. Click on **Load unpacked** and select the folder containing this extension.
5. The CodeHub icon will now appear in your Chrome toolbar.

### For Developers

If you wish to modify the code or set up your own OAuth app:

1. Create a GitHub OAuth App in your GitHub Developer Settings.
2. Open `github-oauth-config.js` and set the `CLIENT_ID` to your application's Client ID. *(Note: The device-flow setup does not need, and must never contain, a client secret).*
3. Run `npm install` if you need to install dependencies.
4. Load the extension locally as described in the User Setup section.

---

## 🚀 How to Use

1. **Sign In**: Click on the CodeHub extension icon in your Chrome toolbar.
2. **Link Repository**: Enter the GitHub repository where you want to save your code in the format `owner/repository` (e.g., `octocat/my-coding-solutions`).
3. **Authenticate**: Click **Sign in with GitHub** and follow the on-screen device authorization steps.
4. **Solve & Push**:
   - Go to a LeetCode or GeeksforGeeks problem page.
   - Write and submit your code.
   - Once accepted, a **Push to GitHub** button will appear on the bottom right of your screen. Click it to save your solution.
   - *(Optional)* Enable **Auto-Sync** in the extension popup to push code automatically without clicking.

---

## 🔒 Security & Privacy

We take the security of your GitHub account seriously:

- **Local Storage Only**: OAuth access tokens are strictly saved in `chrome.storage.local`. They are never stored in sync storage, page storage, source code, or the popup state.
- **Isolated Authentication**: Only the background service worker makes authenticated GitHub API calls. Content scripts injected into web pages never have access to your tokens.
- **Minimal Permissions**: The extension only requests host permissions for LeetCode, GFG, and GitHub, and is governed by a restrictive Content Security Policy (CSP).
- **Easy Revocation**: Signing out from the extension immediately removes the locally stored token. You can also permanently revoke authorization anytime from your GitHub account settings.

---

## 🤝 Contributing

Contributions, issues, and feature requests are highly welcome! 
Feel free to dive into the codebase and open a Pull Request.

---

## 👤 Author

**Mohammad Shazil Moin**
- Email: ahmadshahab890@gmail.com
- GitHub: [Shazil81](https://github.com/Shazil81)

---

## 📝 License

This project is open-source and available under the MIT License.
