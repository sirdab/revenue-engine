import { useEffect, useMemo, useState } from "react";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  useResendUserCredentials,
  getListUsersQueryKey,
  getListUserOptionsQueryKey,
  getListDealOwnersQueryKey,
} from "@workspace/api-client-react";
import type { User } from "@workspace/api-client-react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invalidateDealCollections } from "@/lib/deal-collections";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Loader2,
  Shield,
  Plus,
  Search,
  UserCheck,
  UserX,
  X,
  Mail,
  Pencil,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/shared/data-table";
import { ReassignDealsDialog } from "@/components/admin/reassign-deals-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useI18n, type Translate } from "@/lib/i18n/i18n";

// Creating, editing, or deactivating a user changes every user-picker list.
// The admin table reads the full list (getListUsersQueryKey); the app's owner
// and assignee pickers read the slim active-only lists (options / deal-owners).
// Invalidate all three together so a change here refreshes the pickers too.
function invalidateUserPickers(queryClient: QueryClient): Promise<void[]> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListUserOptionsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListDealOwnersQueryKey() }),
  ]);
}

function serverError(e: unknown, fallback: string): string {
  if (e && typeof e === "object") {
    const data = (e as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const msg = (data as { error?: unknown }).error;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

// Deactivating a user who still owns open deals gets a structured 409 back
// instead of the generic error above — this opens the reassign dialog.
function needsDealReassign(e: unknown): number | null {
  if (e && typeof e === "object" && (e as { status?: number }).status === 409) {
    const data = (
      e as { data?: { needsReassign?: boolean; openDealsCount?: number } }
    ).data;
    if (data?.needsReassign) return data.openDealsCount ?? 0;
  }
  return null;
}

const createUserSchema = (t: Translate) =>
  z.object({
    name: z.string().min(1, t("contacts.nameRequired")),
    email: z.string().email(t("admin.users.validation.email")),
    phone: z.string().optional().or(z.literal("")),
    password: z
      .string()
      .min(8, t("admin.users.validation.passwordMin"))
      .regex(/[A-Za-z]/, t("admin.users.validation.letter"))
      .regex(/[0-9]/, t("admin.users.validation.number")),
    isAdmin: z.boolean(),
    sendInvite: z.boolean(),
  });

type CreateUserForm = z.infer<ReturnType<typeof createUserSchema>>;

function AddUserDialog() {
  const { t } = useI18n();
  const createUser = useCreateUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema(t)),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      password: "",
      isAdmin: false,
      sendInvite: true,
    },
  });

  const onSubmit = async (data: CreateUserForm) => {
    try {
      await createUser.mutateAsync({
        data: {
          name: data.name,
          email: data.email,
          password: data.password,
          phone: data.phone || undefined,
          isAdmin: data.isAdmin,
          sendInvite: data.sendInvite,
        },
      });
      await invalidateUserPickers(queryClient);
      toast({ title: t("admin.users.created") });
      form.reset();
      setOpen(false);
    } catch (e) {
      toast({
        title: t("admin.users.createFailed"),
        description: serverError(e, t("admin.users.tryAgain")),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset();
      }}
    >
      <Button
        className="bg-primary hover:bg-primary-hover text-primary-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="me-2 h-4 w-4" /> {t("admin.users.addUser")}
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.users.newUser")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.name")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      dir="auto"
                      placeholder={t("admin.users.fullName")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.email")}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      dir="ltr"
                      {...field}
                      placeholder={t("admin.users.emailPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.phone")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="tel"
                      dir="ltr"
                      placeholder={t("common.optional")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("admin.users.tempPassword")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("admin.users.passwordHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isAdmin"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <FormLabel className="text-body-quiet">
                      {t("admin.users.administrator")}
                    </FormLabel>
                    <FormDescription>
                      {t("admin.users.administratorHint")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sendInvite"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <FormLabel className="text-body-quiet">
                      {t("admin.users.sendInvite")}
                    </FormLabel>
                    <FormDescription>
                      {t("admin.users.sendInviteHint")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="submit"
                disabled={createUser.isPending}
                className="bg-primary hover:bg-primary-hover text-primary-foreground"
              >
                {createUser.isPending && (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                )}
                {t("admin.users.createUser")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const editUserSchema = (t: Translate) =>
  z.object({
    name: z.string().min(1, t("admin.users.validation.required")),
    phone: z.string().optional().or(z.literal("")),
    isAdmin: z.boolean(),
  });
type EditUserForm = z.infer<ReturnType<typeof editUserSchema>>;

function EditUserDialog({ user, isSelf }: { user: User; isSelf: boolean }) {
  const { t } = useI18n();
  const updateUser = useUpdateUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema(t)),
    defaultValues: {
      name: user.name,
      phone: user.phone ?? "",
      isAdmin: user.isAdmin,
    },
  });

  // Refresh the form to the user's current values whenever the dialog opens.
  useEffect(() => {
    if (open) {
      form.reset({
        name: user.name,
        phone: user.phone ?? "",
        isAdmin: user.isAdmin,
      });
    }
  }, [open, user, form]);

  const onSubmit = async (data: EditUserForm) => {
    try {
      await updateUser.mutateAsync({
        id: user.id,
        data: {
          name: data.name,
          phone: data.phone || null,
          // Self-role changes are blocked in the UI; never trust that — keep
          // your own role unchanged on submit too.
          isAdmin: isSelf ? user.isAdmin : data.isAdmin,
        },
      });
      await invalidateUserPickers(queryClient);
      toast({ title: t("admin.users.updated") });
      setOpen(false);
    } catch (e) {
      toast({
        title: t("admin.users.updateFailed"),
        description: serverError(e, t("admin.users.tryAgain")),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 border-border text-muted-foreground hover:bg-gray-alpha-50"
      >
        <Pencil className="me-1.5 h-3.5 w-3.5" />
        {t("common.edit")}
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.users.editUser")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.name")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      dir="auto"
                      placeholder={t("admin.users.fullName")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.phone")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="tel"
                      dir="ltr"
                      placeholder={t("common.optional")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isAdmin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("admin.users.role")}</FormLabel>
                  <Select
                    value={field.value ? "admin" : "member"}
                    onValueChange={(v) => field.onChange(v === "admin")}
                    disabled={isSelf}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="admin">
                        {t("admin.users.administrator")}
                      </SelectItem>
                      <SelectItem value="member">
                        {t("admin.users.member")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {isSelf
                      ? t("admin.users.cannotChangeOwnRole")
                      : t("admin.users.administratorsHint")}
                  </FormDescription>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="submit"
                disabled={updateUser.isPending}
                className="bg-primary hover:bg-primary-hover text-primary-foreground"
              >
                {updateUser.isPending && (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                )}
                {t("admin.users.saveChanges")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function StatusActions({ user, isSelf }: { user: User; isSelf: boolean }) {
  const { t, tNode } = useI18n();
  const updateUser = useUpdateUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reassign, setReassign] = useState<{ openDealsCount: number } | null>(
    null,
  );

  const setActive = async (activeFlag: boolean, reassignOwnerId?: number) => {
    try {
      await updateUser.mutateAsync({
        id: user.id,
        data: {
          activeFlag,
          ...(reassignOwnerId != null ? { reassignOwnerId } : {}),
        },
      });
      await invalidateUserPickers(queryClient);
      if (reassignOwnerId != null) {
        // Reassignment rewrites owners across deals — refresh every deal view.
        invalidateDealCollections(queryClient);
      }
      toast({
        title: activeFlag
          ? t("admin.users.reactivated")
          : t("admin.users.deactivated"),
        ...(reassignOwnerId != null
          ? { description: t("admin.users.dealsReassigned") }
          : {}),
      });
      setOpen(false);
      setReassign(null);
    } catch (e) {
      const openDealsCount = needsDealReassign(e);
      if (openDealsCount != null) {
        setOpen(false);
        setReassign({ openDealsCount });
        return;
      }
      toast({
        title: t("admin.users.updateFailed"),
        description: serverError(e, t("admin.users.tryAgain")),
        variant: "destructive",
      });
    }
  };

  if (user.activeFlag) {
    return (
      <>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isSelf || updateUser.isPending}
              className="h-8 border-destructive/30 text-destructive hover:bg-destructive-subtle hover:text-destructive disabled:opacity-40"
              title={isSelf ? t("admin.users.cannotDeactivateSelf") : undefined}
            >
              <UserX className="me-1.5 h-3.5 w-3.5" />
              {t("admin.users.deactivate")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {tNode("admin.users.deactivateTitle", {
                  name: <bdi>{user.name}</bdi>,
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("admin.users.deactivateBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  setActive(false);
                }}
                className="bg-destructive hover:bg-destructive focus:ring-destructive"
              >
                {updateUser.isPending && (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                )}
                {t("admin.users.deactivate")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {reassign && (
          <ReassignDealsDialog
            user={user}
            openDealsCount={reassign.openDealsCount}
            onClose={() => setReassign(null)}
            onConfirm={(reassignOwnerId) => setActive(false, reassignOwnerId)}
            confirming={updateUser.isPending}
          />
        )}
      </>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={updateUser.isPending}
      onClick={() => setActive(true)}
      className="h-8"
    >
      {updateUser.isPending ? (
        <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <UserCheck className="me-1.5 h-3.5 w-3.5" />
      )}
      {t("admin.users.reactivate")}
    </Button>
  );
}

function ResendCredentialsButton({ user }: { user: User }) {
  const { t, tNode } = useI18n();
  const resend = useResendUserCredentials();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const onConfirm = async () => {
    try {
      const res = await resend.mutateAsync({ id: user.id });
      toast({ title: res.message || t("admin.users.loginSent") });
      setOpen(false);
    } catch (e) {
      toast({
        title: t("admin.users.loginSendFailed"),
        description: serverError(e, t("admin.users.tryAgain")),
        variant: "destructive",
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={resend.isPending}
          className="h-8 border-border text-muted-foreground hover:bg-gray-alpha-50"
        >
          {resend.isPending ? (
            <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Mail className="me-1.5 h-3.5 w-3.5" />
          )}
          {t("admin.users.resendLogin")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {tNode("admin.users.resendTitle", {
              name: <bdi>{user.name}</bdi>,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tNode("admin.users.resendBody", {
              email: <bdi dir="ltr">{user.email}</bdi>,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="bg-primary text-primary-foreground hover:bg-primary-hover focus:ring-ring"
          >
            {resend.isPending && (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            )}
            {t("admin.users.sendDetails")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const ALL = "__all__";

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

export default function AdminUsersPage() {
  const { data: users, isLoading } = useListUsers();
  const { user: currentUser } = useAuth();
  const { t, formatDate, formatNumber } = useI18n();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [roleFilter, setRoleFilter] = useState(ALL);

  const summary = useMemo(() => {
    const list = users ?? [];
    return {
      total: list.length,
      active: list.filter((u) => u.activeFlag).length,
      admins: list.filter((u) => u.isAdmin).length,
      inactive: list.filter((u) => !u.activeFlag).length,
    };
  }, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      if (statusFilter === "active" && !u.activeFlag) return false;
      if (statusFilter === "inactive" && u.activeFlag) return false;
      if (roleFilter === "admin" && !u.isAdmin) return false;
      if (roleFilter === "user" && u.isAdmin) return false;
      if (
        q &&
        !`${u.name} ${u.email} ${u.phone ?? ""}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [users, query, statusFilter, roleFilter]);

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("common.name"),
        size: 250,
        cell: ({ row }) => {
          const u = row.original;
          const isSelf = currentUser?.id === u.id;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-caption font-semibold text-brand">
                {initials(u.name)}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    dir="auto"
                    className="truncate font-medium text-foreground"
                  >
                    {u.name}
                  </span>
                  {u.isAdmin && (
                    <Shield
                      className="h-3.5 w-3.5 shrink-0 text-brand"
                      aria-label={t("admin.users.admin")}
                    />
                  )}
                  {isSelf && (
                    <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
                      {t("admin.users.you")}
                    </span>
                  )}
                </div>
                <div className="truncate text-caption-quiet text-subtle">
                  #{u.id}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "email",
        accessorKey: "email",
        header: t("common.email"),
        size: 240,
        cell: ({ row }) => (
          <a
            href={`mailto:${row.original.email}`}
            dir="ltr"
            className="truncate text-brand hover:underline"
          >
            {row.original.email}
          </a>
        ),
      },
      {
        id: "phone",
        accessorKey: "phone",
        header: t("common.phone"),
        size: 150,
        cell: ({ row }) => (
          <span dir="ltr" className="truncate text-muted-foreground">
            {dash(row.original.phone)}
          </span>
        ),
      },
      {
        id: "role",
        accessorKey: "isAdmin",
        header: t("admin.users.role"),
        size: 110,
        cell: ({ row }) => (
          <span
            className={cn(
              "rounded-sm px-2 py-0.5 text-caption",
              row.original.isAdmin
                ? "bg-brand-subtle text-brand"
                : "bg-muted text-muted-foreground",
            )}
          >
            {row.original.isAdmin
              ? t("admin.users.admin")
              : t("admin.users.user")}
          </span>
        ),
      },
      {
        id: "team",
        accessorKey: "teamName",
        header: t("common.team"),
        size: 150,
        cell: ({ row }) =>
          row.original.teamName ? (
            <span dir="auto" className="truncate text-muted-foreground">
              {row.original.teamName}
            </span>
          ) : (
            <span className="text-subtle">—</span>
          ),
      },
      {
        id: "created",
        accessorKey: "created",
        header: t("admin.users.joined"),
        size: 130,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.created)}
          </span>
        ),
      },
      {
        id: "lastLogin",
        accessorKey: "lastLogin",
        header: t("admin.users.lastLogin"),
        size: 140,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.lastLogin
              ? formatDate(row.original.lastLogin)
              : t("admin.users.never")}
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "activeFlag",
        header: t("common.status"),
        size: 110,
        cell: ({ row }) => (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-caption",
              row.original.activeFlag
                ? "bg-success-subtle text-success"
                : "bg-destructive-subtle text-destructive",
            )}
          >
            {row.original.activeFlag
              ? t("admin.users.active")
              : t("admin.users.inactive")}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("common.actions"),
        size: 340,
        enableSorting: false,
        enableResizing: false,
        meta: { align: "right" },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            <EditUserDialog
              user={row.original}
              isSelf={currentUser?.id === row.original.id}
            />
            {row.original.activeFlag && (
              <ResendCredentialsButton user={row.original} />
            )}
            <StatusActions
              user={row.original}
              isSelf={currentUser?.id === row.original.id}
            />
          </div>
        ),
      },
    ],
    [currentUser, t, formatDate],
  );

  const cards = [
    {
      id: "total",
      label: t("common.total"),
      value: summary.total,
      dot: "bg-gray-400",
    },
    {
      id: "active",
      label: t("admin.users.stat.active"),
      value: summary.active,
      dot: "bg-success",
    },
    {
      id: "admins",
      label: t("admin.users.stat.admins"),
      value: summary.admins,
      dot: "bg-brand-500",
    },
    {
      id: "inactive",
      label: t("admin.users.stat.inactive"),
      value: summary.inactive,
      dot: "bg-destructive",
    },
  ];

  const hasFilters =
    query.trim() !== "" || statusFilter !== ALL || roleFilter !== ALL;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-3">
        <div>
          <h1 className="text-heading-sm text-foreground">
            {t("admin.users.title")}
          </h1>
          <p className="text-body-quiet text-muted-foreground">
            {t("admin.users.subtitle")}
          </p>
        </div>
        <AddUserDialog />
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pb-3 pt-3 sm:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.id}
            className="rounded-2xl bg-card px-4 py-3 shadow-card"
          >
            <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", card.dot)} />
              {card.label}
            </div>
            <div className="mt-1 text-heading-sm tabular-nums text-foreground">
              {formatNumber(card.value)}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="relative w-full sm:w-auto">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.users.searchPlaceholder")}
            className="w-full ps-8 sm:w-[240px]"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder={t("admin.users.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("admin.users.allStatuses")}</SelectItem>
            <SelectItem value="active">{t("admin.users.active")}</SelectItem>
            <SelectItem value="inactive">
              {t("admin.users.inactive")}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder={t("admin.users.allRoles")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("admin.users.allRoles")}</SelectItem>
            <SelectItem value="admin">{t("admin.users.admins")}</SelectItem>
            <SelectItem value="user">{t("admin.users.users")}</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setQuery("");
              setStatusFilter(ALL);
              setRoleFilter(ALL);
            }}
          >
            <X className="me-1 h-4 w-4" />
            {t("common.clear")}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <DataTable
          data={filtered}
          columns={columns}
          getRowId={(u) => String(u.id)}
          preferenceKey="adminUsers"
          defaultColumnOrder={[
            "name",
            "email",
            "phone",
            "role",
            "team",
            "created",
            "lastLogin",
            "status",
            "actions",
          ]}
          isLoading={isLoading}
          loadingMessage={t("admin.users.loading")}
          emptyMessage={t("admin.users.empty")}
        />
      </div>
    </div>
  );
}
