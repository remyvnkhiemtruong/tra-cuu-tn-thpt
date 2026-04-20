import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultSource = "C:\\Users\\Administrator\\Downloads\\Danh sach tai khoan thi sinh.xls";
const sourcePath = path.resolve(process.argv[2] ?? defaultSource);
const outputPath = path.join(rootDir, "data", "records.json");

const raw = extractWorkbook(sourcePath);
const rows = raw.records.map((record, index) => normalizeRecord(record, index + 7));
const seen = new Set();
const records = {};
const globalSalt = base64Url(crypto.randomBytes(24));

for (const record of rows) {
  const lookupSource = globalSalt + record.account + record.dob;
  const lookupHash = crypto.createHash("sha256").update(lookupSource, "utf8").digest("hex");

  if (seen.has(`${record.account}|${record.dob}`)) {
    throw new Error(`Duplicate account + date of birth key at source row ${record.sourceRow}.`);
  }
  seen.add(`${record.account}|${record.dob}`);

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const keyMaterial = record.account + record.dob;
  const key = crypto.pbkdf2Sync(keyMaterial, salt, 200000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(
    JSON.stringify({
      name: record.name,
      className: record.className,
      account: record.account,
      loginCode: record.loginCode,
    }),
    "utf8"
  );
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  records[lookupHash] = {
    salt: base64Url(salt),
    iv: base64Url(iv),
    ciphertext: base64Url(Buffer.concat([encrypted, tag])),
  };
}

const output = {
  version: 2,
  school: raw.school || "THPT VÕ VĂN KIỆT",
  recordCount: rows.length,
  generatedAt: new Date().toISOString(),
  crypto: {
    lookup: "SHA-256(globalSalt + account + dob)",
    kdf: "PBKDF2-SHA256",
    iterations: 200000,
    cipher: "AES-GCM-256",
  },
  globalSalt,
  records,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      output: outputPath,
      recordCount: rows.length,
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

  if (!account) throw new Error(`Missing account at source row ${sourceRow}.`);
  if (!dob) throw new Error(`Missing or invalid date of birth at source row ${sourceRow}.`);
  if (!loginCode) throw new Error(`Missing login code at source row ${sourceRow}.`);
  if (!name) throw new Error(`Missing name at source row ${sourceRow}.`);

  return { account, dob, loginCode, name, className, sourceRow };
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

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
