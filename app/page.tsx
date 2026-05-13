"use client";

import {
  ChangeEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Answers,
  CustomerData,
  emptyCustomer,
  Question,
  Section,
  sections,
  totalQuestions,
} from "@/lib/sections";

interface CustomerSummary {
  slug: string;
  client: string;
  date: string;
  updatedAt: string;
  answeredCount: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const NEW_CUSTOMER = "__new__";

export default function Page() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const [state, setState] = useState<CustomerData>(emptyCustomer());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [openInfo, setOpenInfo] = useState<Set<string>>(new Set());
  const [chipFocus, setChipFocus] = useState<string | null>(null);
  const [chipDraft, setChipDraft] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string>("");
  const [bootstrapped, setBootstrapped] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const clientNameRef = useRef<HTMLInputElement | null>(null);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const chipInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // ------- bootstrap: load list, pick most recent or empty -------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/customers", { cache: "no-store" });
        const json: { customers: CustomerSummary[] } = await res.json();
        if (cancelled) return;
        setCustomers(json.customers);

        if (json.customers.length > 0) {
          await loadCustomer(json.customers[0].slug);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshList(): Promise<CustomerSummary[]> {
    try {
      const res = await fetch("/api/customers", { cache: "no-store" });
      const json: { customers: CustomerSummary[] } = await res.json();
      setCustomers(json.customers);
      return json.customers;
    } catch (err) {
      console.error(err);
      return customers;
    }
  }

  async function loadCustomer(slug: string) {
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(slug)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn("Could not load", slug);
        return;
      }
      const json: { slug: string; data: CustomerData } = await res.json();
      dirtyRef.current = false;
      setCurrentSlug(json.slug);
      setState({
        client: json.data.client ?? "",
        date: json.data.date ?? "",
        activeSection: json.data.activeSection ?? 1,
        answers: json.data.answers ?? {},
      });
      setOpenInfo(new Set());
      setChipDraft({});
      setSaveStatus("saved");
    } catch (err) {
      console.error(err);
    }
  }

  function startNewCustomer() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    dirtyRef.current = false;
    setCurrentSlug(null);
    setState(emptyCustomer());
    setOpenInfo(new Set());
    setChipDraft({});
    setSaveStatus("idle");
    setTimeout(() => clientNameRef.current?.focus(), 0);
  }

  // ------- autosave on dirty state -------
  useEffect(() => {
    if (!bootstrapped) return;
    if (!dirtyRef.current) return;
    if (!state.client.trim()) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");

    saveTimer.current = setTimeout(async () => {
      try {
        const url =
          currentSlug !== null
            ? `/api/customers/${encodeURIComponent(currentSlug)}`
            : "/api/customers";
        const method = currentSlug !== null ? "PUT" : "POST";

        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);

        const json: { slug: string; data: CustomerData } = await res.json();
        if (json.slug !== currentSlug) {
          setCurrentSlug(json.slug);
        }
        dirtyRef.current = false;
        setSaveStatus("saved");
        await refreshList();
      } catch (err) {
        console.error(err);
        setSaveStatus("error");
      }
    }, 600);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, bootstrapped]);

  // mark state changes dirty
  const updateState = useCallback((updater: (prev: CustomerData) => CustomerData) => {
    dirtyRef.current = true;
    setState((prev) => updater(prev));
  }, []);

  // ------- counters / progress -------
  const answeredCount = useMemo(() => countAnswered(state.answers), [state.answers]);
  const progressPct = Math.round((answeredCount / totalQuestions) * 100);

  const activeSection: Section =
    sections.find((s) => s.id === state.activeSection) ?? sections[0];

  // ------- handlers -------
  function setClient(value: string) {
    updateState((prev) => ({ ...prev, client: value }));
  }
  function setDate(value: string) {
    updateState((prev) => ({ ...prev, date: value }));
  }
  function setAnswer(key: string, value: string | string[]) {
    updateState((prev) => ({
      ...prev,
      answers: { ...prev.answers, [key]: value },
    }));
  }
  function gotoSection(id: number) {
    updateState((prev) => ({ ...prev, activeSection: id }));
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function toggleInfo(key: string) {
    setOpenInfo((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addChip(key: string, raw: string) {
    const value = raw.trim();
    if (!value) return;
    const current = (state.answers[key] as string[] | undefined) ?? [];
    setAnswer(key, [...current, value]);
  }
  function removeChip(key: string, idx: number) {
    const current = (state.answers[key] as string[] | undefined) ?? [];
    setAnswer(
      key,
      current.filter((_, i) => i !== idx),
    );
  }

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(""), 2200);
  }

  function exportMarkdown() {
    let md = `# ADDED — Discovery\n\n`;
    md += `**Kund:** ${state.client || "—"}  \n`;
    md += `**Mötesdatum:** ${state.date || "—"}  \n\n`;
    md += `---\n\n`;
    sections.forEach((s) => {
      md += `## ${String(s.id).padStart(2, "0")} · ${s.title}\n\n`;
      md += `*${s.subtitle}*\n\n`;
      s.questions.forEach((q, i) => {
        const key = `${s.id}-${i}`;
        const val = state.answers[key];
        md += `### ${String(i + 1).padStart(2, "0")}. ${q.q}\n\n`;
        if (q.type === "chips") {
          if (Array.isArray(val) && val.length > 0) {
            val.forEach((item) => {
              md += `- ${item}\n`;
            });
            md += `\n`;
          } else {
            md += `_(inget angivet)_\n\n`;
          }
        } else {
          md += `${val || "_(inget angivet)_"}\n\n`;
        }
      });
      md += `\n`;
    });

    const fallbackDownload = () => {
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `added-discovery-${slugifyClient(state.client) || "kund"}.md`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Nedladdad");
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(md).then(
        () => showToast("Kopierat till urklipp"),
        () => fallbackDownload(),
      );
    } else {
      fallbackDownload();
    }
  }

  async function deleteCurrent() {
    if (currentSlug === null) return;
    const ok = window.confirm(
      `Ta bort kunden "${state.client || currentSlug}" permanent?`,
    );
    if (!ok) return;
    try {
      await fetch(`/api/customers/${encodeURIComponent(currentSlug)}`, {
        method: "DELETE",
      });
      const list = await refreshList();
      if (list.length > 0) {
        await loadCustomer(list[0].slug);
      } else {
        startNewCustomer();
      }
      showToast("Borttagen");
    } catch (err) {
      console.error(err);
      showToast("Kunde inte ta bort");
    }
  }

  // textareas auto-grow
  useEffect(() => {
    textareaRefs.current.forEach((el) => autoGrow(el));
  }, [state.answers, state.activeSection]);

  // ------- render helpers -------
  const saveLabel =
    saveStatus === "saving"
      ? "Sparar"
      : saveStatus === "error"
        ? "Fel"
        : saveStatus === "saved"
          ? "Sparat"
          : "—";

  return (
    <div className="app">
      <header>
        <div className="header-inner">
          <div className="brand">
            <span className="brand-name">ADDED</span>
            <span className="brand-sep">/</span>
            <span className="brand-context">Discovery</span>
          </div>
          <div className="header-actions">
            <div className="save-indicator" aria-live="polite">
              <span
                className={`save-dot ${
                  saveStatus === "saving"
                    ? "saving"
                    : saveStatus === "error"
                      ? "error"
                      : ""
                }`}
              />
              <span>{saveLabel}</span>
            </div>
            <button
              className="btn"
              onClick={exportMarkdown}
              title="Kopiera sammanfattning som markdown"
            >
              Exportera
            </button>
            <button
              className="btn btn-mute"
              onClick={startNewCustomer}
              title="Börja med en ny kund"
            >
              Ny kund
            </button>
          </div>
        </div>
      </header>

      <div className="main">
        <aside>
          <div className="customer-picker">
            <label className="meta-label" htmlFor="customer-select">
              Aktiv kund
            </label>
            <div className="customer-row">
              <div className="select-wrap">
                <select
                  id="customer-select"
                  value={currentSlug ?? NEW_CUSTOMER}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === NEW_CUSTOMER) startNewCustomer();
                    else loadCustomer(v);
                  }}
                >
                  <option value={NEW_CUSTOMER}>+ Ny kund</option>
                  {customers.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.client} ({c.answeredCount}/{totalQuestions})
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="icon-btn danger"
                onClick={deleteCurrent}
                disabled={currentSlug === null}
                title="Ta bort denna kund"
                aria-label="Ta bort kund"
              >
                ×
              </button>
            </div>
          </div>

          <div className="meta">
            <label className="meta-label" htmlFor="client-name">
              Kund
            </label>
            <input
              id="client-name"
              ref={clientNameRef}
              type="text"
              placeholder="Kundens namn"
              value={state.client}
              onChange={(e) => setClient(e.target.value)}
            />
            <label className="meta-label" htmlFor="meeting-date">
              Mötesdatum
            </label>
            <input
              id="meeting-date"
              type="date"
              value={state.date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="progress">
            <label className="meta-label">Framsteg</label>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="progress-meta">
              <span>
                {answeredCount} / {totalQuestions}
              </span>
              <span>{progressPct}%</span>
            </div>
          </div>

          <div className="sections">
            <div className="sections-label">Sektioner</div>
            <ul className="section-list">
              {sections.map((s) => {
                const answered = countSectionAnswered(state.answers, s);
                return (
                  <li
                    key={s.id}
                    className={`section-item ${state.activeSection === s.id ? "active" : ""}`}
                    onClick={() => gotoSection(s.id)}
                  >
                    <span className="section-num">
                      {String(s.id).padStart(2, "0")}
                    </span>
                    <div className="section-body">
                      <span className="section-title">{s.title}</span>
                      <span className="section-count">
                        {answered}/{s.questions.length}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <main className="content">
          <div className="section-meta-row">
            <span className="dot" />
            <span>
              Del {String(activeSection.id).padStart(2, "0")} /{" "}
              {String(sections.length).padStart(2, "0")}
            </span>
          </div>
          <h1 className="section-heading">{activeSection.title}</h1>
          <p className="section-subtitle">{activeSection.subtitle}</p>

          <div className="questions" key={activeSection.id /* re-mount for animations */}>
            {activeSection.questions.map((q, i) => {
              const key = `${activeSection.id}-${i}`;
              const isInfoOpen = openInfo.has(key);
              return (
                <div className="question" key={key}>
                  <div className="q-num">{String(i + 1).padStart(2, "0")}</div>
                  <div className="q-content">
                    <div className="q-header">
                      <h2 className="q-title">{q.q}</h2>
                      {q.type === "chips" && (
                        <span className="q-type-badge">Flera svar</span>
                      )}
                      <button
                        className={`info-btn ${isInfoOpen ? "active" : ""}`}
                        onClick={() => toggleInfo(key)}
                        aria-label="Visa motivering"
                        type="button"
                      >
                        ?
                      </button>
                    </div>
                    <div className={`info-panel ${isInfoOpen ? "open" : ""}`}>
                      <strong>Varför vi frågar.</strong> {q.why}
                    </div>
                    {renderField({
                      q,
                      keyId: key,
                      answers: state.answers,
                      chipFocus,
                      setChipFocus,
                      chipDraft,
                      setChipDraft,
                      setAnswer,
                      addChip,
                      removeChip,
                      textareaRefs,
                      chipInputRefs,
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <SectionNav
            activeId={activeSection.id}
            onPrev={() => gotoSection(activeSection.id - 1)}
            onNext={() => gotoSection(activeSection.id + 1)}
          />
        </main>
      </div>

      <footer>
        <div className="footer-inner">
          <div className="footer-col">
            <span className="footer-label">Studio</span>
            <span className="footer-val">ADDED Digital Scandinavia</span>
            <span className="footer-val">Sankt Eriksgatan 46A</span>
            <span className="footer-val">112 34 Stockholm</span>
          </div>
          <div className="footer-col">
            <span className="footer-label">Verktyg</span>
            <span className="footer-val">Discovery toolkit</span>
            <span className="footer-val footer-mute">v2 — Internt</span>
          </div>
          <div className="footer-col">
            <span className="footer-label">Kontakt</span>
            <span className="footer-val">Hello@added.digital</span>
            <span className="footer-val">+46 73 330 70 55</span>
          </div>
          <div className="footer-col footer-right">
            <span className="footer-label">© 2026</span>
            <a
              className="footer-val footer-link"
              href="https://www.added.digital"
              target="_blank"
              rel="noopener"
            >
              added.digital ↗
            </a>
          </div>
        </div>
      </footer>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

// ------- subcomponents / helpers -------

function SectionNav({
  activeId,
  onPrev,
  onNext,
}: {
  activeId: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const prev = sections.find((s) => s.id === activeId - 1) ?? null;
  const next = sections.find((s) => s.id === activeId + 1) ?? null;
  return (
    <div className="section-nav">
      <button className="nav-btn prev" disabled={!prev} onClick={onPrev}>
        <span className="nav-hint">← Föregående</span>
        <span className="nav-text">{prev ? prev.title : "—"}</span>
      </button>
      <button className="nav-btn next" disabled={!next} onClick={onNext}>
        <span className="nav-hint">Nästa →</span>
        <span className="nav-text">{next ? next.title : "—"}</span>
      </button>
    </div>
  );
}

interface RenderFieldArgs {
  q: Question;
  keyId: string;
  answers: Answers;
  chipFocus: string | null;
  setChipFocus: (k: string | null) => void;
  chipDraft: Record<string, string>;
  setChipDraft: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  setAnswer: (key: string, value: string | string[]) => void;
  addChip: (key: string, raw: string) => void;
  removeChip: (key: string, idx: number) => void;
  textareaRefs: React.MutableRefObject<Map<string, HTMLTextAreaElement>>;
  chipInputRefs: React.MutableRefObject<Map<string, HTMLInputElement>>;
}

function renderField(args: RenderFieldArgs) {
  const { q, keyId, answers } = args;
  if (q.type === "chips") {
    return <ChipField {...args} />;
  }
  const val = (answers[keyId] as string | undefined) ?? "";
  return (
    <textarea
      placeholder={q.placeholder}
      value={val}
      ref={(el) => {
        if (el) args.textareaRefs.current.set(keyId, el);
        else args.textareaRefs.current.delete(keyId);
      }}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
        args.setAnswer(keyId, e.target.value);
        autoGrow(e.currentTarget);
      }}
    />
  );
}

function ChipField({
  q,
  keyId,
  answers,
  chipFocus,
  setChipFocus,
  chipDraft,
  setChipDraft,
  addChip,
  removeChip,
  chipInputRefs,
}: RenderFieldArgs) {
  const chips = (answers[keyId] as string[] | undefined) ?? [];
  const draft = chipDraft[keyId] ?? "";
  const focused = chipFocus === keyId;

  return (
    <>
      <div className={`chip-input ${focused ? "focused" : ""}`}>
        {chips.map((chip, idx) => (
          <span className="chip" key={`${idx}-${chip}`}>
            {chip}
            <button
              type="button"
              className="chip-remove"
              aria-label="Ta bort"
              onClick={(e) => {
                e.stopPropagation();
                removeChip(keyId, idx);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="chip-text-input"
          placeholder={chips.length === 0 ? q.placeholder : "Lägg till..."}
          value={draft}
          ref={(el) => {
            if (el) chipInputRefs.current.set(keyId, el);
            else chipInputRefs.current.delete(keyId);
          }}
          onFocus={() => setChipFocus(keyId)}
          onBlur={() => {
            setChipFocus(null);
            if (draft.trim()) {
              addChip(keyId, draft);
              setChipDraft((prev) => ({ ...prev, [keyId]: "" }));
            }
          }}
          onChange={(e) => setChipDraft((prev) => ({ ...prev, [keyId]: e.target.value }))}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) {
                addChip(keyId, draft);
                setChipDraft((prev) => ({ ...prev, [keyId]: "" }));
              }
            } else if (e.key === "Backspace" && draft === "" && chips.length > 0) {
              removeChip(keyId, chips.length - 1);
            }
          }}
        />
      </div>
      <div className="chip-hint">
        Tryck <kbd>Enter</kbd> för att lägga till. <kbd>Backspace</kbd> i tomt fält
        tar bort föregående.
      </div>
    </>
  );
}

function isAnswered(answers: Answers, key: string, type: "text" | "chips"): boolean {
  const val = answers[key];
  if (type === "chips") return Array.isArray(val) && val.length > 0;
  return typeof val === "string" && val.trim().length > 0;
}

function countAnswered(answers: Answers): number {
  let count = 0;
  sections.forEach((s) => {
    s.questions.forEach((q, i) => {
      if (isAnswered(answers, `${s.id}-${i}`, q.type)) count++;
    });
  });
  return count;
}

function countSectionAnswered(answers: Answers, section: Section): number {
  let count = 0;
  section.questions.forEach((q, i) => {
    if (isAnswered(answers, `${section.id}-${i}`, q.type)) count++;
  });
  return count;
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.max(120, el.scrollHeight + 2)}px`;
}

function slugifyClient(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/å/g, "a")
      .replace(/ä/g, "a")
      .replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}
