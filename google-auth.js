(() => {
  "use strict";

  function getToken(interactive) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        const error = chrome.runtime.lastError;
        if (error || !token) {
          reject(new Error(error ? error.message : "認証トークンを取得できませんでした"));
          return;
        }
        resolve(token);
      });
    });
  }

  function forgetToken(token) {
    return new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
  }

  async function authenticatedRequest(token, url, options) {
    return fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
  }

  async function authFetch(token, url, options = {}) {
    let response = await authenticatedRequest(token, url, options);
    if (response.status === 401) {
      await forgetToken(token);
      const refreshedToken = await getToken(true);
      response = await authenticatedRequest(refreshedToken, url, options);
      if (response.status === 401) await forgetToken(refreshedToken);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(`Google APIへのリクエストに失敗しました (${response.status}) ${text}`);
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async function login() {
    await getToken(true);
  }

  async function logout() {
    let token;
    try {
      token = await getToken(false);
    } catch (error) {
      return;
    }
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
    } catch (error) {
      // 失効APIへ届かなくても、少なくともローカルのキャッシュは破棄する
    }
    await forgetToken(token);
  }

  async function isLoggedIn() {
    try {
      await getToken(false);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function getUserEmail() {
    const token = await getToken(false);
    const response = await authFetch(token, "https://www.googleapis.com/oauth2/v2/userinfo");
    const info = await response.json();
    return typeof info.email === "string" ? info.email : "";
  }

  async function reauthorize() {
    if (typeof chrome.identity.clearAllCachedAuthTokens === "function") {
      await new Promise((resolve, reject) => {
        chrome.identity.clearAllCachedAuthTokens(() => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve();
        });
      });
    } else {
      try {
        const token = await getToken(false);
        await forgetToken(token);
      } catch (error) {
        // キャッシュ済みトークンが無い場合も、そのまま対話認証へ進む
      }
    }
    return getToken(true);
  }

  globalThis.GoogleAuth = Object.freeze({
    getToken,
    forgetToken,
    authFetch,
    login,
    logout,
    isLoggedIn,
    getUserEmail,
    reauthorize
  });
})();
