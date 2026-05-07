const PrismaClient = (require("@prisma/client") as any).PrismaClient as new (...args: any[]) => any;

type SensitiveMatch = {
  matched: boolean;
  words: string[];
};

type TrieNode = {
  next: Map<string, number>;
  fail: number;
  output: string[];
};

class AhoCorasick {
  private readonly nodes: TrieNode[];

  constructor(words: string[]) {
    this.nodes = [{ next: new Map(), fail: 0, output: [] }];
    const uniq = Array.from(new Set(words.filter((w) => w.trim().length > 0)));
    for (const w of uniq) this.addWord(w);
    this.build();
  }

  private addWord(word: string) {
    let p = 0;
    for (const ch of word) {
      const next = this.nodes[p].next.get(ch);
      if (next !== undefined) {
        p = next;
        continue;
      }
      const idx = this.nodes.length;
      this.nodes.push({ next: new Map(), fail: 0, output: [] });
      this.nodes[p].next.set(ch, idx);
      p = idx;
    }
    this.nodes[p].output.push(word);
  }

  private build() {
    const queue: number[] = [];

    for (const [, child] of this.nodes[0].next) {
      this.nodes[child].fail = 0;
      queue.push(child);
    }

    while (queue.length) {
      const v = queue.shift() as number;
      for (const [ch, to] of this.nodes[v].next) {
        queue.push(to);
        let f = this.nodes[v].fail;
        while (f !== 0 && !this.nodes[f].next.has(ch)) {
          f = this.nodes[f].fail;
        }
        const link = this.nodes[f].next.get(ch);
        this.nodes[to].fail = link !== undefined ? link : 0;
        const failOut = this.nodes[this.nodes[to].fail].output;
        if (failOut.length) this.nodes[to].output.push(...failOut);
      }
    }
  }

  match(text: string, limit: number) {
    const found = new Set<string>();
    let p = 0;
    for (const ch of text) {
      while (p !== 0 && !this.nodes[p].next.has(ch)) {
        p = this.nodes[p].fail;
      }
      const next = this.nodes[p].next.get(ch);
      p = next !== undefined ? next : 0;
      const out = this.nodes[p].output;
      if (!out.length) continue;
      for (const w of out) {
        found.add(w);
        if (found.size >= limit) return Array.from(found);
      }
    }
    return Array.from(found);
  }
}

const prisma = new PrismaClient();

const parseWordList = (raw: string): string[] => {
  const value = raw.trim();
  if (!value) return [];

  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter((v) => v.length > 0);
      }
    } catch {
      return [];
    }
  }

  return value
    .split(/[\r\n,;，；\t ]+/g)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
};

export class SensitiveWordService {
  private machine: AhoCorasick | null = null;
  private loadedAtMs = 0;
  private lastValue = "";
  private readonly cacheTtlMs = 60_000;
  private readonly configKey = "sensitive_words";

  invalidate() {
    this.machine = null;
    this.loadedAtMs = 0;
    this.lastValue = "";
  }

  private async ensureLoaded() {
    const now = Date.now();
    if (this.machine && now - this.loadedAtMs < this.cacheTtlMs) return;

    const row = await prisma.systemConfig.findUnique({
      where: { key: this.configKey },
      select: { value: true, updated_at: true },
    });

    const value = (row?.value ?? "").trim();
    if (this.machine && value === this.lastValue && now - this.loadedAtMs < this.cacheTtlMs * 10) {
      this.loadedAtMs = now;
      return;
    }

    const words = parseWordList(value).map((w) => w.toLowerCase());
    this.machine = new AhoCorasick(words);
    this.loadedAtMs = now;
    this.lastValue = value;
  }

  async matchText(text: unknown): Promise<SensitiveMatch> {
    const content = text === undefined || text === null ? "" : String(text);
    const normalized = content.toLowerCase();
    await this.ensureLoaded();
    const machine = this.machine;
    if (!machine || !normalized) return { matched: false, words: [] };
    const words = machine.match(normalized, 20);
    return { matched: words.length > 0, words };
  }
}

export const sensitiveWordService = new SensitiveWordService();

export const containsSensitiveWord = async (text: unknown): Promise<boolean> => {
  const result = await sensitiveWordService.matchText(text);
  return result.matched;
};
