import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "wouter";
import type { Person, Organization } from "@workspace/api-client-react";
import type { ColumnDef } from "@tanstack/react-table";
import { AsyncSelect } from "@/components/ui/async-select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  usePersonSearch,
  useOrganizationSearch,
  loadOrganizationOptions,
  type PersonSearchParams,
  type OrganizationSearchParams,
} from "@/lib/contacts-search-api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Plus,
  Building2,
  User,
  Pencil,
  Mail,
  Phone,
  Search,
  X,
  LayoutGrid,
  Table as TableIcon,
} from "lucide-react";
import {
  usePreference,
  useServerTablePreferences,
} from "@/hooks/use-user-preferences";
import { cn } from "@/lib/utils";
import { FiltersToggle } from "@/components/shared/toolbar-controls";
import { LabelChips } from "@/components/shared/labels-editor";
import { DataTable } from "@/components/shared/data-table";
import {
  extraColumns,
  extraColumnIds,
  hiddenVisibility,
  type ExtraColumnSpec,
} from "@/components/shared/extra-columns";
import { PersonFormDialog } from "@/components/contacts/person-form-dialog";
import { OrgFormDialog } from "@/components/contacts/org-form-dialog";
import { useI18n } from "@/lib/i18n/i18n";

// Extra selectable (default-hidden) fields — everything in the data structure
// not already a primary column, so any field can be added via the picker.
const PERSON_EXTRA: ExtraColumnSpec[] = [
  { id: "id", header: "deals.field.personId", kind: "number", size: 90 },
  { id: "organizationId", header: "common.id", kind: "number", size: 90 },
  { id: "ownerName", header: "common.owner", size: 160 },
  { id: "ownerId", header: "contacts.col.ownerId", kind: "number", size: 90 },
  { id: "addTime", header: "common.created", kind: "datetime", size: 190 },
  { id: "updateTime", header: "common.updated", kind: "datetime", size: 190 },
];
const ORG_EXTRA: ExtraColumnSpec[] = [
  { id: "id", header: "common.id", kind: "number", size: 90 },
  { id: "ownerName", header: "common.owner", size: 160 },
  { id: "ownerId", header: "contacts.col.ownerId", kind: "number", size: 90 },
  { id: "personCount", header: "deals.related.people", kind: "number", size: 90 },
  { id: "addTime", header: "common.created", kind: "datetime", size: 190 },
  { id: "updateTime", header: "common.updated", kind: "datetime", size: 190 },
];
const PERSON_EXTRA_HIDDEN = hiddenVisibility(PERSON_EXTRA);
const ORG_EXTRA_HIDDEN = hiddenVisibility(ORG_EXTRA);

const ALL = "__all__";

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

type ViewMode = "table" | "cards";
type PersonFiltersPreference = {
  query: string;
  orgFilter: string | null;
  orgFilterLabel: string | null;
};
type OrganizationFiltersPreference = {
  query: string;
};

