"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src", "lms", "class-catalog.js"),
  "utf8"
);

const localData = {
  __class_catalog__: {
    version: 1,
    fullUpdatedAt: Date.now(),
    years: {}
  }
};

const chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) { callback?.(); },
    onMessage: { addListener() {} }
  },
  storage: {
    local: {
      get(keys, callback) {
        queueMicrotask(() => {
          const list = Array.isArray(keys) ? keys : [keys];
          const result = {};
          list.forEach((key) => {
            if (key in localData) result[key] = structuredClone(localData[key]);
          });
          callback(result);
        });
      },
      set(items, callback) {
        queueMicrotask(() => {
          Object.assign(localData, structuredClone(items));
          callback?.();
        });
      }
    }
  }
};

const lockTails = new Map();
const locks = {
  request(name, options, operation) {
    const previous = lockTails.get(name) || Promise.resolve();
    const current = previous.then(operation);
    lockTails.set(name, current.catch(() => {}));
    return current;
  }
};

function makeContext(classId, subject) {
  const link = {
    textContent: subject,
    getAttribute(name) {
      return name === "href" ? `/lms/class/${classId}/` : null;
    }
  };
  const document = {
    querySelectorAll(selector) {
      return selector.includes("/lms/class/") ? [link] : [];
    }
  };
  return vm.createContext({
    chrome,
    console: { ...console, warn() {} },
    Date,
    document,
    location: {
      origin: "https://portal.iwasaki.ac.jp",
      pathname: "/lms/"
    },
    navigator: { locks },
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    structuredClone
  });
}

async function settle(rounds = 20) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function main() {
  vm.runInContext(source, makeContext("100", "数学"), { filename: "class-catalog-a.js" });
  vm.runInContext(source, makeContext("200", "英語"), { filename: "class-catalog-b.js" });
  await settle();

  const classes = Object.values(localData.__class_catalog_home__.years).flat();
  assert.deepEqual(
    classes.map((entry) => entry.classId).sort(),
    ["100", "200"],
    "複数タブの補助カタログ更新をread-modify-write競合で失わない"
  );
  console.log("class catalog race test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
