"use client";

import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  isoWeekString,
  isPhaseCategoryAssignee,
  newAllocation,
  newComment,
  newPhase,
  newProject,
  newWeeklyNote,
  phaseOrder,
  projectStatusLabel,
  projectStatusOrder,
  teamMembers,
  WEEKLY_CAPACITY,
  type CommentAssignee,
  type CustomerData,
  type PhaseComment,
  type PhaseType,
  type Project,
  type ProjectAllocation,
  type ProjectPhase,
  type ProjectStatus,
  type TeamMember,
  type WeeklyNote,
} from "@/lib/sections";
import {
  availableNextWeeks,
  computeWeeklyBookings,
  type WeekBooking,
} from "@/lib/workload";
import { ProjectPanel } from "@/components/ProjectPanel";
import { DatePicker } from "@/components/DatePicker";
import { showToast } from "@/components/Toast";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Pencil,
  Plus,
  X,
} from "lucide-react";

// ---- Types -----------------------------------------------------------------

interface CustomerSummary {
  slug: string;
  client: string;
}

interface ProjectRow {
  customer: string;
  customerSlug: string;
  project: Project;
}

interface WeekInfo {
  weekNum: number;
  monday: Date;
  sunday: Date;
}

interface SelectedPhase {
  customerSlug: string;
  projectId: string;
  phaseId: string;
}

// ---- Constants -------------------------------------------------------------

const MONTHS_SV = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Maj",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dec",
];

const MONTHS_SHORT = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

const WEEK_WIDTH = 36;
const LABEL_WIDTH = 220;
const PHASE_ROW_HEIGHT = 32;
const HEADER_ROW_HEIGHT = 38;
const DRAG_THRESHOLD = 4;

// ---- Date helpers ----------------------------------------------------------

function isoWeeksOfYear(year: number): WeekInfo[] {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - dow);

  const weeks: WeekInfo[] = [];
  let monday = new Date(week1Mon);
  let weekNum = 1;
  while (true) {
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    weeks.push({ weekNum, monday: new Date(monday), sunday });

    const nextMon = new Date(monday);
    nextMon.setUTCDate(monday.getUTCDate() + 7);
    const nextThu = new Date(nextMon);
    nextThu.setUTCDate(nextMon.getUTCDate() + 3);
    if (nextThu.getUTCFullYear() !== year) break;
    monday = nextMon;
    weekNum++;
  }
  return weeks;
}

function parseISODate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function addDaysToISO(iso: string, days: number): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthGroups(weeks: WeekInfo[]) {
  const groups: {
    label: string;
    start: number;
    end: number;
    monthIdx: number;
    yearOfMonth: number;
  }[] = [];
  weeks.forEach((w, i) => {
    const thu = new Date(w.monday);
    thu.setUTCDate(w.monday.getUTCDate() + 3);
    const label = MONTHS_SV[thu.getUTCMonth()];
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.end = i;
    else
      groups.push({
        label,
        start: i,
        end: i,
        monthIdx: thu.getUTCMonth(),
        yearOfMonth: thu.getUTCFullYear(),
      });
  });
  return groups;
}

function currentWeekIndex(weeks: WeekInfo[], now: Date): number {
  const t = now.getTime();
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const endOfSun = new Date(w.sunday);
    endOfSun.setUTCHours(23, 59, 59, 999);
    if (t >= w.monday.getTime() && t <= endOfSun.getTime()) return i;
  }
  return -1;
}

interface RangeResult {
  startIdx: number;
  endIdx: number;
}

function dateRangeToWeeks(
  weeks: WeekInfo[],
  startDate: Date,
  endDate: Date,
): RangeResult | null {
  if (weeks.length === 0) return null;
  const yearStart = weeks[0].monday;
  const yearEnd = weeks[weeks.length - 1].sunday;
  if (endDate < yearStart) return null;
  if (startDate > yearEnd) return null;

  let startIdx = 0;
  if (startDate >= yearStart) {
    startIdx = weeks.findIndex((w) => w.sunday >= startDate);
    if (startIdx === -1) startIdx = weeks.length - 1;
  }
  let endIdx = weeks.length - 1;
  if (endDate <= yearEnd) {
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (weeks[i].monday <= endDate) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx < startIdx) endIdx = startIdx;
  return { startIdx, endIdx };
}

function formatPanelDateRange(start: string, end: string): string {
  if (!start) return "";
  const s = new Date(start + "T00:00:00Z");
  const e = end ? new Date(end + "T00:00:00Z") : s;
  if (Number.isNaN(s.getTime())) return "";
  const sd = s.getUTCDate();
  const sm = s.getUTCMonth();
  const ed = e.getUTCDate();
  const em = e.getUTCMonth();
  if (start === (end || start)) return `${sd} ${MONTHS_SHORT[sm]}`;
  if (sm === em) return `${sd}–${ed} ${MONTHS_SHORT[sm]}`;
  return `${sd} ${MONTHS_SHORT[sm]} – ${ed} ${MONTHS_SHORT[em]}`;
}