function ViewSwitcher({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-whisper p-0.5">
      {(
        [
          { key: "table", label: "views.table", icon: TableIcon },
          { key: "cards", label: "contacts.view.cards", icon: LayoutGrid },
        ] as const
      ).map(({ key, label: labelKey, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            view === key
              ? "bg-card text-brand shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline">{t(labelKey)}</span>
        </button>
      ))}
    </div>
  );
}

function SummaryCards({
  cards,
}: {
  cards: { label: string; value: number; dot: string }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 px-4 pb-3 sm:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-border bg-card px-4 py-3"
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-full", card.dot)} />
            {card.label}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {card.value.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ContactsPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const tabParam = params.get("tab");
  const focusParam = params.get("focus");
  const qParam = params.get("q") ?? "";
  const focusId = focusParam ? Number(focusParam) : null;

  const [tab, setTab] = useState(tabParam ?? "persons");
  // Follow deep links (e.g. from global search) that point at a specific tab.
  useEffect(() => {
    if (tabParam) setTab(tabParam);
  }, [tabParam]);

  // View + filters live in the shared preference store (same keys the child
  // views read), so the header can render the standard [arrow][view switcher]
  // [button] cluster next to the Add button — same place as every other page.
  const [personsView, setPersonsView] = usePreference<ViewMode>(
    "viewModes.persons",
    "table",
  );
  const [orgsView, setOrgsView] = usePreference<ViewMode>(
    "viewModes.organizations",
    "table",
  );
  const [personsFiltersOpen, setPersonsFiltersOpen] = usePreference(
    "filterPanels.persons",
    true,
  );
  const [orgsFiltersOpen, setOrgsFiltersOpen] = usePreference(
    "filterPanels.organizations",
    true,
  );

  // Read the same persisted filters the child views apply, so the collapse
  // arrows can badge active filters — a collapsed panel must never hide that
  // restored filters are narrowing the list.
  const [personsFilters] = usePreference<PersonFiltersPreference>(
    "filters.persons",
    { query: "", orgFilter: null, orgFilterLabel: null },
  );
  const [orgsFilters] = usePreference<OrganizationFiltersPreference>(
    "filters.organizations",
    { query: "" },
  );
  const personsFilterCount = [
    personsFilters.query.trim() !== "",
    personsFilters.orgFilter != null,
  ].filter(Boolean).length;
  const orgsFilterCount = orgsFilters.query.trim() !== "" ? 1 : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-3">
        <div>
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">
            {t("common.contacts")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("contacts.subtitle")}
          </p>
        </div>
        {/* Standard cluster: arrow · view switcher · button — same place and
            order as the other list pages. */}
        <div className="flex items-center gap-2">
          {tab === "persons" && (
            <>
              <FiltersToggle
                open={personsFiltersOpen}
                onToggle={() => setPersonsFiltersOpen((v) => !v)}
                activeCount={personsFilterCount}
              />
              <ViewSwitcher view={personsView} onChange={setPersonsView} />
              <PersonFormDialog
                trigger={
                  <Button className="bg-primary text-primary-foreground hover:bg-primary-hover">
                    <Plus className="me-2 h-4 w-4" /> {t("contacts.addPerson")}
                  </Button>
                }
              />
            </>
          )}
          {tab === "organizations" && (
            <>
              <FiltersToggle
                open={orgsFiltersOpen}
                onToggle={() => setOrgsFiltersOpen((v) => !v)}
                activeCount={orgsFilterCount}
              />
              <ViewSwitcher view={orgsView} onChange={setOrgsView} />
              <OrgFormDialog
                trigger={
                  <Button className="bg-primary text-primary-foreground hover:bg-primary-hover">
                    <Plus className="me-2 h-4 w-4" /> {t("contacts.addOrganization")}
                  </Button>
                }
              />
            </>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Scrolls horizontally on narrow screens instead of overflowing. */}
        <div className="mx-4 mt-2 overflow-x-auto">
          <TabsList className="w-max">
            <TabsTrigger value="persons" className="flex items-center gap-2">
              <User className="h-4 w-4" /> {t("contacts.persons")}
            </TabsTrigger>
            <TabsTrigger value="organizations" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" /> {t("contacts.organizations")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="persons"
          className="mt-2 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <PersonsView
            initialQuery={tabParam === "persons" ? qParam : undefined}
            focusId={tabParam === "persons" ? focusId : null}
          />
        </TabsContent>

        <TabsContent
          value="organizations"
          className="mt-2 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <OrganizationsView
            initialQuery={tabParam === "organizations" ? qParam : undefined}
            focusId={tabParam === "organizations" ? focusId : null}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Persons
// ---------------------------------------------------------------------------

function PersonsView({
  initialQuery,
  focusId,
}: {
  initialQuery?: string;
  focusId?: number | null;
}) {
  // View + filters are driven from the Contacts header (parent); read-only here.
  const { t } = useI18n();
  const [view] = usePreference<ViewMode>("viewModes.persons", "table");
  const [filtersOpen] = usePreference("filterPanels.persons", true);
  const [filters, setFilters] = usePreference<PersonFiltersPreference>(
    "filters.persons",
    {
      query: "",
      orgFilter: null,
      orgFilterLabel: null,
    },
  );
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize, sorting, setSorting } =
    useServerTablePreferences("persons", { defaultPageSize: 30 });
  const { query, orgFilter, orgFilterLabel } = filters;
  const debouncedQuery = useDebouncedValue(query.trim(), 300);

  // When arriving from a global-search deep link, prefill the search so the
  // focused row surfaces, then let the table highlight it.
  useEffect(() => {
    if (focusId != null) {
      setFilters((prev) => ({ ...prev, query: initialQuery ?? "" }));
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, initialQuery]);

  useEffect(() => {
    if (!initialQuery || focusId != null) return;
    setFilters((prev) =>
      prev.query === initialQuery ? prev : { ...prev, query: initialQuery },
    );
    setPage(1);
  }, [focusId, initialQuery, setFilters]);

  const searchParams = useMemo<PersonSearchParams>(
    () => ({
      q: debouncedQuery || undefined,
      organizationId: orgFilter ? Number(orgFilter) : undefined,
      sort: sorting[0]
        ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}`
        : undefined,
      page,
      limit: pageSize,
    }),
    [debouncedQuery, orgFilter, sorting, page, pageSize],
  );

  const { data, isLoading, isError } = usePersonSearch(searchParams);
  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  const summary = useMemo(
    () => [{ label: t("deals.related.people"), value: total, dot: "bg-gray-400" }],
    [total],
  );

  const columns = useMemo<ColumnDef<Person>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("common.name"),
        size: 240,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/person/${row.original.id}`}
              dir="auto"
              className="block truncate font-medium text-foreground hover:text-brand hover:underline"
            >
              {dash(row.original.name)}
            </Link>
            <div className="truncate text-xs text-subtle">
              #{row.original.id}
            </div>
          </div>
        ),
      },
      {
        id: "jobTitle",
        accessorKey: "jobTitle",
        header: t("common.jobTitle"),
        size: 180,
        cell: ({ row }) => (
          <span dir="auto" className="truncate text-muted-foreground">
            {dash(row.original.jobTitle)}
          </span>
        ),
      },
      {
        id: "email",
        accessorKey: "email",
        header: t("common.email"),
        size: 240,
        cell: ({ row }) =>
          row.original.email ? (
            <a
              href={`mailto:${row.original.email}`}
              className="truncate text-brand hover:underline"
            >
              {row.original.email}
            </a>
          ) : (
            <span className="text-subtle">—</span>
          ),
      },
      {
        id: "phone",
        accessorKey: "phone",
        header: t("common.phone"),
        size: 170,
        cell: ({ row }) => (
          <span dir="auto" className="truncate text-muted-foreground">
            {dash(row.original.phone)}
          </span>
        ),
      },
      {
        id: "organization",
        accessorKey: "organizationName",
        header: t("common.organization"),
        size: 220,
        cell: ({ row }) =>
          row.original.organizationName ? (
            <span className="flex items-center gap-1.5 truncate text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-subtle" />
              {row.original.organizationName}
            </span>
          ) : (
            <span className="text-subtle">—</span>
          ),
      },
      {
        id: "labels",
        header: t("deals.field.labels"),
        size: 180,
        enableSorting: false,
        cell: ({ row }) => (
          <LabelChips entity="person" labels={row.original.labels} />
        ),
      },
      {
        id: "deals",
        accessorKey: "dealCount",
        header: t("common.deals"),
        size: 90,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums text-foreground">
            {row.original.dealCount ?? 0}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("common.actions"),
        size: 110,
        enableSorting: false,
        enableResizing: false,
        cell: ({ row }) => (
          <PersonFormDialog
            person={row.original}
            trigger={
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
              >
                <Pencil className="me-1 h-3.5 w-3.5" />
                {t("common.edit")}
              </Button>
            }
          />
        ),
      },
    ],
    [],
  );
  const allColumns = useMemo(
    () => [...columns, ...extraColumns<Person>(t, PERSON_EXTRA)],
    [columns, t],
  );

  const hasFilters = query.trim() !== "" || orgFilter !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {filtersOpen && <SummaryCards cards={summary} />}

      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
            <div className="relative w-full sm:w-auto">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input
                value={query}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, query: e.target.value }));
                  setPage(1);
                }}
                placeholder={t("contacts.searchPersons")}
                className="w-full ps-8 sm:w-[240px]"
              />
            </div>

            <AsyncSelect
              value={orgFilter ?? ALL}
              valueLabel={orgFilterLabel}
              allValue={ALL}
              allLabel={t("filter.allOrgs")}
              placeholder={t("contacts.filterByOrg")}
              loadOptions={loadOrganizationOptions}
              onChange={(v, label) => {
                setFilters((prev) => ({
                  ...prev,
                  orgFilter: v && v !== ALL ? v : null,
                  orgFilterLabel: label,
                }));
                setPage(1);
              }}
              triggerClassName="w-full sm:w-[200px]"
            />

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  setFilters({
                    query: "",
                    orgFilter: null,
                    orgFilterLabel: null,
                  });
                  setPage(1);
                }}
              >
                <X className="me-1 h-4 w-4" />
                {t("common.clear")}
              </Button>
            )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "table" ? (
          <DataTable
            data={items}
            columns={allColumns}
            getRowId={(p) => String(p.id)}
            highlightRowId={focusId != null ? String(focusId) : null}
            preferenceKey="persons"
            defaultColumnOrder={[
              "name",
              "jobTitle",
              "email",
              "phone",
              "organization",
              "labels",
              "deals",
              ...extraColumnIds(PERSON_EXTRA),
              "actions",
            ]}
            defaultColumnVisibility={PERSON_EXTRA_HIDDEN}
            isLoading={isLoading}
            isError={isError}
            loadingMessage={t("contacts.loadingPersons")}
            errorMessage={t("contacts.personsFailed")}
            emptyMessage={t("contacts.personsEmpty")}
            server={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: (s) => {
                setPageSize(s);
                setPage(1);
              },
              sorting,
              onSortingChange: (next) => {
                setSorting(next);
                setPage(1);
              },
            }}
          />
        ) : (
          <CardsGrid
            isLoading={isLoading}
            isEmpty={items.length === 0}
            emptyMessage={t("contacts.personsEmpty")}
          >
            {items.map((person) => (
              <PersonCard key={person.id} person={person} />
            ))}
          </CardsGrid>
        )}
      </div>
    </div>
  );
}

