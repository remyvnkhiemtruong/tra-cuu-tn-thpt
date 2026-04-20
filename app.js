const DATA_URL = "data/records.json";
const NOT_FOUND_MESSAGE =
  "Không tìm thấy thông tin phù hợp. Vui lòng kiểm tra lại Số ĐDCN, ngày sinh và mã truy cập.";

const form = document.querySelector("#lookup-form");
const submitButton = document.querySelector("#submit-button");
const statusEl = document.querySelector("#status");
const resultPanel = document.querySelector("#result");
const resultName = document.querySelector("#result-name");
const resultClass = document.querySelector("#result-class");
const resultAccount = document.querySelector("#result-account");
const resultCode = document.querySelector("#result-code");

const encoder = new TextEncoder();
let dataPromise;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Đang tra cứu...", "");
  resultPanel.hidden = true;
  submitButton.disabled = true;

  try {
    const formData = new FormData(form);
    const account = normalizeAccount(formData.get("account"));
    const dob = normalizeDob(formData.get("dob"));
    const accessCode = normalizeAccessCode(formData.get("accessCode"));

    if (!account || !dob || !accessCode) {
      throw new UserFacingError(
        "Vui lòng nhập đầy đủ Số ĐDCN, ngày sinh và mã truy cập."
      );
    }

    const dataset = await loadData();
    const lookupHash = await sha256Hex(dataset.globalSalt + account + dob + accessCode);
    const encryptedRecord = dataset.records[lookupHash];

    if (!encryptedRecord) {
      throw new UserFacingError(NOT_FOUND_MESSAGE);
    }

    const profile = await decryptRecord(encryptedRecord, account, dob, accessCode);
    showResult(profile);
    setStatus("Tra cứu thành công.", "success");
  } catch (error) {
    const message = error instanceof UserFacingError ? error.message : NOT_FOUND_MESSAGE;
    setStatus(message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    const value = target?.textContent?.trim();
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      const original = button.textContent;
      button.textContent = "Đã chép";
      window.setTimeout(() => {
        button.textContent = original;
      }, 1300);
    } catch {
      setStatus("Không thể sao chép tự động. Vui lòng sao chép thủ công.", "error");
    }
  });
});

function loadData() {
  if (!dataPromise) {
    dataPromise = fetch(DATA_URL, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Cannot load lookup data: ${response.status}`);
      }
      return response.json();
    });
  }
  return dataPromise;
}

async function decryptRecord(record, account, dob, accessCode) {
  const salt = base64UrlToBytes(record.salt);
  const iv = base64UrlToBytes(record.iv);
  const ciphertext = base64UrlToBytes(record.ciphertext);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(account + dob + accessCode),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 200000,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plainBuffer));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeAccount(value) {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

function normalizeAccessCode(value) {
  return String(value ?? "").normalize("NFC").trim();
}

function normalizeDob(value) {
  const raw = String(value ?? "").trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  let year;
  let month;
  let day;

  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (slashMatch) {
    day = Number(slashMatch[1]);
    month = Number(slashMatch[2]);
    year = Number(slashMatch[3]);
  } else {
    return "";
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return "";
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function base64UrlToBytes(value) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function showResult(profile) {
  resultName.textContent = profile.name;
  resultClass.textContent = profile.className;
  resultAccount.textContent = profile.account;
  resultCode.textContent = profile.loginCode;
  resultPanel.hidden = false;
}

function setStatus(message, state) {
  statusEl.textContent = message;
  statusEl.className = `status${state ? ` ${state}` : ""}`;
}

class UserFacingError extends Error {}
