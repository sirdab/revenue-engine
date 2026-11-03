import { useState } from "react";
import {
  useAdminListTeams,
  getAdminListTeamsQueryKey,
  getListTeamsQueryKey,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
  useListUsers,
  getListUsersQueryKey,
  getListUserOptionsQueryKey,
  getListDealOwnersQueryKey,
  useUpdateUser,
} from "@workspace/api-client-react";
import type { Team, TeamMember, User } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Loader2,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EditableText } from "@/components/deals/inline-edit";
import { SectionCard } from "@/components/settings/section-card";
import { errorMessage } from "@/lib/api-error";
import { useI18n } from "@/lib/i18n/i18n";

// Settings → Teams: admin CRUD for the ownership grouping layer, plus
// membership. Membership is one primary team per user — assigning/removing a
// member is just a users.teamId update, so we reuse useUpdateUser rather than
// a dedicated membership API. Every mutation
// invalidates both the admin key and the picker key (and the users key on
// membership changes) so the panel stays in sync without a manual refresh.

function TeamCard({
  team,
  candidates,
  busy,
  onRename,
  onToggle,
  onDelete,
  onAddMember,
  onRemoveMember,
}: {
  team: Team;
  candidates: User[];
  busy: boolean;
  onRename: (name: string) => void;
  onToggle: () => void;
  onDelete: () => void;
  onAddMember: (userId: number) => void;
  onRemoveMember: (member: TeamMember) => void;
}) {
  const { t, tPlural, formatNumber } = useI18n();
  return (
    <li
      className={cn(
        "group px-5 py-3.5",
        !team.active && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <EditableText
            value={team.name}
            onCommit={(next) => next.trim() && onRename(next.trim())}
            className="-ms-1 text-sm font-semibold text-slate-800"
          />
        </div>
        {!team.active && (
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {t("common.archived")}
          </span>
        )}
        <span className="shrink-0 text-xs tabular-nums text-slate-400">
          {team.memberCount === 0
            ? t("settings.teams.noMembers")
            : tPlural("settings.teams.memberCount", team.memberCount, {
                count: formatNumber(team.memberCount),
              })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          onClick={onToggle}
          aria-label={team.active ? t("settings.teams.archive") : t("settings.teams.restore")}
          title={team.active ? t("settings.teams.archiveHint") : t("common.restore")}
          className="h-7 w-7 shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-slate-600 group-hover:opacity-100"
        >
          {team.active ? (
            <Archive className="h-3.5 w-3.5" />
          ) : (
            <ArchiveRestore className="h-3.5 w-3.5" />
          )}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={t("settings.teams.deleteAria", { name: team.name })}
              className="h-7 w-7 shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings.teams.deleteTitle", { name: team.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {team.memberCount > 0
                  ? tPlural(
                      "settings.teams.deleteWithMembers",
                      team.memberCount,
                    )
                  : t("settings.teams.deleteNoMembers")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {t("settings.teams.deleteConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {team.members.map((member) => (
          <span
            key={member.id}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 ps-2.5 pe-1 text-xs text-slate-700"
          >
            {member.name}
            <button
              type="button"
              disabled={busy}
              aria-label={t("settings.teams.removeMember", { name: member.name })}
              onClick={() => onRemoveMember(member)}
              className="rounded-full p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-red-600 disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Combobox
          items={candidates.map((u) => ({
            value: String(u.id),
            label: u.name,
          }))}
          value=""
          onChange={(v) => v && onAddMember(Number(v))}
          placeholder={t("settings.teams.addMemberPlaceholder")}
          triggerClassName="h-7 w-40 text-xs"
        />
      </div>
    </li>
  );
}

export function TeamsSettings() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");

  const { data, isLoading, isError } = useAdminListTeams({
    query: { queryKey: getAdminListTeamsQueryKey() },
  });
  const { data: users } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });

  const invalidateTeams = () => {
    queryClient.invalidateQueries({ queryKey: getAdminListTeamsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTeamsQueryKey() });
  };
  const invalidateTeamsAndUsers = () => {
    invalidateTeams();
    queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    // Owner/assignee pickers read the slim list, which carries teamName — a
    // team reassignment here must refresh them too.
    queryClient.invalidateQueries({ queryKey: getListUserOptionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListDealOwnersQueryKey() });
  };
  const onError = (err: unknown) =>
    toast({ title: errorMessage(err), variant: "destructive" });

  const create = useCreateTeam({
    mutation: { onSuccess: invalidateTeams, onError },
  });
  const update = useUpdateTeam({
    mutation: { onSuccess: invalidateTeams, onError },
  });
  const remove = useDeleteTeam({
    mutation: { onSuccess: invalidateTeamsAndUsers, onError },
  });
  // Membership assignment reuses the users route: teamId set = add, null = remove.
  const assign = useUpdateUser({
    mutation: { onSuccess: invalidateTeamsAndUsers, onError },
  });
  const busy =
    create.isPending ||
    update.isPending ||
    remove.isPending ||
    assign.isPending;

  const submit = () => {
    const name = draft.trim();
    // Enter bypasses the button's disabled state, and team names aren't
    // unique, so a repeat while the first create is in flight makes two.
    if (!name || busy) return;
    create.mutate({ data: { name } }, { onSuccess: () => setDraft("") });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <header className="mb-5">
        <h1 className="font-heading text-xl font-bold text-slate-900">{t("settings.teams.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("settings.teams.subtitle")}
        </p>
      </header>

      <SectionCard
        title={t("settings.teams.title")}
        description={t("settings.teams.cardDescription")}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={t("settings.teams.addPlaceholder")}
            className="h-8 max-w-sm"
            maxLength={120}
          />
          <Button
            size="sm"
            onClick={submit}
            disabled={!draft.trim() || busy}
            className="h-8 bg-teal-600 text-white hover:bg-teal-700"
          >
            <Plus className="me-1 h-3.5 w-3.5" /> {t("common.add")}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("settings.teams.loading")}
          </div>
        ) : isError || !data ? (
          <div className="px-5 py-10 text-center text-sm text-red-600">
            {t("settings.teams.loadFailed")}
          </div>
        ) : data.teams.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Users className="mx-auto mb-2 h-6 w-6 text-slate-300" />
            <p className="text-sm text-slate-500">{t("settings.teams.empty")}</p>
            <p className="mt-1 text-xs text-slate-400">
              {t("settings.teams.emptyHint")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                // Only offer users not already on this team.
                candidates={(users ?? []).filter((u) => u.teamId !== team.id)}
                busy={busy}
                onRename={(name) =>
                  update.mutate({ id: team.id, data: { name } })
                }
                onToggle={() =>
                  update.mutate({
                    id: team.id,
                    data: { active: !team.active },
                  })
                }
                onDelete={() => remove.mutate({ id: team.id })}
                onAddMember={(userId) =>
                  assign.mutate({ id: userId, data: { teamId: team.id } })
                }
                onRemoveMember={(member) =>
                  assign.mutate({ id: member.id, data: { teamId: null } })
                }
              />
            ))}
          </ul>
        )}

        <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
          {t("settings.teams.footnote")}
        </p>
      </SectionCard>
    </div>
  );
}