function fmtDay(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function autoGrowComment(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.max(28, el.scrollHeight)}px`;
}

/** Does this comment match the given assignee filter (category or person)? */
function commentMatchesFilter(
  c: PhaseComment,
  filter: CommentAssignee,
): boolean {
  if (!filter) return true;
  if (isPhaseCategoryAssignee(filter)) return c.category === filter;
  return c.assignees.includes(filter as TeamMember);
}

/** Renders the category pill (optional) + one pill per assignee. */
function CommentBadges({
  category,
  assignees,
  baseClass,
}: {
  category?: PhaseType | "";
  assignees: TeamMember[];
  baseClass: string;
}) {
  if (!category && assignees.length === 0) return null;
  return (
    <span className="comment-badges">
      {category && (
        <span className={`${baseClass} is-category`}>
          <span
            className={`legend-dot phase-swatch-${category.toLowerCase()}`}
            aria-hidden
          />
          {category}
        </span>
      )}
      {assignees.map((a) => (
        <span key={a} className={baseClass}>
          {a}
        </span>
      ))}
    </span>
  );
}

// ---- Page ------------------------------------------------------------------

export default function PlaneringPage() {
  const today = useMemo(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }, []);

  const [year, setYear] = useState<number>(today.getUTCFullYear());
  const [customers, setCustomers] = useState<Record<string, CustomerData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<WeekInfo | null>(null);
  const [weekPopover, setWeekPopover] = useState<{
    week: WeekInfo;
    weekIdx: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<SelectedPhase | null>(
    null,
  );
  const [selectedProject, setSelectedProject] = useState<{
    customerSlug: string;
    projectId: string;
  } | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<CommentAssignee>("");
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<Set<ProjectStatus>>(
    () => new Set(["active"]),
  );
  const [newProjectFor, setNewProjectFor] = useState<string | null>(null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [pendingPhaseCreate, setPendingPhaseCreate] = useState<{
    customerSlug: string;
    projectId: string;
    phaseId: string;
    defaultType: PhaseType;
    defaultStart: string;
    defaultEnd: string;
  } | null>(null);

  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const bootstrappedRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const savedFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Bootstrap: load all customers full data ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const listRes = await fetch("/api/customers", { cache: "no-store" });
        const list: { customers: CustomerSummary[] } = await listRes.json();
        const all: Record<string, CustomerData> = {};
        for (const c of list.customers) {
          const res = await fetch(
            `/api/customers/${encodeURIComponent(c.slug)}`,
            { cache: "no-store" },
          );
          if (!res.ok) continue;
          const json: { slug: string; data: CustomerData } = await res.json();
          all[c.slug] = json.data;
        }
        if (!cancelled) {
          setCustomers(all);
          bootstrappedRef.current = true;
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Persistence ----
  const scheduleSave = useCallback((slug: string, data: CustomerData) => {
    const existing = saveTimers.current.get(slug);
    if (existing) clearTimeout(existing);
    setSaveStatus("saving");
    saveTimers.current.set(
      slug,
      setTimeout(async () => {
        try {
          const res = await fetch(
            `/api/customers/${encodeURIComponent(slug)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            },
          );
          if (!res.ok) {
            setSaveStatus("error");
            return;
          }
          const json: { slug: string; data: CustomerData } = await res.json();
          // Handle slug rename (when client name changes)
          if (json.slug !== slug) {
            setCustomers((prev) => {
              if (!prev[slug]) return prev;
              const next = { ...prev };
              delete next[slug];
              next[json.slug] = json.data;
              return next;
            });
            saveTimers.current.delete(slug);
            setSelectedProject((prev) =>
              prev && prev.customerSlug === slug
                ? { ...prev, customerSlug: json.slug }
                : prev,
            );
            setSelectedPhase((prev) =>
              prev && prev.customerSlug === slug
                ? { ...prev, customerSlug: json.slug }
                : prev,
            );
            setNewProjectFor((prev) => (prev === slug ? json.slug : prev));
          }
          setSaveStatus("saved");
          if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
          savedFlashRef.current = setTimeout(
            () => setSaveStatus("idle"),
            1500,
          );
        } catch (err) {
          console.error("Save failed", err);
          setSaveStatus("error");
        }
      }, 500),
    );
  }, []);

  // ---- Mutators ----
  const patchPhase = useCallback(
    (
      slug: string,
      projectId: string,
      phaseId: string,
      patch: Partial<ProjectPhase>,
    ) => {
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  phases: (p.phases ?? []).map((ph) =>
                    ph.id === phaseId ? { ...ph, ...patch } : ph,
                  ),
                }
              : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  const patchProject = useCallback(
    (slug: string, projectId: string, patch: Partial<Project>) => {
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId ? { ...p, ...patch } : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  /** Hjälpare som mutar allocations-arrayen på ett projekt och sparar. */
  const mutateAllocations = useCallback(
    (
      slug: string,
      projectId: string,
      mutator: (allocs: ProjectAllocation[]) => ProjectAllocation[],
    ) => {
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) => {
            if (p.id !== projectId) return p;
            const nextAllocs = mutator(p.allocations ?? []);
            return { ...p, allocations: nextAllocs };
          }),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  const addAllocation = useCallback(
    (slug: string, projectId: string, allocation: ProjectAllocation) => {
      mutateAllocations(slug, projectId, (allocs) => [...allocs, allocation]);
    },
    [mutateAllocations],
  );

  const patchAllocation = useCallback(
    (
      slug: string,
      projectId: string,
      allocationId: string,
      patch: Partial<ProjectAllocation>,
    ) => {
      mutateAllocations(slug, projectId, (allocs) =>
        allocs.map((a) => (a.id === allocationId ? { ...a, ...patch } : a)),
      );
    },
    [mutateAllocations],
  );

  const removeAllocation = useCallback(
    (slug: string, projectId: string, allocationId: string) => {
      mutateAllocations(slug, projectId, (allocs) =>
        allocs.filter((a) => a.id !== allocationId),
      );
    },
    [mutateAllocations],
  );

  /**
   * Save or clear a weekly note for a (project, ISO week) pair. Empty text
   * removes the note. Used by the bar hover tooltip for quick notes taken
   * during planning meetings.
   */
  const saveWeeklyNote = useCallback(
    (slug: string, projectId: string, yearWeek: string, text: string) => {
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) => {
            if (p.id !== projectId) return p;
            const existing = p.weeklyNotes ?? [];
            let nextNotes: WeeklyNote[];
            const trimmed = text.trim();
            if (trimmed === "") {
              nextNotes = existing.filter((n) => n.yearWeek !== yearWeek);
            } else {
              const has = existing.some((n) => n.yearWeek === yearWeek);
              if (has) {
                nextNotes = existing.map((n) =>
                  n.yearWeek === yearWeek
                    ? { ...n, text: trimmed, updatedAt: new Date().toISOString() }
                    : n,
                );
              } else {
                nextNotes = [...existing, newWeeklyNote(yearWeek, trimmed)];
              }
            }
            return { ...p, weeklyNotes: nextNotes };
          }),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  const patchCustomer = useCallback(
    (slug: string, patch: Partial<CustomerData>) => {
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = { ...c, ...patch };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  const deleteProject = useCallback(
    (slug: string, projectId: string) => {
      let removedName = "";
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        removedName = c.projects.find((p) => p.id === projectId)?.name ?? "";
        const next: CustomerData = {
          ...c,
          projects: c.projects.filter((p) => p.id !== projectId),
          activeProjectId:
            c.activeProjectId === projectId
              ? c.projects.find((p) => p.id !== projectId)?.id ?? null
              : c.activeProjectId,
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
      showToast(
        removedName ? `"${removedName}" borttaget` : "Projekt borttaget",
      );
    },
    [scheduleSave],
  );

  const addProjectToCustomer = useCallback(
    (slug: string, projectName: string) => {
      const trimmed = projectName.trim() || "Nytt projekt";
      const p = newProject(trimmed);
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: [...c.projects, p],
          activeProjectId: p.id,
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
      // Open the project panel so the user can immediately edit
      setSelectedProject({ customerSlug: slug, projectId: p.id });
      showToast(`Projektet "${trimmed}" skapat`);
    },
    [scheduleSave],
  );

  const addSprint = useCallback(
    (slug: string, projectId: string, type: PhaseType) => {
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const project = c.projects.find((p) => p.id === projectId);
        if (!project) return prev;

        // Default dates: chain after the latest sprint of this type.
        let startDate = "";
        let endDate = "";
        const sameType = (project.phases ?? []).filter((p) => p.type === type);
        const latestEnd = sameType
          .map((p) => p.endDate)
          .filter((d) => !!d)
          .sort()
          .pop();
        if (latestEnd) {
          startDate = addDaysToISO(latestEnd, 1);
          endDate = addDaysToISO(startDate, 6);
        } else if (project.startDate) {
          startDate = project.startDate;
          endDate = addDaysToISO(startDate, 6);
        }

        const np = newPhase(type);
        np.startDate = startDate;
        np.endDate = endDate;

        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId
              ? { ...p, phases: [...(p.phases ?? []), np] }
              : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  /** Lägg till en fas med givna datum + typ — används av QuickCreatePopover. */
  const addPhase = useCallback(
    (slug: string, projectId: string, phase: ProjectPhase) => {
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId
              ? { ...p, phases: [...(p.phases ?? []), phase] }
              : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  /** Ta bort en fas från ett projekt — används av högerklick-meny. */
  const removePhase = useCallback(
    (slug: string, projectId: string, phaseId: string) => {
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId
              ? { ...p, phases: (p.phases ?? []).filter((ph) => ph.id !== phaseId) }
              : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  const addCustomer = useCallback(async (clientName: string) => {
    const trimmed = clientName.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: trimmed }),
      });
      if (!res.ok) {
        showToast("Kunde inte skapa kund");
        return;
      }
      const json: { slug: string; data: CustomerData } = await res.json();
      setCustomers((prev) => ({ ...prev, [json.slug]: json.data }));
      showToast(`${trimmed} tillagd — välj projektnamn`);
      // Chain: open the new-project form so the customer becomes visible
      // in the timeline (otherwise they have no projects and stay hidden).
      setNewProjectFor(json.slug);
    } catch (err) {
      console.error(err);
      showToast("Kunde inte skapa kund");
    }
  }, []);

  const patchComments = useCallback(
    (
      slug: string,
      projectId: string,
      phaseId: string,
      updater: (current: PhaseComment[]) => PhaseComment[],
    ) => {
      setCustomers((prev) => {
        const c = prev[slug];
        if (!c) return prev;
        const next: CustomerData = {
          ...c,
          projects: c.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  phases: (p.phases ?? []).map((ph) =>
                    ph.id === phaseId
                      ? { ...ph, comments: updater(ph.comments ?? []) }
                      : ph,
                  ),
                }
              : p,
          ),
        };
        scheduleSave(slug, next);
        return { ...prev, [slug]: next };
      });
    },
    [scheduleSave],
  );

  // ---- Derived ----
  const weeks = useMemo(() => isoWeeksOfYear(year), [year]);
  const months = useMemo(() => monthGroups(weeks), [weeks]);
  const todayIdx = useMemo(
    () => currentWeekIndex(weeks, today),
    [weeks, today],
  );

  const allProjectRows: ProjectRow[] = useMemo(() => {
    const rows: ProjectRow[] = [];
    for (const slug of Object.keys(customers)) {
      const c = customers[slug];
      for (const p of c.projects) {
        rows.push({ customer: c.client, customerSlug: slug, project: p });
      }
    }
    rows.sort(
      (a, b) =>
        a.customer.localeCompare(b.customer, "sv") ||
        a.project.name.localeCompare(b.project.name, "sv"),
    );
    return rows;
  }, [customers]);

  const projectRows: ProjectRow[] = useMemo(() => {
    return allProjectRows.filter((r) => {
      if (customerFilter && r.customerSlug !== customerFilter) return false;
      const status = (r.project.status ?? "active") as ProjectStatus;
      if (!statusFilter.has(status)) return false;
      return true;
    });
  }, [allProjectRows, customerFilter, statusFilter]);

  // Beläggning är alltid räknad mot ALLA projekt (oavsett filter) så att
  // siffrorna stämmer även när man filtrerar till en kund. Varje allokering
  // har egna start/slutdatum frikopplade från projektets.
  const workloadByMember = useMemo(
    () => computeWeeklyBookings(weeks, allProjectRows),
    [weeks, allProjectRows],
  );

  // Aktiva projekt = de som faktiskt räknas mot beläggningen (status active).
  // Listas för inline-editorn när en personrad expanderas.
  const activeProjectRows: ProjectRow[] = useMemo(() => {
    return allProjectRows.filter(
      (r) => (r.project.status ?? "active") === "active",
    );
  }, [allProjectRows]);

  const customerOptions = useMemo(
    () =>
      Object.entries(customers)
        .map(([slug, c]) => ({ slug, name: c.client || slug }))
        .sort((a, b) => a.name.localeCompare(b.name, "sv")),
    [customers],
  );

  // Phases sorted in canonical order (Strategi → Content → Design → Utveckling)
  function sortedPhases(phases: ProjectPhase[]): ProjectPhase[] {
    return phases.slice().sort((a, b) => {
      const ai = phaseOrder.indexOf(a.type);
      const bi = phaseOrder.indexOf(b.type);
      return ai - bi;
    });
  }

  // The currently selected phase (resolved live so edits flow through)
  const selectedPhaseData = useMemo(() => {
    if (!selectedPhase) return null;
    const c = customers[selectedPhase.customerSlug];
    if (!c) return null;
    const p = c.projects.find((x) => x.id === selectedPhase.projectId);
    if (!p) return null;
    const ph = (p.phases ?? []).find((x) => x.id === selectedPhase.phaseId);
    if (!ph) return null;
    return { customer: c.client, project: p, phase: ph };
  }, [selectedPhase, customers]);

  const cssVars = {
    ["--label-w" as string]: `${LABEL_WIDTH}px`,
    ["--week-w" as string]: `${WEEK_WIDTH}px`,
    ["--phase-row-h" as string]: `${PHASE_ROW_HEIGHT}px`,
    ["--header-row-h" as string]: `${HEADER_ROW_HEIGHT}px`,
    ["--n-weeks" as string]: `${weeks.length}`,
  } as React.CSSProperties;

  return (
    <>
      <div className="page-toolbar">
        <div className="page-toolbar-inner">
          <SaveIndicator status={saveStatus} />

          <TeamAvailabilitySummary
            workloadByMember={workloadByMember}
            todayIdx={todayIdx}
            weeks={weeks}
          />

          <div className="filter-group">
            {projectStatusOrder.map((s) => {
              const on = statusFilter.has(s);
              return (
                <button
                  type="button"
                  key={s}
                  className={`filter-pill status-pill status-${s} ${
                    on ? "on" : ""
                  }`}
                  onClick={() => {
                    setStatusFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(s)) next.delete(s);
                      else next.add(s);
                      return next;
                    });
                  }}
                  aria-pressed={on}
                >
                  {projectStatusLabel[s]}
                </button>
              );
            })}
          </div>

          <FilterDropdown
            label="Kund"
            value={customerFilter}
            onChange={setCustomerFilter}
            placeholder="Alla"
            options={customerOptions.map((c) => ({
              value: c.slug,
              label: c.name,
            }))}
          />

          <FilterDropdown
            label="Visar"
            value={assigneeFilter}
            onChange={(v) => setAssigneeFilter(v as CommentAssignee)}
            placeholder="Alla"
            options={[
              ...phaseOrder.map((t) => ({
                value: t,
                label: t,
                group: "Kategori",
              })),
              ...teamMembers.map((m) => ({
                value: m,
                label: m,
                group: "Person",
              })),
            ]}
          />

          <div className="filter-pill year-pill">
            <button
              type="button"
              className="year-arrow"
              aria-label="Föregående år"
              onClick={() => setYear((y) => y - 1)}
            >
              <ChevronLeft size={14} strokeWidth={2.25} aria-hidden />
            </button>
            <span className="year-label">{year}</span>
            <button
              type="button"
              className="year-arrow"
              aria-label="Nästa år"
              onClick={() => setYear((y) => y + 1)}
            >
              <ChevronRight size={14} strokeWidth={2.25} aria-hidden />
            </button>
          </div>

          <div className="toolbar-spacer" />

          <button
            type="button"
            className="btn toolbar-btn"
            onClick={() => setNewCustomerOpen(true)}
          >
            <Plus size={14} strokeWidth={2.25} aria-hidden /> Ny kund
          </button>
        </div>
      </div>

      <div className="main planering-main">
        {loading ? (
          <div className="empty-state large">Hämtar projekt…</div>
        ) : error ? (
          <div className="empty-state large">Kunde inte hämta data: {error}</div>
        ) : projectRows.length === 0 ? (
          <div className="empty-state large">
            {customerFilter ? (
              <>
                <p>
                  {customers[customerFilter]?.client ?? "Den här kunden"} har
                  inga projekt än.
                </p>
                <div className="empty-state-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setNewProjectFor(customerFilter)}
                  >
                    <Plus size={14} strokeWidth={2.25} aria-hidden /> Skapa första projektet
                  </button>
                  <button
                    type="button"
                    className="btn btn-mute"
                    onClick={() => setCustomerFilter("")}
                  >
                    Visa alla kunder
                  </button>
                </div>
              </>
            ) : allProjectRows.length === 0 ? (
              <>
                <p>Inga kunder eller projekt än.</p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setNewCustomerOpen(true)}
                >
                  <Plus size={14} strokeWidth={2.25} aria-hidden /> Skapa första kunden
                </button>
              </>
            ) : (
              <p>Inga projekt matchar filtret.</p>
            )}
          </div>
        ) : (
          <div className="planering-scroll" style={cssVars}>
            {/* Month header */}
            <div className="planering-row planering-row-month">
              <div className="planering-row-label">
                <span className="planering-year-label">{year}</span>
              </div>
              <div className="planering-row-cells">
                {months.map((g) => (
                  <span
                    key={`m-${g.start}`}
                    className="planering-month-cell"
                    style={{ gridColumn: `${g.start + 1} / ${g.end + 2}` }}
                  >
                    {g.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Weeks header (clickable) */}
            <div className="planering-row planering-row-weeks">
              <div className="planering-row-label">
                <span className="planering-vecka-label">Vecka</span>
              </div>
              <div className="planering-row-cells">
                {weeks.map((w, i) => (
                  <button
                    type="button"
                    key={`w-${i}`}
                    className={`planering-week-cell clickable ${
                      i === todayIdx ? "current" : ""
                    } ${
                      (selectedWeek && selectedWeek.weekNum === w.weekNum) ||
                      (weekPopover && weekPopover.week.weekNum === w.weekNum)
                        ? "selected"
                        : ""
                    }`}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setWeekPopover({
                        week: w,
                        weekIdx: i,
                        anchorX: rect.left + rect.width / 2,
                        anchorY: rect.bottom + 6,
                      });
                    }}
                    aria-label={`Visa vecka ${w.weekNum}`}
                    style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: 1 }}
                  >
                    {w.weekNum}
                  </button>
                ))}
                {todayIdx >= 0 && (
                  <div
                    className="planering-today-line"
                    style={{
                      gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
                      gridRow: 1,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Project groups — varje projekt innehåller faser + allokeringar */}
            {projectRows.map((row) => (
              <ProjectGroup
                key={`${row.customerSlug}-${row.project.id}`}
                row={row}
                weeks={weeks}
                todayIdx={todayIdx}
                activeRows={activeProjectRows}
                onPatchPhase={(phaseId, patch) =>
                  patchPhase(row.customerSlug, row.project.id, phaseId, patch)
                }
                onSelectPhase={(phaseId) =>
                  setSelectedPhase({
                    customerSlug: row.customerSlug,
                    projectId: row.project.id,
                    phaseId,
                  })
                }
                onSelectProject={() =>
                  setSelectedProject({
                    customerSlug: row.customerSlug,
                    projectId: row.project.id,
                  })
                }
                onAddProject={() => setNewProjectFor(row.customerSlug)}
                onAddSprint={(type) =>
                  addSprint(row.customerSlug, row.project.id, type)
                }
                onCreatePhaseAt={(phaseId, defaultType, start) => {
                  const end = addDaysToISO(start, 6);
                  setPendingPhaseCreate({
                    customerSlug: row.customerSlug,
                    projectId: row.project.id,
                    phaseId,
                    defaultType,
                    defaultStart: start,
                    defaultEnd: end,
                  });
                }}
                onSaveWeeklyNote={(yearWeek, text) =>
                  saveWeeklyNote(
                    row.customerSlug,
                    row.project.id,
                    yearWeek,
                    text,
                  )
                }
                onAddAllocation={addAllocation}
                onPatchAllocation={patchAllocation}
                onRemoveAllocation={removeAllocation}
                onAddPhase={addPhase}
                onRemovePhase={removePhase}
                assigneeFilter={assigneeFilter}
                sortedPhases={sortedPhases}
              />
            ))}

          </div>
        )}
      </div>

      {selectedPhase && selectedPhaseData && (
        <PhaseInlinePopover
          data={selectedPhaseData}
          onClose={() => setSelectedPhase(null)}
          onPatchPhase={(patch) =>
            patchPhase(
              selectedPhase.customerSlug,
              selectedPhase.projectId,
              selectedPhase.phaseId,
              patch,
            )
          }
          onPatchComments={(updater) =>
            patchComments(
              selectedPhase.customerSlug,
              selectedPhase.projectId,
              selectedPhase.phaseId,
              updater,
            )
          }
          onRemovePhase={() => {
            removePhase(
              selectedPhase.customerSlug,
              selectedPhase.projectId,
              selectedPhase.phaseId,
            );
            setSelectedPhase(null);
          }}
        />
      )}

      {selectedProject &&
        (() => {
          const c = customers[selectedProject.customerSlug];
          const p = c?.projects.find((x) => x.id === selectedProject.projectId);
          if (!c || !p) return null;
          return (
            <ProjectPanel
              customer={c}
              customerSlug={selectedProject.customerSlug}
              project={p}
              onClose={() => setSelectedProject(null)}
              onPatchProject={(patch) =>
                patchProject(
                  selectedProject.customerSlug,
                  selectedProject.projectId,
                  patch,
                )
              }
              onPatchCustomer={(patch) =>
                patchCustomer(selectedProject.customerSlug, patch)
              }
              onDeleteProject={() => {
                if (
                  !window.confirm(
                    `Ta bort projektet "${p.name || "(utan namn)"}" permanent?`,
                  )
                )
                  return;
                deleteProject(
                  selectedProject.customerSlug,
                  selectedProject.projectId,
                );
                setSelectedProject(null);
              }}
            />
          );
        })()}

      {newProjectFor && (
        <NewProjectForm
          customerName={customers[newProjectFor]?.client ?? ""}
          onClose={() => setNewProjectFor(null)}
          onCreate={(name) => {
            addProjectToCustomer(newProjectFor, name);
            setNewProjectFor(null);
          }}
        />
      )}

      {newCustomerOpen && (
        <NewCustomerForm
          onClose={() => setNewCustomerOpen(false)}
          onCreate={async (name) => {
            await addCustomer(name);
            setNewCustomerOpen(false);
          }}
        />
      )}

      {pendingPhaseCreate && (
        <CreatePhasePopup
          defaultType={pendingPhaseCreate.defaultType}
          defaultStart={pendingPhaseCreate.defaultStart}
          defaultEnd={pendingPhaseCreate.defaultEnd}
          onClose={() => setPendingPhaseCreate(null)}
          onSubmit={(type, start, end) => {
            patchPhase(
              pendingPhaseCreate.customerSlug,
              pendingPhaseCreate.projectId,
              pendingPhaseCreate.phaseId,
              { type, startDate: start, endDate: end },
            );
            setPendingPhaseCreate(null);
          }}
        />
      )}

      {weekPopover && (
        <WeekPopover
          week={weekPopover.week}
          weekIdx={weekPopover.weekIdx}
          anchorX={weekPopover.anchorX}
          anchorY={weekPopover.anchorY}
          rows={projectRows}
          workloadByMember={workloadByMember}
          assigneeFilter={assigneeFilter}
          onClose={() => setWeekPopover(null)}
          onOpenFullPanel={() => {
            setSelectedWeek(weekPopover.week);
            setWeekPopover(null);
          }}
        />
      )}

      {selectedWeek && (
        <WeekPanel
          year={year}
          week={selectedWeek}
          rows={projectRows}
          assigneeFilter={assigneeFilter}
          onClose={() => setSelectedWeek(null)}
          onOpenPhase={(customerSlug, projectId, phaseId) => {
            setSelectedWeek(null);
            setSelectedPhase({ customerSlug, projectId, phaseId });
          }}
        />
      )}
    </>
  );
}

// ---- Legend -----------------------------------------------------------------

interface FilterOption {
  value: string;
  label: string;
  group?: string;
}

function FilterDropdown({
  label,
  value,
  onChange,
  options,
  placeholder = "Alla",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  placeholder?: string;
}) {
  // Group options by their `group` field while preserving order
  const groups = new Map<string | undefined, FilterOption[]>();
  for (const opt of options) {
    const key = opt.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(opt);
  }

  const active = value !== "";
  const selected = options.find((o) => o.value === value);
  const displayValue = selected ? selected.label : placeholder;
  return (
    <label className={`filter-pill filter-dropdown ${active ? "on" : ""}`}>
      <span className="filter-pill-label">{label}</span>
      <span className="filter-pill-value">{displayValue}</span>
      <span className="filter-pill-chevron" aria-hidden>
        <ChevronDown size={12} strokeWidth={2.25} />
      </span>
      <select
        className="filter-pill-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        <option value="">{placeholder}</option>
        {Array.from(groups.entries()).map(([groupName, opts]) =>
          groupName ? (
            <optgroup key={groupName} label={groupName}>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ),
        )}
      </select>
    </label>
  );
}

/**
 * Kompakt toolbar-widget med per-person bokade timmar för innevarande vecka.
 * Visas högst upp till vänster i toolbaren och uppdateras automatiskt
 * baserat på vilken vecka som är aktuell idag.
 */
function TeamAvailabilitySummary({
  workloadByMember,
  todayIdx,
  weeks,
}: {
  workloadByMember: Map<TeamMember, WeekBooking[]>;
  todayIdx: number;
  weeks: WeekInfo[];
}) {
  // Om dagens datum inte ligger inom det synliga året — göm widgeten
  if (todayIdx < 0 || !weeks[todayIdx]) return null;
  const currentWeek = weeks[todayIdx];
  return (
    <div className="team-summary" title="Bokade timmar denna vecka">
      <span className="team-summary-label">v{currentWeek.weekNum}</span>
      {teamMembers.map((m) => {
        const bookings = workloadByMember.get(m);
        const hours = Math.round(bookings?.[todayIdx]?.hours ?? 0);
        const isOver = hours > WEEKLY_CAPACITY;
        const isFull = hours >= WEEKLY_CAPACITY && !isOver;
        const firstName = m.split(" ")[0];
        return (
          <span
            key={`avail-${m}`}
            className={`team-summary-chip ${isOver ? "over" : isFull ? "full" : ""}`}
            title={`${m} — ${hours}h bokade v${currentWeek.weekNum}`}
          >
            <span className="team-summary-name">{firstName}</span>
            <span className="team-summary-hours">{hours}h</span>
          </span>
        );
      })}
    </div>
  );
}

function SaveIndicator({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  if (status === "idle") return null;
  const label =
    status === "saving" ? "Sparar"
      : status === "saved" ? "Sparat"
        : "Sparafel";
  return (
    <span className={`save-indicator status-${status}`} aria-live="polite">
      <span className="save-dot" />
      {label}
    </span>
  );
}

function PhaseLegend() {
  return (
    <div className="phase-legend">
      {phaseOrder.map((t) => (
        <span key={t} className="legend-item">
          <span
            className={`legend-dot phase-swatch-${t.toLowerCase()}`}
            aria-hidden
          />
          <span className="legend-label">{t}</span>
        </span>
      ))}
    </div>
  );
}

// ---- Project group ---------------------------------------------------------

function ProjectGroup({
  row,
  weeks,
  todayIdx,
  activeRows,
  onPatchPhase,
  onSelectPhase,
  onSelectProject,
  onAddProject,
  onAddSprint,
  onCreatePhaseAt,
  onSaveWeeklyNote,
  onAddAllocation,
  onPatchAllocation,
  onRemoveAllocation,
  onAddPhase,
  onRemovePhase,
  assigneeFilter,
  sortedPhases,
}: {
  row: ProjectRow;
  weeks: WeekInfo[];
  todayIdx: number;
  activeRows: ProjectRow[];
  onPatchPhase: (phaseId: string, patch: Partial<ProjectPhase>) => void;
  onSelectPhase: (phaseId: string) => void;
  onSelectProject: () => void;
  onAddProject: () => void;
  onAddSprint: (type: PhaseType) => void;
  onCreatePhaseAt: (phaseId: string, defaultType: PhaseType, startISO: string) => void;
  onSaveWeeklyNote: (yearWeek: string, text: string) => void;
  onAddAllocation: (slug: string, projectId: string, allocation: ProjectAllocation) => void;
  onPatchAllocation: (
    slug: string,
    projectId: string,
    allocationId: string,
    patch: Partial<ProjectAllocation>,
  ) => void;
  onRemoveAllocation: (slug: string, projectId: string, allocationId: string) => void;
  onAddPhase: (slug: string, projectId: string, phase: ProjectPhase) => void;
  onRemovePhase: (slug: string, projectId: string, phaseId: string) => void;
  assigneeFilter: CommentAssignee;
  sortedPhases: (phases: ProjectPhase[]) => ProjectPhase[];
}) {
  const phases = sortedPhases(row.project.phases ?? []);
  const allocations = row.project.allocations ?? [];
  const [editingAllocation, setEditingAllocation] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Quick-create-popover: när användaren klickar på en empty vecka i en fas-rad
  // öppnas en liten popup med fas-typ-chips. Position ankras till klick-punkten.
  // Hover-affordance ("+") finns lokalt i varje PhaseTimelineRow.
  const [createPopover, setCreatePopover] = useState<{
    weekIdx: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);

  function handleCreatePhase(type: PhaseType, weekIdx: number) {
    const startISO = weeks[weekIdx].monday.toISOString().slice(0, 10);
    const endISO = weeks[weekIdx].sunday.toISOString().slice(0, 10);
    const np = newPhase(type);
    np.startDate = startISO;
    np.endDate = endISO;
    onAddPhase(row.customerSlug, row.project.id, np);
    setCreatePopover(null);
  }

  // Default-datum för nya allokeringar: projektets datum, annars idag→år-slut
  function defaultAllocDates(): { startDate: string; endDate: string } {
    if (row.project.startDate && row.project.endDate) {
      return {
        startDate: row.project.startDate,
        endDate: row.project.endDate,
      };
    }
    const today = new Date().toISOString().slice(0, 10);
    const yearEnd = new Date(weeks[weeks.length - 1].sunday)
      .toISOString()
      .slice(0, 10);
    return {
      startDate: row.project.startDate || today,
      endDate: row.project.endDate || yearEnd,
    };
  }

  function handleAddPerson() {
    // Hitta första medlem som inte redan har allokering här — annars första
    const allocated = new Set(allocations.map((a) => a.member));
    const member =
      teamMembers.find((m) => !allocated.has(m)) ?? teamMembers[0];
    const { startDate, endDate } = defaultAllocDates();
    const allocation = newAllocation(member, startDate, endDate, 0);
    onAddAllocation(row.customerSlug, row.project.id, allocation);
    setEditingAllocation(allocation.id);
  }
  return (
    <>
      <div
        className={`planering-row planering-row-project-header ${
          collapsed ? "collapsed" : ""
        }`}
      >
        <div className="planering-row-label project-header-label">
          <button
            type="button"
            className="project-header-collapse"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Visa projektets innehåll" : "Dölj projektets innehåll"}
            title={collapsed ? "Visa allt" : "Dölj"}
          >
            <ChevronDown
              size={12}
              strokeWidth={2.25}
              style={{
                transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                transition: "transform var(--t-fast)",
              }}
              aria-hidden
            />
          </button>
          <button
            type="button"
            className="project-header-link"
            onClick={onSelectProject}
          >
            <span className="row-customer">{row.customer}</span>
            <span className="row-project">
              {row.project.name || "(utan namn)"}
              {row.project.status && row.project.status !== "active" && (
                <span
                  className={`project-status-pill status-${row.project.status}`}
                >
                  {projectStatusLabel[row.project.status]}
                </span>
              )}
            </span>
          </button>
          <button
            type="button"
            className="project-header-add"
            onClick={onAddProject}
            title={`Lägg till nytt projekt under ${row.customer}`}
            aria-label="Nytt projekt"
          >
            <Plus size={14} strokeWidth={2.25} aria-hidden />
          </button>
        </div>
        <div className="planering-row-cells project-header-cells">
          {todayIdx >= 0 && (
            <div
              className="planering-today-line"
              style={{
                gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
                gridRow: 1,
              }}
            />
          )}
        </div>
      </div>

      {createPopover && (
        <QuickCreatePopover
          weekIdx={createPopover.weekIdx}
          week={weeks[createPopover.weekIdx]}
          anchorX={createPopover.anchorX}
          anchorY={createPopover.anchorY}
          onClose={() => setCreatePopover(null)}
          onCreatePhase={(type) =>
            handleCreatePhase(type, createPopover.weekIdx)
          }
        />
      )}
      {!collapsed && (phases.length === 0 ? (
        <div className="planering-row planering-row-phase planering-row-empty">
          <div className="planering-row-label">
            <button
              type="button"
              className="phase-empty-hint-btn"
              onClick={onSelectProject}
            >
              Inga faser. Klicka för att lägga till.
            </button>
          </div>
          <div className="planering-row-cells">
            {todayIdx >= 0 && (
              <div
                className="planering-today-line"
                style={{
                  gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
                  gridRow: 1,
                }}
              />
            )}
          </div>
        </div>
      ) : (
        phases.map((phase) => (
          <PhaseTimelineRow
            key={phase.id}
            phase={phase}
            weeks={weeks}
            todayIdx={todayIdx}
            weeklyNotes={row.project.weeklyNotes ?? []}
            onPatch={(patch) => onPatchPhase(phase.id, patch)}
            onSelect={() => onSelectPhase(phase.id)}
            onAddSprint={() => onAddSprint(phase.type)}
            onCreateAt={(start) => onCreatePhaseAt(phase.id, phase.type, start)}
            onSaveWeeklyNote={onSaveWeeklyNote}
            assigneeFilter={assigneeFilter}
            onOpenCreatePopover={(weekIdx, anchorX, anchorY) =>
              setCreatePopover({ weekIdx, anchorX, anchorY })
            }
            onRemovePhase={() =>
              onRemovePhase(row.customerSlug, row.project.id, phase.id)
            }
          />
        ))
      ))}

      {/* Allokeringar — en rad per person på projektet, med dragbar stapel. */}
      {!collapsed && allocations
        .slice()
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .map((allocation) => {
          const ma: MemberAlloc = {
            customer: row.customer,
            customerSlug: row.customerSlug,
            project: row.project,
            allocation,
          };
          const isEditing = editingAllocation === allocation.id;
          return (
            <TeamAllocRow
              key={`alloc-${allocation.id}`}
              ma={ma}
              weeks={weeks}
              todayIdx={todayIdx}
              isEditing={isEditing}
              onOpenEdit={() => setEditingAllocation(allocation.id)}
              onCloseEdit={() => setEditingAllocation(null)}
              onPatch={(patch) =>
                onPatchAllocation(
                  row.customerSlug,
                  row.project.id,
                  allocation.id,
                  patch,
                )
              }
              onRemove={() => {
                onRemoveAllocation(
                  row.customerSlug,
                  row.project.id,
                  allocation.id,
                );
                setEditingAllocation(null);
              }}
              activeRows={activeRows}
            />
          );
        })}

      {/* Klickbar rad för att lägga till en person på projektet. */}
      {!collapsed && (
        <div className="planering-row planering-row-add-person">
          <button
            type="button"
            className="planering-row-label add-person-btn"
            onClick={handleAddPerson}
          >
            <Plus size={11} strokeWidth={2.25} aria-hidden />
            <span>Lägg till person</span>
          </button>
          <div className="planering-row-cells add-person-cells">
            {todayIdx >= 0 && (
              <div
                className="planering-today-line"
                style={{
                  gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
                  gridRow: 1,
                }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---- Quick-create popover --------------------------------------------------

/**
 * Liten popover som öppnas vid klick på en tom cell i project-header.
 * Visar fas-typ-chips inline så användaren slipper öppna ProjectPanel
 * för att skapa en fas. Ankrar till klickpositionen med smart flip.
 */
function QuickCreatePopover({
  weekIdx,
  week,
  anchorX,
  anchorY,
  onClose,
  onCreatePhase,
}: {
  weekIdx: number;
  week: WeekInfo;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
  onCreatePhase: (type: PhaseType) => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const popoverWidth = 260;
  const margin = 12;
  const maxLeft =
    typeof window !== "undefined"
      ? window.innerWidth - popoverWidth - margin
      : 0;
  const left = Math.max(margin, Math.min(anchorX - popoverWidth / 2, maxLeft));
  const popoverHeight = 200;
  const flipUp =
    typeof window !== "undefined" &&
    anchorY + popoverHeight > window.innerHeight - margin;
  const top = flipUp ? anchorY - popoverHeight - 24 : anchorY;

  // Ohanterad parameter, men finns för framtida actions (allokering med datum)
  void weekIdx;

  return (
    <>
      <div className="quick-popover-backdrop" onClick={onClose} />
      <div
        className="quick-popover"
        style={{ top, left, width: popoverWidth }}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="quick-popover-header">
          <div className="quick-popover-title">Skapa fas</div>
          <div className="quick-popover-sub">
            startar v{week.weekNum} · {fmtDay(week.monday)}
          </div>
        </div>
        <div className="quick-popover-chips">
          {phaseOrder.map((t) => (
            <button
              key={t}
              type="button"
              className={`quick-popover-chip phase-swatch-${t.toLowerCase()}`}
              onClick={() => onCreatePhase(t)}
            >
              <Plus size={11} strokeWidth={2.25} aria-hidden />
              <span>{t}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ---- New project / new customer mini-forms ---------------------------------

function NewProjectForm({
  customerName,
  onClose,
  onCreate,
}: {
  customerName: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-form"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-form-title">
          Nytt projekt under {customerName}
        </div>
        <input
          ref={inputRef}
          type="text"
          className="panel-text-input"
          placeholder="Projektnamn"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              e.preventDefault();
              onCreate(name);
            }
          }}
        />
        <div className="modal-form-actions">
          <button
            type="button"
            className="btn"
            onClick={() => onCreate(name)}
            disabled={!name.trim()}
          >
            Skapa
          </button>
          <button type="button" className="btn btn-mute" onClick={onClose}>
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}

function CreatePhasePopup({
  defaultType,
  defaultStart,
  defaultEnd,
  onClose,
  onSubmit,
}: {
  defaultType: PhaseType;
  defaultStart: string;
  defaultEnd: string;
  onClose: () => void;
  onSubmit: (type: PhaseType, start: string, end: string) => void;
}) {
  const [type, setType] = useState<PhaseType>(defaultType);
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    if (!start || !end) return;
    onSubmit(type, start, end);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-form create-phase-form"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-form-title">Ny fas</div>
        <label className="meta-label">Kategori</label>
        <select
          className="panel-text-input"
          value={type}
          onChange={(e) => setType(e.target.value as PhaseType)}
        >
          {phaseOrder.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="create-phase-dates">
          <div>
            <label className="meta-label">Startdatum</label>
            <DatePicker
              value={start}
              onChange={(v) => {
                setStart(v);
                if (v && end && v > end) setEnd(v);
              }}
              ariaLabel="Startdatum"
            />
          </div>
          <div>
            <label className="meta-label">Slutdatum</label>
            <DatePicker
              value={end}
              onChange={(v) => {
                setEnd(v);
                if (v && start && v < start) setStart(v);
              }}
              ariaLabel="Slutdatum"
            />
          </div>
        </div>
        <div className="modal-form-actions">
          <button
            type="button"
            className="btn"
            onClick={submit}
            disabled={!start || !end}
          >
            Skapa
          </button>
          <button type="button" className="btn btn-mute" onClick={onClose}>
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}

function NewCustomerForm({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  async function submit() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    await onCreate(name);
    setSubmitting(false);
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-form"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-form-title">Ny kund</div>
        <input
          ref={inputRef}
          type="text"
          className="panel-text-input"
          placeholder="Kundens namn"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="modal-form-actions">
          <button
            type="button"
            className="btn"
            onClick={submit}
            disabled={!name.trim() || submitting}
          >
            {submitting ? "Skapar…" : "Skapa"}
          </button>
          <button type="button" className="btn btn-mute" onClick={onClose}>
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Phase row with drag ---------------------------------------------------

interface DragState {
  startX: number;
  startStartDate: string;
  startEndDate: string;
  mode: "move" | "resize-left" | "resize-right";
  moved: boolean;
}

function PhaseTimelineRow({
  phase,
  weeks,
  todayIdx,
  weeklyNotes,
  onPatch,
  onSelect,
  onAddSprint,
  onCreateAt,
  onSaveWeeklyNote,
  assigneeFilter,
  onOpenCreatePopover,
  onRemovePhase,
}: {
  phase: ProjectPhase;
  weeks: WeekInfo[];
  todayIdx: number;
  weeklyNotes: WeeklyNote[];
  onPatch: (patch: Partial<ProjectPhase>) => void;
  onSelect: () => void;
  onAddSprint: () => void;
  onCreateAt: (startISO: string) => void;
  onSaveWeeklyNote: (yearWeek: string, text: string) => void;
  assigneeFilter: CommentAssignee;
  onOpenCreatePopover: (weekIdx: number, anchorX: number, anchorY: number) => void;
  onRemovePhase: () => void;
}) {
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [hoveredWeekIdx, setHoveredWeekIdx] = useState<number | null>(null);
  const [hoveredCreateWeek, setHoveredCreateWeek] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const hoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stäng kontextmenyn vid Esc eller klick utanför
  useEffect(() => {
    if (!contextMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    function onDocClick() {
      setContextMenu(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick);
    };
  }, [contextMenu]);

  const effectiveStart = preview?.startDate ?? phase.startDate;
  const effectiveEnd = preview?.endDate ?? phase.endDate;

  const start = parseISODate(effectiveStart);
  const end = parseISODate(effectiveEnd);
  const range = start && end ? dateRangeToWeeks(weeks, start, end) : null;

  const dimmed = !!assigneeFilter &&
    !(phase.comments ?? []).some((c) => commentMatchesFilter(c, assigneeFilter));

  function pixelsToDays(px: number): number {
    return Math.round(px / (WEEK_WIDTH / 7));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Endast vänster musknapp triggar drag/select. Höger musknapp lämnas
    // åt onContextMenu så kontextmenyn kan öppnas utan att stapeln också
    // tolkar det som ett klick.
    if (e.button !== 0) return;
    if (!phase.startDate || !phase.endDate) {
      // No range yet; treat as click → open panel for manual edit
      onSelect();
      return;
    }
    const target = e.target as HTMLElement;
    let mode: DragState["mode"] = "move";
    if (target.classList.contains("phase-resize-left")) mode = "resize-left";
    else if (target.classList.contains("phase-resize-right"))
      mode = "resize-right";
    dragRef.current = {
      startX: e.clientX,
      startStartDate: phase.startDate,
      startEndDate: phase.endDate,
      mode,
      moved: false,
    };
    setPreview({ startDate: phase.startDate, endDate: phase.endDate });
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > DRAG_THRESHOLD) d.moved = true;
    if (!d.moved) return;
    const dayDelta = pixelsToDays(dx);
    let newStart = d.startStartDate;
    let newEnd = d.startEndDate;
    if (d.mode === "move") {
      newStart = addDaysToISO(d.startStartDate, dayDelta);
      newEnd = addDaysToISO(d.startEndDate, dayDelta);
    } else if (d.mode === "resize-left") {
      newStart = addDaysToISO(d.startStartDate, dayDelta);
      if (newStart > newEnd) newStart = newEnd;
    } else if (d.mode === "resize-right") {
      newEnd = addDaysToISO(d.startEndDate, dayDelta);
      if (newEnd < newStart) newEnd = newStart;
    }
    setPreview({ startDate: newStart, endDate: newEnd });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    if (d.moved && preview) {
      onPatch({ startDate: preview.startDate, endDate: preview.endDate });
    } else {
      // Treat as click
      onSelect();
    }
    dragRef.current = null;
    setPreview(null);
  }

  function onPointerCancel() {
    dragRef.current = null;
    setPreview(null);
  }

  const previewDateLabel = preview
    ? formatPanelDateRange(preview.startDate, preview.endDate)
    : "";

  return (
    <div
      className={`planering-row planering-row-phase ${dimmed ? "dimmed" : ""}`}
    >
      <div className="planering-row-label phase-row-label">
        <span className="phase-row-type">{phase.type}</span>
        <button
          type="button"
          className="phase-row-add"
          onClick={(e) => {
            e.stopPropagation();
            onAddSprint();
          }}
          title={`Lägg till en ${phase.type}-sprint till`}
          aria-label={`Lägg till ny ${phase.type}-sprint`}
        >
          <Plus size={12} strokeWidth={2.25} aria-hidden />
        </button>
      </div>
      <div
        className="planering-row-cells phase-row-cells phase-row-cells-hoverable"
        onMouseMove={(e) => {
          // Visa + endast när cursoren är över EMPTY area (inte över barren)
          if (e.target !== e.currentTarget) {
            setHoveredCreateWeek(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const idx = Math.floor(x / WEEK_WIDTH);
          if (idx >= 0 && idx < weeks.length) {
            setHoveredCreateWeek(idx);
          } else {
            setHoveredCreateWeek(null);
          }
        }}
        onMouseLeave={() => setHoveredCreateWeek(null)}
        onClick={(e) => {
          // Klick på empty area (inte på bar) → öppna create-popover
          if (e.target !== e.currentTarget) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const idx = Math.floor(x / WEEK_WIDTH);
          if (idx < 0 || idx >= weeks.length) return;
          onOpenCreatePopover(idx, e.clientX, e.clientY + 12);
        }}
      >
        {todayIdx >= 0 && (
          <div
            className="planering-today-line"
            style={{
              gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
              gridRow: 1,
            }}
          />
        )}

        {hoveredCreateWeek !== null && (
          <div
            className="cell-create-plus"
            style={{
              gridColumn: `${hoveredCreateWeek + 1} / ${hoveredCreateWeek + 2}`,
              gridRow: 1,
            }}
            aria-hidden
          >
            <Plus size={11} strokeWidth={2.5} />
          </div>
        )}

        {range ? (
          <div
            className={`phase-bar-wrapper phase-${phase.type.toLowerCase()}`}
            style={{
              gridColumn: `${range.startIdx + 1} / ${range.endIdx + 2}`,
              gridRow: 1,
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY });
            }}
            onPointerDown={onPointerDown}
            onPointerMove={(e) => {
              onPointerMove(e);
              // Track which week the cursor is inside (within the bar) so
              // the hover tooltip can offer to take a note for that week.
              if (range) {
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = e.clientX - rect.left;
                const wInBar = Math.max(
                  0,
                  Math.floor(relX / WEEK_WIDTH),
                );
                const abs = Math.min(
                  weeks.length - 1,
                  Math.max(0, range.startIdx + wInBar),
                );
                setHoveredWeekIdx(abs);
              }
            }}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onMouseEnter={() => {
              if (hoverHideTimerRef.current) {
                clearTimeout(hoverHideTimerRef.current);
                hoverHideTimerRef.current = null;
              }
              setHovered(true);
            }}
            onMouseLeave={() => {
              // Small delay so the cursor can move from bar to tooltip
              // (which lives above with an 8px gap) without flicker.
              hoverHideTimerRef.current = setTimeout(() => {
                setHovered(false);
                setHoveredWeekIdx(null);
              }, 140);
            }}
          >
            <div className="phase-resize-left" aria-hidden />
            <div className="phase-bar-body" />
            <div className="phase-resize-right" aria-hidden />
            {preview && (
              <div className="phase-preview-label">{previewDateLabel}</div>
            )}
            {hovered && !preview && (
              <PhaseHoverTooltip
                phase={phase}
                weeks={weeks}
                hoveredWeekIdx={hoveredWeekIdx ?? range.startIdx}
                weeklyNotes={weeklyNotes}
                onSaveWeeklyNote={onSaveWeeklyNote}
                onTooltipEnter={() => {
                  if (hoverHideTimerRef.current) {
                    clearTimeout(hoverHideTimerRef.current);
                    hoverHideTimerRef.current = null;
                  }
                  setHovered(true);
                }}
                onTooltipLeave={() => {
                  hoverHideTimerRef.current = setTimeout(() => {
                    setHovered(false);
                    setHoveredWeekIdx(null);
                  }, 140);
                }}
              />
            )}
          </div>
        ) : (
          <button
            type="button"
            className="phase-empty-track"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const px = e.clientX - rect.left;
              const dayPx = WEEK_WIDTH / 7;
              const dayIdx = Math.max(0, Math.floor(px / dayPx));
              const start = addDaysToISO(
                weeks[0]?.monday.toISOString().slice(0, 10) ?? "",
                dayIdx,
              );
              onCreateAt(start);
            }}
            style={{ gridColumn: `1 / ${weeks.length + 1}`, gridRow: 1 }}
            aria-label="Klicka för att lägga till fas vid datum"
          />
        )}
      </div>

      {contextMenu && (
        <div
          className="phase-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="phase-context-item"
            onClick={() => {
              onSelect();
              setContextMenu(null);
            }}
          >
            Öppna fas
          </button>
          <button
            type="button"
            className="phase-context-item danger"
            onClick={() => {
              onRemovePhase();
              setContextMenu(null);
            }}
          >
            Ta bort fas
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Phase hover tooltip ---------------------------------------------------

function PhaseHoverTooltip({
  phase,
  weeks,
  hoveredWeekIdx,
  weeklyNotes,
  onSaveWeeklyNote,
  onTooltipEnter,
  onTooltipLeave,
}: {
  phase: ProjectPhase;
  weeks: WeekInfo[];
  hoveredWeekIdx: number;
  weeklyNotes: WeeklyNote[];
  onSaveWeeklyNote: (yearWeek: string, text: string) => void;
  onTooltipEnter: () => void;
  onTooltipLeave: () => void;
}) {
  const comments = phase.comments ?? [];
  const range = formatPanelDateRange(phase.startDate, phase.endDate);

  const week = weeks[hoveredWeekIdx];
  const yearWeek = week ? isoWeekString(week.monday) : "";
  const existingNote = yearWeek
    ? weeklyNotes.find((n) => n.yearWeek === yearWeek)
    : undefined;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(existingNote?.text ?? "");
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // Flip tooltip below the bar when det inte finns plats ovanför.
  // Mäter parent-rect (fas-stapelns position) och checkar mot sticky-headers
  // + viewport-top. Om för litet utrymme uppåt — vänd nedåt.
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [flipBelow, setFlipBelow] = useState(false);
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const tooltipHeight = el.offsetHeight;
    // ~120px täcker toolbar (57) + sticky månads/vecko-headers (64).
    const minTopSpace = 120;
    setFlipBelow(parentRect.top - tooltipHeight - 12 < minTopSpace);
  }, [hoveredWeekIdx, phase.comments?.length, existingNote?.text]);

  // Reset the editing draft when the hovered week changes (so we don't
  // accidentally save a draft against the wrong week).
  useEffect(() => {
    setDraft(existingNote?.text ?? "");
    setEditing(false);
  }, [yearWeek, existingNote?.id, existingNote?.text]);

  // Focus the textarea right after it appears.
  useEffect(() => {
    if (editing && textRef.current) {
      textRef.current.focus();
      const len = textRef.current.value.length;
      textRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  function commit() {
    if (!yearWeek) {
      setEditing(false);
      return;
    }
    const next = draft.trim();
    const current = existingNote?.text ?? "";
    if (next !== current) {
      onSaveWeeklyNote(yearWeek, next);
    }
    setEditing(false);
  }

  const doneCount = comments.filter((c) => c.done).length;

  // Vilka personer är tilldelade någon uppgift i fasen — sammanställning
  const assigneeSet = new Set<TeamMember>();
  for (const c of comments) {
    for (const a of c.assignees) assigneeSet.add(a);
  }
  const assigneeList = Array.from(assigneeSet);

  return (
    <div
      ref={tooltipRef}
      className={`phase-hover-tooltip ${flipBelow ? "below" : ""}`}
      role="tooltip"
      onMouseEnter={onTooltipEnter}
      onMouseLeave={onTooltipLeave}
    >
      <div className="phase-hover-header">
        <span
          className={`legend-dot phase-swatch-${phase.type.toLowerCase()}`}
          aria-hidden
        />
        <span className="phase-hover-type">{phase.type}</span>
        {range && <span className="phase-hover-range">{range}</span>}
      </div>

      {/* Sammanställd stat-rad: uppgiftsstatus + tilldelade personer.
          Detta är ett snabbt 1-line-utdrag av vad som händer i fasen, så
          användaren får värde av hovern utan att behöva klicka. */}
      <div className="phase-hover-stats">
        {comments.length === 0 ? (
          <span className="phase-hover-stat-empty">Inga uppgifter än</span>
        ) : (
          <span className="phase-hover-stat-count">
            <span className="phase-hover-stat-num">{doneCount}</span>
            <span className="phase-hover-stat-sep">/</span>
            <span className="phase-hover-stat-num">{comments.length}</span>
            <span className="phase-hover-stat-label">
              {comments.length === 1 ? "uppgift klar" : "uppgifter klara"}
            </span>
          </span>
        )}
        {assigneeList.length > 0 && (
          <span className="phase-hover-stat-assignees">
            {assigneeList.slice(0, 3).map((m) => m.split(" ")[0]).join(", ")}
            {assigneeList.length > 3 && ` +${assigneeList.length - 3}`}
          </span>
        )}
      </div>

      {week && (
        <div className="phase-hover-weeknote">
          <div className="phase-hover-weeknote-head">
            <span className="phase-hover-weeknote-label">Vecka {week.weekNum}</span>
            {!editing && (
              <button
                type="button"
                className="phase-hover-weeknote-btn"
                onClick={() => setEditing(true)}
                title={existingNote ? "Redigera veckonotering" : "Lägg till veckonotering"}
                aria-label={existingNote ? "Redigera veckonotering" : "Lägg till veckonotering"}
              >
                {existingNote ? (
                  <Pencil size={12} strokeWidth={2.25} aria-hidden />
                ) : (
                  <Plus size={12} strokeWidth={2.25} aria-hidden />
                )}
              </button>
            )}
          </div>
          {editing ? (
            <textarea
              ref={textRef}
              className="phase-hover-weeknote-input"
              value={draft}
              rows={2}
              placeholder="Skriv en notering för veckan…"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(existingNote?.text ?? "");
                  setEditing(false);
                }
              }}
            />
          ) : existingNote ? (
            <p className="phase-hover-weeknote-text">{existingNote.text}</p>
          ) : (
            <p className="phase-hover-weeknote-empty">Ingen notering än.</p>
          )}
        </div>
      )}

      {comments.length > 0 && (
        <ul className="phase-hover-list">
          {comments.slice(0, 4).map((c) => (
            <li
              key={c.id}
              className={`phase-hover-item ${c.done ? "done" : ""}`}
            >
              <span className="phase-hover-check" aria-hidden>
                {c.done ? (
                  <Check size={12} strokeWidth={2.5} />
                ) : (
                  <Circle size={12} strokeWidth={1.75} />
                )}
              </span>
              <div className="phase-hover-body">
                <span className="phase-hover-text">{c.text}</span>
                <CommentBadges
                  category={c.category}
                  assignees={c.assignees}
                  baseClass="phase-hover-assignee"
                />
              </div>
            </li>
          ))}
          {comments.length > 4 && (
            <li className="phase-hover-item-overflow">
              +{comments.length - 4} {comments.length - 4 === 1 ? "uppgift till" : "uppgifter till"}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ---- Phase panel (comments editor) -----------------------------------------

/**
 * Inline popover som ersätter PhasePanel (stor slide-in från höger).
 * Centrerad i viewporten, ~440px bred — håller hela fas-redigeringen
 * (datum, kommentarer/uppgifter, delete) inline utan att rycka användaren
 * ur arbetsytan. Samma mönster som AllocPopover.
 */
function PhaseInlinePopover({
  data,
  onClose,
  onPatchPhase,
  onPatchComments,
  onRemovePhase,
}: {
  data: { customer: string; project: Project; phase: ProjectPhase };
  onClose: () => void;
  onPatchPhase: (patch: Partial<ProjectPhase>) => void;
  onPatchComments: (
    updater: (current: PhaseComment[]) => PhaseComment[],
  ) => void;
  onRemovePhase: () => void;
}) {
  const { customer, project, phase } = data;
  const [draftText, setDraftText] = useState("");
  const [draftCategory, setDraftCategory] = useState<PhaseType | "">(
    phase.type,
  );
  const [draftAssignees, setDraftAssignees] = useState<TeamMember[]>([]);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraftCategory(phase.type);
  }, [phase.id, phase.type]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleDraftAssignee(m: TeamMember) {
    setDraftAssignees((prev) =>
      prev.includes(m) ? prev.filter((p) => p !== m) : [...prev, m],
    );
  }

  function addComment() {
    if (!draftText.trim()) return;
    onPatchComments((current) => [
      ...current,
      {
        ...newComment(),
        text: draftText.trim(),
        category: draftCategory,
        assignees: draftAssignees,
      },
    ]);
    setDraftText("");
    setDraftCategory(phase.type);
    setDraftAssignees([]);
    textRef.current?.focus();
  }

  function updateComment(id: string, patch: Partial<PhaseComment>) {
    onPatchComments((current) =>
      current.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }

  function removeComment(id: string) {
    onPatchComments((current) => current.filter((c) => c.id !== id));
  }

  const comments = phase.comments ?? [];

  return (
    <>
      <div className="alloc-popover-backdrop" onClick={onClose} />
      <div
        className="phase-inline-popover"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="phase-inline-header">
          <div className="phase-inline-titlewrap">
            <div className="phase-inline-eyebrow">
              <span
                className={`legend-dot phase-swatch-${phase.type.toLowerCase()}`}
                aria-hidden
              />
              <span>{phase.type}</span>
            </div>
            <div className="phase-inline-title">
              {customer} · {project.name || "(utan namn)"}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Stäng"
          >
            <X size={14} strokeWidth={2.25} aria-hidden />
          </button>
        </div>

        <div className="phase-inline-dates">
          <DatePicker
            value={phase.startDate}
            onChange={(v) => {
              const patch: Partial<ProjectPhase> = { startDate: v };
              if (v && phase.endDate && v > phase.endDate) patch.endDate = v;
              onPatchPhase(patch);
            }}
            ariaLabel="Fasens startdatum"
            placeholder="Start"
            size="compact"
          />
          <span className="phase-inline-dash" aria-hidden>–</span>
          <DatePicker
            value={phase.endDate}
            onChange={(v) => {
              const patch: Partial<ProjectPhase> = { endDate: v };
              if (v && phase.startDate && v < phase.startDate)
                patch.startDate = v;
              onPatchPhase(patch);
            }}
            ariaLabel="Fasens slutdatum"
            placeholder="Slut"
            size="compact"
          />
        </div>

        <div className="phase-inline-body">
          {comments.length === 0 ? (
            <p className="phase-inline-empty">
              Inga uppgifter än. Skriv den första nedan.
            </p>
          ) : (
            <ul className="phase-inline-comments">
              {comments.map((c) => (
                <li
                  key={c.id}
                  className={`phase-inline-comment ${c.done ? "done" : ""}`}
                >
                  <button
                    type="button"
                    className="checkbox"
                    onClick={() => updateComment(c.id, { done: !c.done })}
                    aria-pressed={c.done}
                    aria-label={c.done ? "Avmarkera" : "Markera klar"}
                  >
                    {c.done && (
                      <Check size={12} strokeWidth={2.75} aria-hidden />
                    )}
                  </button>
                  <input
                    type="text"
                    className="phase-inline-comment-text"
                    value={c.text}
                    onChange={(e) =>
                      updateComment(c.id, { text: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => removeComment(c.id)}
                    aria-label="Ta bort uppgift"
                  >
                    <X size={12} strokeWidth={2.25} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="phase-inline-add">
          <textarea
            ref={textRef}
            rows={1}
            className="phase-inline-add-input"
            placeholder="Lägg till uppgift… (Enter för att lägga till)"
            value={draftText}
            onChange={(e) => {
              setDraftText(e.target.value);
              autoGrowComment(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addComment();
              }
            }}
          />
          {draftText.trim() && (
            <div className="phase-inline-add-meta">
              <div
                className="assignee-chips"
                role="group"
                aria-label="Tilldelade"
              >
                {teamMembers.map((m) => {
                  const on = draftAssignees.includes(m);
                  return (
                    <button
                      type="button"
                      key={m}
                      className={`assignee-chip ${on ? "on" : ""}`}
                      onClick={() => toggleDraftAssignee(m)}
                      aria-pressed={on}
                    >
                      {m.split(" ")[0]}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="btn small"
                onClick={addComment}
                disabled={!draftText.trim()}
              >
                Lägg till
              </button>
            </div>
          )}
        </div>

        <div className="phase-inline-footer">
          <button
            type="button"
            className="btn btn-mute danger small"
            onClick={() => {
              onRemovePhase();
              onClose();
            }}
          >
            Ta bort fas
          </button>
          <button type="button" className="btn small" onClick={onClose}>
            Klar
          </button>
        </div>
      </div>
    </>
  );
}

function PhasePanel({
  data,
  onClose,
  onPatchPhase,
  onPatchComments,
  onOpenProject,
}: {
  data: { customer: string; project: Project; phase: ProjectPhase };
  onClose: () => void;
  onPatchPhase: (patch: Partial<ProjectPhase>) => void;
  onPatchComments: (
    updater: (current: PhaseComment[]) => PhaseComment[],
  ) => void;
  onOpenProject: () => void;
}) {
  const { customer, project, phase } = data;
  const [draftText, setDraftText] = useState("");
  const [draftCategory, setDraftCategory] = useState<PhaseType | "">(
    phase.type,
  );
  const [draftAssignees, setDraftAssignees] = useState<TeamMember[]>([]);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // When the user switches between phases, reset the draft category to the
  // new phase's type so it stays in sync with the overview header.
  useEffect(() => {
    setDraftCategory(phase.type);
  }, [phase.id, phase.type]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleDraftAssignee(m: TeamMember) {
    setDraftAssignees((prev) =>
      prev.includes(m) ? prev.filter((p) => p !== m) : [...prev, m],
    );
  }

  function addComment() {
    if (!draftText.trim()) return;
    onPatchComments((current) => [
      ...current,
      {
        ...newComment(),
        text: draftText.trim(),
        category: draftCategory,
        assignees: draftAssignees,
      },
    ]);
    setDraftText("");
    setDraftCategory(phase.type);
    setDraftAssignees([]);
    textRef.current?.focus();
  }

  function updateComment(id: string, patch: Partial<PhaseComment>) {
    onPatchComments((current) =>
      current.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }

  function removeComment(id: string) {
    onPatchComments((current) => current.filter((c) => c.id !== id));
  }

  const comments = phase.comments ?? [];

  return (
    <div
      className="week-panel-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${phase.type} – kommentarer`}
    >
      <aside
        className="week-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="week-panel-header">
          <div>
            <div className="phase-panel-eyebrow">
              <span
                className={`legend-dot phase-swatch-${phase.type.toLowerCase()}`}
                aria-hidden
              />
              <span>{phase.type}</span>
            </div>
            <div className="week-panel-title">
              <button
                type="button"
                className="week-panel-project-link"
                onClick={onOpenProject}
              >
                {customer} · {project.name || "(utan namn)"}
              </button>
            </div>
            <div className="phase-panel-dates">
              <DatePicker
                value={phase.startDate}
                onChange={(v) => {
                  const patch: Partial<ProjectPhase> = { startDate: v };
                  if (v && phase.endDate && v > phase.endDate)
                    patch.endDate = v;
                  onPatchPhase(patch);
                }}
                ariaLabel="Fasens startdatum"
                placeholder="Start"
                size="compact"
              />
              <span className="todo-dates-sep" aria-hidden>
                –
              </span>
              <DatePicker
                value={phase.endDate}
                onChange={(v) => {
                  const patch: Partial<ProjectPhase> = { endDate: v };
                  if (v && phase.startDate && v < phase.startDate)
                    patch.startDate = v;
                  onPatchPhase(patch);
                }}
                ariaLabel="Fasens slutdatum"
                placeholder="Slut"
                size="compact"
              />
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Stäng"
          >
            <X size={14} strokeWidth={2.25} aria-hidden />
          </button>
        </header>

        <div className="phase-panel-add">
          <div className="phase-panel-add-row">
            <textarea
              ref={textRef}
              rows={1}
              className="phase-comment-text-input"
              placeholder="Skriv en kommentar eller uppgift… (Shift+Enter för ny rad)"
              value={draftText}
              onChange={(e) => {
                setDraftText(e.target.value);
                autoGrowComment(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  addComment();
                }
              }}
            />
            <button
              type="button"
              className="btn"
              onClick={addComment}
              disabled={!draftText.trim()}
            >
              <Plus size={14} strokeWidth={2.25} aria-hidden /> Lägg till
            </button>
          </div>
          <div className="phase-panel-add-meta">
            <select
              className="phase-comment-assignee-select"
              value={draftCategory}
              onChange={(e) =>
                setDraftCategory(e.target.value as PhaseType | "")
              }
              aria-label="Kategori"
            >
              <option value="">Kategori…</option>
              {phaseOrder.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="assignee-chips" role="group" aria-label="Tilldelade">
              {teamMembers.map((m) => {
                const on = draftAssignees.includes(m);
                return (
                  <button
                    type="button"
                    key={m}
                    className={`assignee-chip ${on ? "on" : ""}`}
                    onClick={() => toggleDraftAssignee(m)}
                    aria-pressed={on}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="week-panel-body">
          {comments.length === 0 ? (
            <p className="week-panel-empty">
              Vad ska teamet göra under {phase.type}-fasen för{" "}
              {project.name || "projektet"}? Skriv in den första uppgiften
              ovan.
            </p>
          ) : (
            <ul className="phase-comment-list">
              {comments.map((c) => (
                <li
                  key={c.id}
                  className={`phase-comment-item ${c.done ? "done" : ""}`}
                >
                  <button
                    type="button"
                    className="checkbox"
                    onClick={() => updateComment(c.id, { done: !c.done })}
                    aria-pressed={c.done}
                    aria-label={c.done ? "Avmarkera" : "Markera klar"}
                  >
                    {c.done && <Check size={12} strokeWidth={2.75} aria-hidden />}
                  </button>
                  <div className="phase-comment-body">
                    <textarea
                      rows={1}
                      className="phase-comment-text"
                      value={c.text}
                      onChange={(e) => {
                        updateComment(c.id, { text: e.target.value });
                        autoGrowComment(e.currentTarget);
                      }}
                      ref={(el) => {
                        if (el) autoGrowComment(el);
                      }}
                    />
                    <div className="phase-comment-meta">
                      <select
                        className="phase-comment-assignee-select inline"
                        value={c.category ?? ""}
                        onChange={(e) =>
                          updateComment(c.id, {
                            category: e.target.value as PhaseType | "",
                          })
                        }
                        aria-label="Kategori"
                      >
                        <option value="">Kategori…</option>
                        {phaseOrder.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <div className="assignee-chips small">
                        {teamMembers.map((m) => {
                          const on = c.assignees.includes(m);
                          return (
                            <button
                              type="button"
                              key={m}
                              className={`assignee-chip ${on ? "on" : ""}`}
                              onClick={() =>
                                updateComment(c.id, {
                                  assignees: on
                                    ? c.assignees.filter((a) => a !== m)
                                    : [...c.assignees, m],
                                })
                              }
                              aria-pressed={on}
                              title={m}
                            >
                              {m.split(" ")[0]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => removeComment(c.id)}
                    aria-label="Ta bort"
                  >
                    <X size={14} strokeWidth={2.25} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

// ---- Week panel (read-only summary) ----------------------------------------

interface PhaseInWeek {
  customer: string;
  customerSlug: string;
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
}

/**
 * Litet kontextuellt popover som ankrar till en klickade vecka-cell.
 * Fokus är KPI:er för veckan — total beläggning, per-person breakdown,
 * och antal projekt/faser aktiva. "Öppna hela vecka-vyn"-länk i botten
 * öppnar den fulla WeekPanel:en för djupdykning.
 *
 * Sömlöst mönster — användaren stannar i tabellen istället för att ryckas
 * ut i en sidopanel för 80% av interaktionerna.
 */
function WeekPopover({
  week,
  weekIdx,
  anchorX,
  anchorY,
  rows,
  workloadByMember,
  assigneeFilter,
  onClose,
  onOpenFullPanel,
}: {
  week: WeekInfo;
  weekIdx: number;
  anchorX: number;
  anchorY: number;
  rows: ProjectRow[];
  workloadByMember: Map<TeamMember, WeekBooking[]>;
  assigneeFilter: CommentAssignee;
  onClose: () => void;
  onOpenFullPanel: () => void;
}) {
  const weekMon = week.monday.toISOString().slice(0, 10);
  const weekSun = week.sunday.toISOString().slice(0, 10);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // KPI:er för veckan
  const stats = useMemo(() => {
    // Per-person bokningar för denna vecka
    const perMember: { member: TeamMember; hours: number; pct: number }[] = [];
    let totalBooked = 0;
    for (const m of teamMembers) {
      const booking = workloadByMember.get(m)?.[weekIdx];
      const hours = booking?.hours ?? 0;
      totalBooked += hours;
      perMember.push({
        member: m,
        hours,
        pct: WEEKLY_CAPACITY > 0 ? hours / WEEKLY_CAPACITY : 0,
      });
    }

    const totalCapacity = WEEKLY_CAPACITY * teamMembers.length;
    const utilizationPct =
      totalCapacity > 0 ? totalBooked / totalCapacity : 0;

    // Antal aktiva faser och projekt denna vecka
    const activeProjects = new Set<string>();
    let phaseCount = 0;
    for (const r of rows) {
      let hasActive = false;
      for (const ph of r.project.phases ?? []) {
        if (!ph.startDate || !ph.endDate) continue;
        if (ph.endDate < weekMon) continue;
        if (ph.startDate > weekSun) continue;
        if (assigneeFilter) {
          const matches = (ph.comments ?? []).some((c) =>
            commentMatchesFilter(c, assigneeFilter),
          );
          if (!matches) continue;
        }
        phaseCount++;
        hasActive = true;
      }
      if (hasActive) activeProjects.add(r.project.id);
    }

    return {
      perMember,
      totalBooked,
      totalCapacity,
      utilizationPct,
      projectCount: activeProjects.size,
      phaseCount,
    };
  }, [workloadByMember, weekIdx, rows, weekMon, weekSun, assigneeFilter]);

  // Smart positionering
  const popoverWidth = 320;
  const margin = 12;
  const maxLeft =
    typeof window !== "undefined"
      ? window.innerWidth - popoverWidth - margin
      : 0;
  const left = Math.max(margin, Math.min(anchorX - popoverWidth / 2, maxLeft));
  const popoverHeight = 380;
  const flipUp =
    typeof window !== "undefined" &&
    anchorY + popoverHeight > window.innerHeight - margin;
  const top = flipUp ? anchorY - popoverHeight - 12 : anchorY;

  return (
    <>
      <div className="week-popover-backdrop" onClick={onClose} />
      <div
        className="week-popover"
        style={{ top, left, width: popoverWidth }}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="week-popover-header">
          <div className="week-popover-title">Vecka {week.weekNum}</div>
          <div className="week-popover-range">
            {fmtDay(week.monday)} – {fmtDay(week.sunday)}
          </div>
        </div>

        {/* KPI-block — total beläggning + utilization */}
        <div className="week-kpi-grid">
          <div className="week-kpi-cell">
            <div className="week-kpi-value">{Math.round(stats.totalBooked)}h</div>
            <div className="week-kpi-label">
              av {stats.totalCapacity}h kapacitet
            </div>
          </div>
          <div className="week-kpi-cell">
            <div
              className={`week-kpi-value ${
                stats.utilizationPct > 1
                  ? "over"
                  : stats.utilizationPct >= 0.8
                  ? "high"
                  : ""
              }`}
            >
              {Math.round(stats.utilizationPct * 100)}%
            </div>
            <div className="week-kpi-label">av kapacitet</div>
          </div>
        </div>

        {/* Per-person breakdown */}
        <div className="week-popover-body">
          <div className="week-popover-section-title">Per person</div>
          <ul className="week-team-list">
            {stats.perMember.map((p) => {
              const isOver = p.pct > 1;
              const isFull = p.pct >= 1 && !isOver;
              const isEmpty = p.hours === 0;
              return (
                <li
                  key={p.member}
                  className={`week-team-item ${isEmpty ? "empty" : ""}`}
                >
                  <span className="week-team-name">{p.member}</span>
                  <span className="week-team-bar-wrap">
                    <span
                      className={`week-team-bar ${
                        isOver ? "over" : isFull ? "full" : ""
                      }`}
                      style={{ width: `${Math.min(100, p.pct * 100)}%` }}
                    />
                  </span>
                  <span
                    className={`week-team-hours ${
                      isOver ? "over" : isFull ? "full" : ""
                    }`}
                  >
                    {Math.round(p.hours)}h
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Sekundär stat-rad: faser + projekt */}
          {stats.phaseCount > 0 && (
            <div className="week-popover-meta">
              {stats.projectCount} {stats.projectCount === 1 ? "projekt" : "projekt"}
              <span className="week-popover-meta-sep" aria-hidden>·</span>
              {stats.phaseCount} {stats.phaseCount === 1 ? "fas aktiv" : "faser aktiva"}
            </div>
          )}
        </div>

        <div className="week-popover-footer">
          <button
            type="button"
            className="week-popover-action"
            onClick={onOpenFullPanel}
          >
            Öppna hela vecka-vyn
            <ChevronRight size={11} strokeWidth={2.25} aria-hidden />
          </button>
        </div>
      </div>
    </>
  );
}

function WeekPanel({
  year,
  week,
  rows,
  assigneeFilter,
  onClose,
  onOpenPhase,
}: {
  year: number;
  week: WeekInfo;
  rows: ProjectRow[];
  assigneeFilter: CommentAssignee;
  onClose: () => void;
  onOpenPhase: (
    customerSlug: string,
    projectId: string,
    phaseId: string,
  ) => void;
}) {
  const weekMon = week.monday.toISOString().slice(0, 10);
  const weekSun = week.sunday.toISOString().slice(0, 10);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const phasesInWeek: PhaseInWeek[] = useMemo(() => {
    const result: PhaseInWeek[] = [];
    for (const r of rows) {
      for (const ph of r.project.phases ?? []) {
        if (!ph.startDate || !ph.endDate) continue;
        if (ph.endDate < weekMon) continue;
        if (ph.startDate > weekSun) continue;
        // Filter on assignee: keep phase if any comment matches (or always if no filter)
        if (assigneeFilter) {
          const matches = (ph.comments ?? []).some(
            (c) => commentMatchesFilter(c, assigneeFilter),
          );
          if (!matches) continue;
        }
        result.push({
          customer: r.customer,
          customerSlug: r.customerSlug,
          projectId: r.project.id,
          projectName: r.project.name || "(utan namn)",
          phase: ph,
        });
      }
    }
    result.sort(
      (a, b) =>
        a.customer.localeCompare(b.customer, "sv") ||
        a.projectName.localeCompare(b.projectName, "sv") ||
        phaseOrder.indexOf(a.phase.type) - phaseOrder.indexOf(b.phase.type),
    );
    return result;
  }, [rows, weekMon, weekSun, assigneeFilter]);

  return (
    <div
      className="week-panel-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Vecka ${week.weekNum}`}
    >
      <aside
        className="week-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="week-panel-header">
          <div>
            <div className="week-panel-title">
              Vecka {week.weekNum} · {year}
            </div>
            <div className="week-panel-range">
              {fmtDay(week.monday)} – {fmtDay(week.sunday)}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Stäng"
          >
            <X size={14} strokeWidth={2.25} aria-hidden />
          </button>
        </header>

        <div className="week-panel-summary">
          {assigneeFilter && (
            <span className="filter-chip">{assigneeFilter}</span>
          )}
          {phasesInWeek.length === 0
            ? "Inga aktiva faser denna vecka."
            : `${phasesInWeek.length} ${phasesInWeek.length === 1 ? "fas aktiv" : "faser aktiva"}`}
        </div>

        <div className="week-panel-body">
          {phasesInWeek.length === 0 ? (
            <p className="week-panel-empty">
              {assigneeFilter
                ? `Inga faser som ${assigneeFilter} jobbar i pågår vecka ${week.weekNum}.`
                : `Inga projekt har en fas som överlappar vecka ${week.weekNum}.`}
            </p>
          ) : (
            phasesInWeek.map((pw) => {
              const visibleComments = assigneeFilter
                ? (pw.phase.comments ?? []).filter(
                    (c) => commentMatchesFilter(c, assigneeFilter),
                  )
                : pw.phase.comments ?? [];
              return (
                <section
                  key={`${pw.customerSlug}-${pw.projectId}-${pw.phase.id}`}
                  className="week-project"
                >
                  <button
                    type="button"
                    className="week-project-title clickable-row"
                    onClick={() =>
                      onOpenPhase(pw.customerSlug, pw.projectId, pw.phase.id)
                    }
                  >
                    <span
                      className={`legend-dot phase-swatch-${pw.phase.type.toLowerCase()}`}
                      aria-hidden
                    />
                    <span className="week-project-customer">{pw.customer}</span>
                    <span className="week-project-sep">·</span>
                    <span className="week-project-name">{pw.projectName}</span>
                    <span className="week-project-phase">
                      {pw.phase.type}
                    </span>
                    <span className="week-todo-range">
                      {formatPanelDateRange(
                        pw.phase.startDate,
                        pw.phase.endDate,
                      )}
                    </span>
                  </button>
                  {visibleComments.length === 0 ? (
                    <p className="week-phase-no-comments">
                      Inga kommentarer.
                    </p>
                  ) : (
                    <ul className="week-todo-list">
                      {visibleComments.map((c) => (
                        <li
                          key={c.id}
                          className={`week-todo ${c.done ? "done" : ""}`}
                        >
                          <span className="week-todo-check" aria-hidden>
                            {c.done ? (
                              <Check size={12} strokeWidth={2.5} />
                            ) : (
                              <Circle size={12} strokeWidth={1.75} />
                            )}
                          </span>
                          <div className="week-todo-body">
                            <span className="week-todo-text">{c.text}</span>
                            <CommentBadges
                              category={c.category}
                              assignees={c.assignees}
                              baseClass="week-todo-assignee"
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}

// ---- Month panel (calendar view) ------------------------------------------

interface PhaseOnDay {
  customer: string;
  customerSlug: string;
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
}

// ---- Team row --------------------------------------------------------------

/** Allokering + vilket projekt och vilken kund den hör till. */
interface MemberAlloc {
  customer: string;
  customerSlug: string;
  project: Project;
  allocation: ProjectAllocation;
}

/**
 * En rad i Bemannings-sektionen: en sub-rad per allokering. Varje allokering
 * är en dragbar stapel med egen tidsperiod, frikopplad från projektets datum.
 *
 * Interaktioner:
 *  - Klick på stapel → popover med timmar, projekt, datum, delete
 *  - Dra stapel → flyttar hela perioden
 *  - Dra kant → resize:ar perioden
 *  - Click-drag i tom yta → skapa ny allokering (öppnar projekt-popover)
 */
function TeamRow({
  member,
  weeks,
  todayIdx,
  bookings,
  activeRows,
  onAddAllocation,
  onPatchAllocation,
  onRemoveAllocation,
}: {
  member: TeamMember;
  weeks: WeekInfo[];
  todayIdx: number;
  bookings: WeekBooking[] | undefined;
  activeRows: ProjectRow[];
  onAddAllocation: (
    slug: string,
    projectId: string,
    allocation: ProjectAllocation,
  ) => void;
  onPatchAllocation: (
    slug: string,
    projectId: string,
    allocationId: string,
    patch: Partial<ProjectAllocation>,
  ) => void;
  onRemoveAllocation: (
    slug: string,
    projectId: string,
    allocationId: string,
  ) => void;
}) {
  // Lista över alla allokeringar för den här medlemmen, sorterade kronologiskt.
  // En sub-rad per allokering ritas — flera allokeringar per projekt tillåts.
  const memberAllocations = useMemo<MemberAlloc[]>(() => {
    const list: MemberAlloc[] = [];
    for (const r of activeRows) {
      for (const a of r.project.allocations ?? []) {
        if (a.member !== member) continue;
        list.push({
          customer: r.customer,
          customerSlug: r.customerSlug,
          project: r.project,
          allocation: a,
        });
      }
    }
    list.sort((a, b) =>
      a.allocation.startDate.localeCompare(b.allocation.startDate),
    );
    return list;
  }, [activeRows, member]);

  const overbookedWeeks = useMemo(
    () => (bookings ?? []).filter((b) => b.hours > WEEKLY_CAPACITY).length,
    [bookings],
  );

  const horizonWeeks = 4;
  const availableHours = useMemo(() => {
    const startIdx = todayIdx >= 0 ? todayIdx : 0;
    return Math.round(availableNextWeeks(bookings, startIdx, horizonWeeks));
  }, [bookings, todayIdx]);

  const isEmpty = memberAllocations.length === 0;

  // State för popover-redigering. Sätts när användaren klickar på en
  // befintlig stapel ELLER när en ny stapel skapas via click-drag.
  const [editing, setEditing] = useState<{
    customerSlug: string;
    projectId: string;
    allocationId: string;
  } | null>(null);

  return (
    <>
      <div
        className={`planering-row planering-row-team ${isEmpty ? "empty" : ""}`}
      >
        <div className="planering-row-label team-row-label">
          <span className="team-row-name">{member}</span>
          {overbookedWeeks > 0 && (
            <span
              className="team-row-warning"
              title={`${overbookedWeeks} veckor över ${WEEKLY_CAPACITY}h kapacitet`}
            >
              {overbookedWeeks} v över
            </span>
          )}
          <span
            className={`team-row-avail ${availableHours === 0 ? "none" : ""}`}
            title={`${availableHours}h tillgängligt nästa ${horizonWeeks} veckor`}
          >
            {availableHours}h ledigt
          </span>
        </div>
        <TeamCreateArea
          member={member}
          weeks={weeks}
          todayIdx={todayIdx}
          activeRows={activeRows}
          onCreate={(slug, projectId, allocation) => {
            onAddAllocation(slug, projectId, allocation);
            setEditing({
              customerSlug: slug,
              projectId,
              allocationId: allocation.id,
            });
          }}
          isEmpty={isEmpty}
        />
      </div>

      {/* En stapelrad per allokering. Klick öppnar popover, drag flyttar. */}
      {memberAllocations.map((ma) => {
        const isEditing =
          editing?.allocationId === ma.allocation.id &&
          editing?.projectId === ma.project.id;
        return (
          <TeamAllocRow
            key={`alloc-${ma.allocation.id}`}
            ma={ma}
            weeks={weeks}
            todayIdx={todayIdx}
            isEditing={isEditing}
            onOpenEdit={() =>
              setEditing({
                customerSlug: ma.customerSlug,
                projectId: ma.project.id,
                allocationId: ma.allocation.id,
              })
            }
            onCloseEdit={() => setEditing(null)}
            onPatch={(patch) =>
              onPatchAllocation(
                ma.customerSlug,
                ma.project.id,
                ma.allocation.id,
                patch,
              )
            }
            onRemove={() => {
              onRemoveAllocation(
                ma.customerSlug,
                ma.project.id,
                ma.allocation.id,
              );
              setEditing(null);
            }}
            activeRows={activeRows}
          />
        );
      })}
    </>
  );
}

// ---- TeamAllocRow ----------------------------------------------------------

/**
 * En sub-rad i bemanningssektionen: en specifik allokering med dragbar
 * stapel. Drag-logiken är portad från PhaseTimelineRow.
 */
function TeamAllocRow({
  ma,
  weeks,
  todayIdx,
  isEditing,
  onOpenEdit,
  onCloseEdit,
  onPatch,
  onRemove,
  activeRows,
}: {
  ma: MemberAlloc;
  weeks: WeekInfo[];
  todayIdx: number;
  isEditing: boolean;
  onOpenEdit: () => void;
  onCloseEdit: () => void;
  onPatch: (patch: Partial<ProjectAllocation>) => void;
  onRemove: () => void;
  activeRows: ProjectRow[];
}) {
  const start = parseISODate(ma.allocation.startDate);
  const end = parseISODate(ma.allocation.endDate);
  const range = start && end ? dateRangeToWeeks(weeks, start, end) : null;

  // Drag-state — mirrors PhaseTimelineRow
  const dragRef = useRef<{
    startX: number;
    startStart: string;
    startEnd: string;
    mode: "move" | "resize-left" | "resize-right";
    moved: boolean;
  } | null>(null);
  const [preview, setPreview] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);

  const draftStart = preview?.startDate ?? ma.allocation.startDate;
  const draftEnd = preview?.endDate ?? ma.allocation.endDate;
  const draftStartDate = parseISODate(draftStart);
  const draftEndDate = parseISODate(draftEnd);
  const draftRange =
    draftStartDate && draftEndDate
      ? dateRangeToWeeks(weeks, draftStartDate, draftEndDate)
      : range;

  function pointerDown(
    e: ReactPointerEvent<HTMLDivElement>,
    mode: "move" | "resize-left" | "resize-right",
  ) {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startStart: ma.allocation.startDate,
      startEnd: ma.allocation.endDate,
      mode,
      moved: false,
    };
  }

  function pointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const deltaWeeks = Math.round(dx / WEEK_WIDTH);
    if (Math.abs(dx) >= DRAG_THRESHOLD) d.moved = true;
    if (deltaWeeks === 0 && !d.moved) {
      setPreview(null);
      return;
    }
    const deltaDays = deltaWeeks * 7;
    if (d.mode === "move") {
      setPreview({
        startDate: addDaysToISO(d.startStart, deltaDays),
        endDate: addDaysToISO(d.startEnd, deltaDays),
      });
    } else if (d.mode === "resize-left") {
      const newStart = addDaysToISO(d.startStart, deltaDays);
      if (newStart <= d.startEnd) {
        setPreview({ startDate: newStart, endDate: d.startEnd });
      }
    } else {
      const newEnd = addDaysToISO(d.startEnd, deltaDays);
      if (newEnd >= d.startStart) {
        setPreview({ startDate: d.startStart, endDate: newEnd });
      }
    }
  }

  function pointerUp() {
    const d = dragRef.current;
    if (!d) return;
    const moved = d.moved;
    const next = preview;
    dragRef.current = null;
    setPreview(null);
    if (moved && next) {
      onPatch({ startDate: next.startDate, endDate: next.endDate });
    } else if (!moved) {
      // Klick utan rörelse — öppna popover
      onOpenEdit();
    }
  }

  return (
    <div className="planering-row planering-row-team-alloc">
      <div className="planering-row-label team-alloc-label">
        <span className="team-alloc-customer">{ma.allocation.member}</span>
      </div>
      <div className="planering-row-cells team-alloc-cells">
        {todayIdx >= 0 && (
          <div
            className="planering-today-line"
            style={{
              gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
              gridRow: 1,
            }}
          />
        )}
        {draftRange && (
          <div
            className="team-alloc-bar"
            style={{
              gridColumn: `${draftRange.startIdx + 1} / ${draftRange.endIdx + 2}`,
              gridRow: 1,
            }}
            onPointerDown={(e) => pointerDown(e, "move")}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            title={`${ma.allocation.member} — ${ma.allocation.hoursPerWeek}h/v`}
          >
            <div
              className="team-alloc-resize team-alloc-resize-left"
              onPointerDown={(e) => pointerDown(e, "resize-left")}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              aria-hidden
            />
            <span className="team-alloc-bar-label">
              {ma.allocation.hoursPerWeek}h/v
            </span>
            <div
              className="team-alloc-resize team-alloc-resize-right"
              onPointerDown={(e) => pointerDown(e, "resize-right")}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              aria-hidden
            />
          </div>
        )}
        {isEditing && (
          <AllocPopover
            ma={ma}
            activeRows={activeRows}
            onClose={onCloseEdit}
            onPatch={onPatch}
            onRemove={onRemove}
          />
        )}
      </div>
    </div>
  );
}

// ---- TeamCreateArea --------------------------------------------------------

/**
 * Klick-och-dra-yta i header-radens cells-område. Användaren drar för att
 * måla en tidsperiod, släpper för att skapa allokering. Projekt-popover
 * öppnas automatiskt efter skapande.
 */
function TeamCreateArea({
  member,
  weeks,
  todayIdx,
  activeRows,
  onCreate,
  isEmpty,
}: {
  member: TeamMember;
  weeks: WeekInfo[];
  todayIdx: number;
  activeRows: ProjectRow[];
  onCreate: (
    slug: string,
    projectId: string,
    allocation: ProjectAllocation,
  ) => void;
  isEmpty: boolean;
}) {
  const dragRef = useRef<{
    startWeekIdx: number;
    currentWeekIdx: number;
    rect: DOMRect;
  } | null>(null);
  const [preview, setPreview] = useState<{
    startIdx: number;
    endIdx: number;
  } | null>(null);

  function pointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if (activeRows.length === 0) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const weekIdx = Math.max(
      0,
      Math.min(weeks.length - 1, Math.floor(relX / WEEK_WIDTH)),
    );
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startWeekIdx: weekIdx,
      currentWeekIdx: weekIdx,
      rect,
    };
    setPreview({ startIdx: weekIdx, endIdx: weekIdx });
  }

  function pointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const relX = e.clientX - d.rect.left;
    const weekIdx = Math.max(
      0,
      Math.min(weeks.length - 1, Math.floor(relX / WEEK_WIDTH)),
    );
    d.currentWeekIdx = weekIdx;
    const startIdx = Math.min(d.startWeekIdx, weekIdx);
    const endIdx = Math.max(d.startWeekIdx, weekIdx);
    setPreview({ startIdx, endIdx });
  }

  function pointerUp() {
    const d = dragRef.current;
    if (!d) return;
    const startIdx = Math.min(d.startWeekIdx, d.currentWeekIdx);
    const endIdx = Math.max(d.startWeekIdx, d.currentWeekIdx);
    dragRef.current = null;
    setPreview(null);
    // Plocka första aktiva projektet som default — popover låter user byta.
    const firstRow = activeRows[0];
    if (!firstRow) return;
    const startDate = weeks[startIdx].monday.toISOString().slice(0, 10);
    const endDate = weeks[endIdx].sunday.toISOString().slice(0, 10);
    const allocation = newAllocation(member, startDate, endDate, 0);
    onCreate(firstRow.customerSlug, firstRow.project.id, allocation);
  }

  return (
    <div
      className="planering-row-cells team-header-cells"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      {todayIdx >= 0 && (
        <div
          className="planering-today-line"
          style={{
            gridColumn: `${todayIdx + 1} / ${todayIdx + 2}`,
            gridRow: 1,
          }}
        />
      )}
      {preview && (
        <div
          className="team-create-preview"
          style={{
            gridColumn: `${preview.startIdx + 1} / ${preview.endIdx + 2}`,
            gridRow: 1,
          }}
        />
      )}
      {isEmpty && !preview && (
        <span className="team-row-empty-hint">
          Klicka och dra för att skapa allokering
        </span>
      )}
    </div>
  );
}

// ---- AllocPopover ----------------------------------------------------------

/**
 * Inline-popover som visas vid klick på en allokerings-stapel.
 * Innehåller projektväljare, timinput, datumpickers och delete.
 */
function AllocPopover({
  ma,
  onClose,
  onPatch,
  onRemove,
}: {
  ma: MemberAlloc;
  activeRows: ProjectRow[];
  onClose: () => void;
  onPatch: (patch: Partial<ProjectAllocation>) => void;
  onRemove: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="alloc-popover-backdrop" onClick={onClose} />
      <div
        className="alloc-popover"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="alloc-popover-header">
          <div className="alloc-popover-titlewrap">
            <span className="alloc-popover-customer">{ma.customer}</span>
            <span className="alloc-popover-project">
              {ma.project.name || "(utan namn)"}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Stäng"
          >
            <X size={14} strokeWidth={2.25} aria-hidden />
          </button>
        </div>
        <div className="alloc-popover-body">
          <div className="alloc-field">
            <label className="meta-label" htmlFor="alloc-member">
              Person
            </label>
            <select
              id="alloc-member"
              className="panel-text-input"
              value={ma.allocation.member}
              onChange={(e) =>
                onPatch({ member: e.target.value as TeamMember })
              }
            >
              {teamMembers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="alloc-field">
            <label className="meta-label" htmlFor="alloc-hours">
              Timmar per vecka
            </label>
            <div className="alloc-hours-wrap">
              <input
                id="alloc-hours"
                type="number"
                min={0}
                step={1}
                className="panel-text-input"
                value={ma.allocation.hoursPerWeek || ""}
                placeholder="0"
                autoFocus
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const n = raw === "" ? 0 : Number(raw);
                  onPatch({ hoursPerWeek: Number.isFinite(n) ? n : 0 });
                }}
              />
              <span className="alloc-hours-unit">h/v</span>
            </div>
          </div>
          <div className="alloc-field-row">
            <div className="alloc-field">
              <label className="meta-label">Startdatum</label>
              <DatePicker
                value={ma.allocation.startDate}
                onChange={(v) => onPatch({ startDate: v })}
                ariaLabel="Allokeringens startdatum"
                size="compact"
              />
            </div>
            <div className="alloc-field">
              <label className="meta-label">Slutdatum</label>
              <DatePicker
                value={ma.allocation.endDate}
                onChange={(v) => onPatch({ endDate: v })}
                ariaLabel="Allokeringens slutdatum"
                size="compact"
              />
            </div>
          </div>
        </div>
        <div className="alloc-popover-footer">
          <button
            type="button"
            className="btn btn-mute danger small"
            onClick={onRemove}
          >
            Ta bort
          </button>
          <button type="button" className="btn small" onClick={onClose}>
            Klar
          </button>
        </div>
      </div>
    </>
  );
}
