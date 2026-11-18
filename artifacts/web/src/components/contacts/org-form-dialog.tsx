import React, { useEffect, useState } from "react";
import {
  useCreateOrganization,
  useUpdateOrganization,
  getListOrganizationsQueryKey,
} from "@workspace/api-client-react";
import type { Organization } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { LabelsEditor } from "@/components/shared/labels-editor";
import { useI18n, type Translate } from "@/lib/i18n/i18n";

export const orgSchema = (t: Translate) =>
  z.object({
    name: z.string().min(1, t("contacts.nameRequired")),
    address: z.string().optional().or(z.literal("")),
  });
type OrgValues = z.infer<ReturnType<typeof orgSchema>>;

/**
 * Organization create/edit form. Rendered both from the Contacts tab
 * (trigger-based, self-managed open) and — via the additive controlled props —
 * from the New Deal dialog's Organization picker, where it opens
 * programmatically, pre-fills a typed name, and reports the created record back
 * through `onCreated`.
 */
export function OrgFormDialog({
  org,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialName,
  onCreated,
}: {
  org?: Organization;
  trigger?: React.ReactNode;
  /** Controlled open state; when provided the component defers to it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Seeds the name field when creating (ignored when editing). */
  initialName?: string;
  /** Fired after a successful create (not edit). */
  onCreated?: (org: Organization) => void;
}) {
  const { t } = useI18n();
  const isEdit = !!org;
  const createOrg = useCreateOrganization();
  const updateOrg = useUpdateOrganization();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) controlledOnOpenChange?.(next);
    else setUncontrolledOpen(next);
  };
  const [labels, setLabels] = useState<string[]>(org?.labels ?? []);

  const defaults = (): OrgValues => ({
    name: org?.name ?? initialName ?? "",
    address: org?.address ?? "",
  });

  const form = useForm<OrgValues>({
    resolver: zodResolver(orgSchema(t)),
    defaultValues: defaults(),
  });

  useEffect(() => {
    if (open) {
      form.reset(defaults());
      setLabels(org?.labels ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = async (data: OrgValues) => {
    try {
      if (isEdit && org) {
        await updateOrg.mutateAsync({
          id: org.id,
          data: {
            name: data.name,
            address: data.address || null,
            labels: labels.length ? labels : null,
          },
        });
        toast({ title: t("contacts.orgUpdated") });
      } else {
        const created = await createOrg.mutateAsync({
          data: {
            name: data.name,
            address: data.address || undefined,
            labels: labels.length ? labels : undefined,
          },
        });
        toast({ title: t("contacts.orgCreated") });
        onCreated?.(created);
      }
      queryClient.invalidateQueries({
        queryKey: getListOrganizationsQueryKey(),
      });
      // Same as in PersonFormDialog: the grids read from the /search cache
      // keys. Persons are included because they display the org's name.
      queryClient.invalidateQueries({ queryKey: ["organizations", "search"] });
      queryClient.invalidateQueries({ queryKey: ["persons", "search"] });
      setOpen(false);
      if (!isEdit) form.reset(defaults());
    } catch (e) {
      toast({
        title: isEdit
          ? t("contacts.orgUpdateFailed")
          : t("contacts.orgCreateFailed"),
        variant: "destructive",
      });
    }
  };

  const pending = createOrg.isPending || updateOrg.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("contacts.editOrgTitle") : t("contacts.addOrgTitle")}
          </DialogTitle>
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
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.address")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <div className="text-body font-medium text-foreground">{t("deals.field.labels")}</div>
              <LabelsEditor
                entity="organization"
                labels={labels}
                onChange={setLabels}
                inModal
              />
            </div>
            <Button
              type="submit"
              disabled={pending}
              className="w-full"
            >
              {pending ? t("contacts.savingDots") : t("common.save")}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
