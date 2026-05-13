import { promises as fs } from "node:fs";
import path from "node:path";
import { CustomerData, emptyCustomer } from "./sections";

const DATA_DIR = path.join(process.cwd(), "data");

/** Convert a free-text customer name into a safe, deterministic filename slug. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/å/g, "a")
      .replace(/ä/g, "a")
      .replace(/ö/g, "o")
      .replace(/é/g, "e")
      .replace(/è/g, "e")
      .replace(/ü/g, "u")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip remaining diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "kund"
  );
}

/** Reject anything that could escape the data directory. */
function assertSafeSlug(slug: string): void {
  if (!slug || slug.includes("/") || slug.includes("\\") || slug.includes("..") || slug.startsWith(".")) {
    throw new Error(`Invalid slug: ${slug}`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function fileFor(slug: string): string {
  return path.join(DATA_DIR, `${slug}.json`);
}

export interface CustomerSummary {
  slug: string;
  client: string;
  date: string;
  updatedAt: string;
  answeredCount: number;
}

export async function listCustomers(): Promise<CustomerSummary[]> {
  await ensureDataDir();
  const entries = await fs.readdir(DATA_DIR);
  const summaries: CustomerSummary[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const slug = entry.replace(/\.json$/, "");
    try {
      const data = await readCustomer(slug);
      const stat = await fs.stat(fileFor(slug));
      const answeredCount = Object.values(data.answers).filter((v) =>
        Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim().length > 0,
      ).length;
      summaries.push({
        slug,
        client: data.client || slug,
        date: data.date || "",
        updatedAt: data.updatedAt || stat.mtime.toISOString(),
        answeredCount,
      });
    } catch {
      // skip unreadable files
    }
  }

  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

export async function readCustomer(slug: string): Promise<CustomerData> {
  assertSafeSlug(slug);
  await ensureDataDir();
  try {
    const raw = await fs.readFile(fileFor(slug), "utf8");
    const parsed = JSON.parse(raw) as Partial<CustomerData>;
    return {
      client: parsed.client ?? "",
      date: parsed.date ?? "",
      activeSection: parsed.activeSection ?? 1,
      answers: parsed.answers ?? {},
      updatedAt: parsed.updatedAt,
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyCustomer();
    }
    throw err;
  }
}

export async function writeCustomer(slug: string, data: CustomerData): Promise<CustomerData> {
  assertSafeSlug(slug);
  await ensureDataDir();
  const payload: CustomerData = {
    client: data.client ?? "",
    date: data.date ?? "",
    activeSection: data.activeSection ?? 1,
    answers: data.answers ?? {},
    updatedAt: new Date().toISOString(),
  };
  // Atomic write via tmp file rename — avoids partial writes if the process dies mid-save.
  const tmp = fileFor(`${slug}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const final = fileFor(slug);
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(tmp, final);
  return payload;
}

export async function deleteCustomer(slug: string): Promise<boolean> {
  assertSafeSlug(slug);
  try {
    await fs.unlink(fileFor(slug));
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function customerExists(slug: string): Promise<boolean> {
  assertSafeSlug(slug);
  try {
    await fs.access(fileFor(slug));
    return true;
  } catch {
    return false;
  }
}
