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
import { format } from "date-fns";
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
    const data = (e as { data?: { needsReassign?: boolean; openDealsCount?: number } })
      .data;
    if (data?.needsReassign) return data.openDealsCount ?? 0;
  }
  return null;
}

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().optional().or(z.literal("")),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .regex(/[A-Za-z]/, "Must contain a letter")
    .regex(/[0-9]/, "Must contain a number"),
  isAdmin: z.boolean(),
  sendInvite: z.boolean(),
});

type CreateUserForm = z.infer<typeof createUserSchema>;

function AddUserDialog() {
  const createUser = useCreateUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
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
      toast({ title: "User created" });
      form.reset();
      setOpen(false);
    } catch (e) {
      toast({
        title: "Could not create user",
        description: serverError(e, "Please try again."),
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
        <Plus className="me-2 h-4 w-4" /> Add User
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">New user</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Full name" />
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
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      {...field}
                      placeholder="name@company.com"
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
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Optional" />
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
                  <FormLabel>Temporary password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    At least 8 characters with a letter and a number.
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
                    <FormLabel className="text-sm">Administrator</FormLabel>
                    <FormDescription>
                      Can manage users and import data.
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
                    <FormLabel className="text-sm">
                      Email login details
                    </FormLabel>
                    <FormDescription>
                      Send the user their email and password.
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
                Create user
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const editUserSchema = z.object({
  name: z.string().min(1, "Required"),
  phone: z.string().optional().or(z.literal("")),
  isAdmin: z.boolean(),
});
type EditUserForm = z.infer<typeof editUserSchema>;

function EditUserDialog({ user, isSelf }: { user: User; isSelf: boolean }) {
  const updateUser = useUpdateUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
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
      toast({ title: "User updated" });
      setOpen(false);
    } catch (e) {
      toast({
        title: "Could not update user",
        description: serverError(e, "Please try again."),
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
        Edit
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Edit user</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Full name" />
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
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Optional" />
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
                  <FormLabel>Role</FormLabel>
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
                      <SelectItem value="admin">Administrator</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {isSelf
                      ? "You can't change your own role."
                      : "Administrators can manage users and import data."}
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
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function StatusActions({ user, isSelf }: { user: User; isSelf: boolean }) {
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
        title: activeFlag ? "User reactivated" : "User deactivated",
        ...(reassignOwnerId != null
          ? { description: "Their open deals were reassigned." }
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
        title: "Could not update user",
        description: serverError(e, "Please try again."),
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
              title={
                isSelf ? "You cannot deactivate your own account" : undefined
              }
            >
              <UserX className="me-1.5 h-3.5 w-3.5" />
              Deactivate
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deactivate {user.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                They will be signed out and unable to log in until reactivated.
                Their data and history are kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
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
                Deactivate
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
      className="h-8 border-brand-200 text-brand hover:bg-brand-subtle"
    >
      {updateUser.isPending ? (
        <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <UserCheck className="me-1.5 h-3.5 w-3.5" />
      )}
      Reactivate
    </Button>
  );
}

function ResendCredentialsButton({ user }: { user: User }) {
  const resend = useResendUserCredentials();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const onConfirm = async () => {
    try {
      const res = await resend.mutateAsync({ id: user.id });
      toast({ title: res.message || "Login details sent" });
      setOpen(false);
    } catch (e) {
      toast({
        title: "Could not send login details",
        description: serverError(e, "Please try again."),
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
          Resend login
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Resend login details to {user.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This sets a new temporary password and emails it to {user.email}.
            Their current password will stop working and any active sessions
            will be signed out.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
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
            Send details
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
        header: "Name",
        size: 250,
        cell: ({ row }) => {
          const u = row.original;
          const isSelf = currentUser?.id === u.id;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-semibold text-brand">
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
                      aria-label="Admin"
                    />
                  )}
                  {isSelf && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      You
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-subtle">#{u.id}</div>
              </div>
            </div>
          );
        },
      },
      {
        id: "email",
        accessorKey: "email",
        header: "Email",
        size: 240,
        cell: ({ row }) => (
          <a
            href={`mailto:${row.original.email}`}
            className="truncate text-brand hover:underline"
          >
            {row.original.email}
          </a>
        ),
      },
      {
        id: "phone",
        accessorKey: "phone",
        header: "Phone",
        size: 150,
        cell: ({ row }) => (
          <span dir="auto" className="truncate text-muted-foreground">
            {dash(row.original.phone)}
          </span>
        ),
      },
      {
        id: "role",
        accessorKey: "isAdmin",
        header: "Role",
        size: 110,
        cell: ({ row }) => (
          <span
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium",
              row.original.isAdmin
                ? "bg-brand-subtle text-brand"
                : "bg-muted text-muted-foreground",
            )}
          >
            {row.original.isAdmin ? "Admin" : "User"}
          </span>
        ),
      },
      {
        id: "team",
        accessorKey: "teamName",
        header: "Team",
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
        header: "Joined",
        size: 130,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {format(new Date(row.original.created), "MMM d, yyyy")}
          </span>
        ),
      },
      {
        id: "lastLogin",
        accessorKey: "lastLogin",
        header: "Last login",
        size: 140,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.lastLogin
              ? format(new Date(row.original.lastLogin), "MMM d, yyyy")
              : "Never"}
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "activeFlag",
        header: "Status",
        size: 110,
        cell: ({ row }) => (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              row.original.activeFlag
                ? "bg-success-subtle text-success"
                : "bg-destructive-subtle text-destructive",
            )}
          >
            {row.original.activeFlag ? "Active" : "Inactive"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
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
    [currentUser],
  );

  const cards = [
    { label: "Total", value: summary.total, dot: "bg-gray-400" },
    { label: "Active", value: summary.active, dot: "bg-success" },
    { label: "Admins", value: summary.admins, dot: "bg-brand-500" },
    { label: "Inactive", value: summary.inactive, dot: "bg-destructive" },
  ];

  const hasFilters =
    query.trim() !== "" || statusFilter !== ALL || roleFilter !== ALL;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-3">
        <div>
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">
            User Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Create teammates and control who can access the CRM.
          </p>
        </div>
        <AddUserDialog />
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pb-3 pt-3 sm:grid-cols-4">
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

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="relative w-full sm:w-auto">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone…"
            className="w-full ps-8 sm:w-[240px]"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All roles</SelectItem>
            <SelectItem value="admin">Admins</SelectItem>
            <SelectItem value="user">Users</SelectItem>
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
            Clear
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
          loadingMessage="Loading users…"
          emptyMessage="No users match the current filters."
        />
      </div>
    </div>
  );
}
