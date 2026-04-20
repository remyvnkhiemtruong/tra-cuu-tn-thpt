import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultSource = "C:\\Users\\Administrator\\Downloads\\Danh sach tai khoan thi sinh.xls";
const sourcePath = path.resolve(process.argv[2] ?? defaultSource);
const dataPath = path.join(rootDir, "data", "records.json");
const localCodePath = path.join(rootDir, "local-access-code.txt");

const [dataset, accessCodeText] = await Promise.all([
  fs.readFile(dataPath, "utf8").then(JSON.parse),
  fs.readFile(localCodePath, "utf8"),
]);

const accessCode = accessCodeText
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => /^[A-Z2-9]{10,12}$/.test(line));

if (!accessCode) {
  throw new Error("Cannot read local access code.");
}

const raw = extractWorkbook(sourcePath);
const rows = raw.records.map((record, index) => normalizeRecord(record, index + 7));
const problems = [];

for (const record of rows) {
  const lookupHash = crypto
    .createHash("sha256")
    .update(dataset.globalSalt + record.account + record.dob + accessCode, "utf8")
    .digest("hex");
  const encrypted = dataset.records[lookupHash];

  if (!encrypted) {
    problems.push(`Missing encrypted record for source row ${record.sourceRow}.`);
    continue;
  }

  const profile = decryptRecord(encrypted, record.account, record.dob, accessCode);
  if (
    profile.name !== record.name ||
    profile.className !== record.className ||
    profile.account !== record.account ||
    profile.loginCode !== record.loginCode
  ) {
    problems.push(`Decrypted payload mismatch at source row ${record.sourceRow}.`);
  }
}

const negativeChecks = [
  ["wrong-account", mutate(rows[0].account), rows[0].dob, accessCode],
  ["wrong-dob", rows[1].account, "1999-01-01", accessCode],
  ["wrong-code", rows[2].account, rows[2].dob, `${accessCode}X`],
];

for (const [label, account, dob, code] of negativeChecks) {
  const lookupHash = crypto
    .createHash("sha256")
    .update(dataset.globalSalt + account + dob + code, "utf8")
    .digest("hex");

  if (dataset.records[lookupHash]) {
    problems.push(`Negative lookup unexpectedly matched: ${label}.`);
  }
}

if (dataset.recordCount !== rows.length) {
  problems.push(`recordCount is ${dataset.recordCount}, expected ${rows.length}.`);
}

if (Object.keys(dataset.records).length !== rows.length) {
  problems.push(`records object has ${Object.keys(dataset.records).length}, expected ${rows.length}.`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      verifiedRecords: rows.length,
      negativeChecks: negativeChecks.length,
      encryptedRecordCount: Object.keys(dataset.records).length,
    },
    null,
    2
  )
);

function extractWorkbook(source) {
  const scriptPath = path.join(__dirname, "extract-xls.ps1");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Source", source],
    {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
      windowsHide: true,
    }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Excel extraction failed.");
  }

  return JSON.parse(result.stdout);
}

function normalizeRecord(record, sourceRow) {
  const account = String(record.account ?? "").trim().replace(/\s+/g, "");
  const dob = normalizeDob(record.dob);
  const loginCode = String(record.loginCode ?? "").trim();
  const name = String(record.name ?? "").trim();
  const className = String(record.className ?? "").trim();

  return { account, dob, loginCode, name, className, sourceRow };
}

function decryptRecord(record, account, dob, accessCode) {
  const salt = base64UrlToBuffer(record.salt);
  const iv = base64UrlToBuffer(record.iv);
  const payload = base64UrlToBuffer(record.ciphertext);
  const ciphertext = payload.subarray(0, payload.length - 16);
  const tag = payload.subarray(payload.length - 16);
  const key = crypto.pbkdf2Sync(account + dob + accessCode, salt, 200000, 32, "sha256");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
}

function normalizeDob(value) {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  let year;
  let month;
  let day;

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (slash) {
    day = Number(slash[1]);
    month = Number(slash[2]);
    year = Number(slash[3]);
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

function base64UrlToBuffer(value) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function mutate(value) {
  const last = value.at(-1);
  return `${value.slice(0, -1)}${last === "9" ? "0" : "9"}`;
}