function PersonCard({ person }: { person: Person }) {
  const { t } = useI18n();
  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/person/${person.id}`}
          className="flex min-w-0 items-center gap-2.5"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-sm font-semibold text-brand">
            {person.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div
              dir="auto"
              className="truncate font-semibold text-foreground hover:text-brand hover:underline"
            >
              {person.name}
            </div>
            {person.jobTitle && (
              <div dir="auto" className="truncate text-xs text-muted-foreground">
                {person.jobTitle}
              </div>
            )}
            <div className="text-xs text-subtle">
              {person.dealCount ?? 0} deals
            </div>
          </div>
        </Link>
        <PersonFormDialog
          person={person}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          }
        />
      </div>
      <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
        {person.email && (
          <div className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 shrink-0 text-subtle" />
            <a
              href={`mailto:${person.email}`}
              className="truncate hover:text-brand"
            >
              {person.email}
            </a>
          </div>
        )}
        {person.phone && (
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 shrink-0 text-subtle" />
            <span dir="auto" className="truncate">
              {person.phone}
            </span>
          </div>
        )}
        {person.organizationName && (
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-subtle" />
            <span className="truncate text-brand">
              {person.organizationName}
            </span>
          </div>
        )}
        {!person.email && !person.phone && !person.organizationName && (
          <div className="text-xs text-subtle">{t("contacts.noContactDetails")}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

function OrganizationsView({
  initialQuery,
  focusId,
}: {
  initialQuery?: string;
  focusId?: number | null;
}) {
  // View + filters are driven from the Contacts header (parent); read-only here.
  const { t } = useI18n();
  const [view] = usePreference<ViewMode>("viewModes.organizations", "table");
  const [filtersOpen] = usePreference("filterPanels.organizations", true);
  const [filters, setFilters] = usePreference<OrganizationFiltersPreference>(
    "filters.organizations",
    { query: "" },
  );
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize, sorting, setSorting } =
    useServerTablePreferences("organizations", { defaultPageSize: 30 });
  const { query } = filters;
  const debouncedQuery = useDebouncedValue(query.trim(), 300);

  // Prefill from a deep link so the focused organization surfaces, then let the
  // table highlight it.
  useEffect(() => {
    if (focusId != null) {
      setFilters({ query: initialQuery ?? "" });
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, initialQuery]);

  useEffect(() => {
    if (!initialQuery || focusId != null) return;
    setFilters((prev) =>
      prev.query === initialQuery ? prev : { ...prev, query: initialQuery },
    );
    setPage(1);
  }, [focusId, initialQuery, setFilters]);

  const searchParams = useMemo<OrganizationSearchParams>(
    () => ({
      q: debouncedQuery || undefined,
      sort: sorting[0]
        ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}`
        : undefined,
      page,
      limit: pageSize,
    }),
    [debouncedQuery, sorting, page, pageSize],
  );

  const { data, isLoading, isError } = useOrganizationSearch(searchParams);
  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  const summary = useMemo(
    () => [{ label: t("contacts.organizations"), value: total, dot: "bg-gray-400" }],
    [total],
  );

  const columns = useMemo<ColumnDef<Organization>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("common.organization"),
        size: 280,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/organization/${row.original.id}`}
              dir="auto"
              className="block truncate font-medium text-foreground hover:text-brand hover:underline"
            >
              {dash(row.original.name)}
            </Link>
            <div className="truncate text-xs text-subtle">
              #{row.original.id}
            </div>
          </div>
        ),
      },
      {
        id: "address",
        accessorKey: "address",
        header: t("common.address"),
        size: 300,
        cell: ({ row }) => (
          <span dir="auto" className="truncate text-muted-foreground">
            {dash(row.original.address)}
          </span>
        ),
      },
      {
        id: "labels",
        header: t("deals.field.labels"),
        size: 180,
        enableSorting: false,
        cell: ({ row }) => (
          <LabelChips entity="organization" labels={row.original.labels} />
        ),
      },
      {
        id: "persons",
        accessorKey: "personCount",
        header: t("common.contacts"),
        size: 110,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums text-foreground">
            {row.original.personCount ?? 0}
          </span>
        ),
      },
      {
        id: "deals",
        accessorKey: "dealCount",
        header: t("common.deals"),
        size: 90,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums text-foreground">
            {row.original.dealCount ?? 0}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("common.actions"),
        size: 110,
        enableSorting: false,
        enableResizing: false,
        cell: ({ row }) => (
          <OrgFormDialog
            org={row.original}
            trigger={
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                <Pencil className="me-1 h-3.5 w-3.5" />
                {t("common.edit")}
              </Button>
            }
          />
        ),
      },
    ],
    [],
  );
  const allColumns = useMemo(() => [...columns, ...extraColumns<Organization>(t, ORG_EXTRA)], [columns, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {filtersOpen && <SummaryCards cards={summary} />}

      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
            <div className="relative w-full sm:w-auto">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input
                value={query}
                onChange={(e) => {
                  setFilters({ query: e.target.value });
                  setPage(1);
                }}
                placeholder={t("contacts.searchOrgs")}
                className="w-full ps-8 sm:w-[240px]"
              />
            </div>

            {query.trim() !== "" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  setFilters({ query: "" });
                  setPage(1);
                }}
              >
                <X className="me-1 h-4 w-4" />
                {t("common.clear")}
              </Button>
            )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "table" ? (
          <DataTable
            data={items}
            columns={allColumns}
            getRowId={(o) => String(o.id)}
            highlightRowId={focusId != null ? String(focusId) : null}
            preferenceKey="organizations"
            defaultColumnOrder={[
              "name",
              "address",
              "labels",
              "persons",
              "deals",
              ...extraColumnIds(ORG_EXTRA),
              "actions",
            ]}
            defaultColumnVisibility={ORG_EXTRA_HIDDEN}
            isLoading={isLoading}
            isError={isError}
            loadingMessage={t("contacts.loadingOrgs")}
            errorMessage={t("contacts.orgsFailed")}
            emptyMessage={t("contacts.orgsEmpty")}
            server={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: (s) => {
                setPageSize(s);
                setPage(1);
              },
              sorting,
              onSortingChange: (next) => {
                setSorting(next);
                setPage(1);
              },
            }}
          />
        ) : (
          <CardsGrid
            isLoading={isLoading}
            isEmpty={items.length === 0}
            emptyMessage={t("contacts.orgsEmpty")}
          >
            {items.map((org) => (
              <OrgCard key={org.id} org={org} />
            ))}
          </CardsGrid>
        )}
      </div>
    </div>
  );
}

function OrgCard({ org }: { org: Organization }) {
  const { t } = useI18n();
  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div dir="auto" className="truncate font-semibold text-foreground">
              {org.name}
            </div>
            <div className="text-xs text-subtle">
              {t("contacts.orgCardCounts", { contacts: org.personCount ?? 0, deals: org.dealCount ?? 0 })}
            </div>
          </div>
        </div>
        <OrgFormDialog
          org={org}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          }
        />
      </div>
      <div className="mt-3 text-sm text-muted-foreground">
        {org.address ? (
          <span dir="auto">{org.address}</span>
        ) : (
          <span className="text-xs text-subtle">{t("contacts.noAddress")}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared cards container
// ---------------------------------------------------------------------------

function CardsGrid({
  isLoading,
  isEmpty,
  emptyMessage,
  children,
}: {
  isLoading: boolean;
  isEmpty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="me-2 h-5 w-5 animate-spin text-brand" />
        {t("common.loading")}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {children}
      </div>
    </div>
  );
}
