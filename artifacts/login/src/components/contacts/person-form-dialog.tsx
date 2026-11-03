import React, { useEffect, useState } from "react";
import {
  useCreatePerson,
  useUpdatePerson,
  getListPersonsQueryKey,
} from "@workspace/api-client-react";
import type { Person } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AsyncSelect } from "@/components/ui/async-select";
import { loadOrganizationOptions } from "@/lib/contacts-search-api";
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

export const personSchema = (t: Translate) =>
  z.object({
    name: z.string().min(1, t("contacts.nameRequired")),
    jobTitle: z.string().optional().or(z.literal("")),
    email: z.string().email({ message: t("auth.validation.email") }).optional().or(z.literal("")),
    phone: z.string().optional().or(z.literal("")),
    organizationId: z.string().optional(),
  });
type PersonValues = z.infer<ReturnType<typeof personSchema>>;

/**
 * Person create/edit form. Rendered both from the Contacts tab (trigger-based,
 * self-managed open) and — via the additive controlled props — from the New
 * Deal dialog's Person picker, where it opens programmatically, pre-fills a
 * typed name, and reports the created record back through `onCreated`.
 */
export function PersonFormDialog({
  person,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialName,
  onCreated,
}: {
  person?: Person;
  trigger?: React.ReactNode;
  /** Controlled open state; when provided the component defers to it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Seeds the name field when creating (ignored when editing). */
  initialName?: string;
  /** Fired after a successful create (not edit). */
  onCreated?: (person: Person) => void;
}) {
  const { t } = useI18n();
  const isEdit = !!person;
  const createPerson = useCreatePerson();
  const updatePerson = useUpdatePerson();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) controlledOnOpenChange?.(next);
    else setUncontrolledOpen(next);
  };
  const [orgLabel, setOrgLabel] = useState<string | null>(
    person?.organizationName ?? null,
  );
  const [labels, setLabels] = useState<string[]>(person?.labels ?? []);

  const defaults = (): PersonValues => ({
    name: person?.name ?? initialName ?? "",
    jobTitle: person?.jobTitle ?? "",
    email: person?.email ?? "",
    phone: person?.phone ?? "",
    organizationId:
      person?.organizationId != null ? String(person.organizationId) : "",
  });

  const form = useForm<PersonValues>({
    resolver: zodResolver(personSchema(t)),
    defaultValues: defaults(),
  });

  useEffect(() => {
    if (open) {
      form.reset(defaults());
      setOrgLabel(person?.organizationName ?? null);
      setLabels(person?.labels ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = async (data: PersonValues) => {
    const orgId = data.organizationId ? Number(data.organizationId) : null;
    try {
      if (isEdit && person) {
        await updatePerson.mutateAsync({
          id: person.id,
          data: {
            name: data.name,
            jobTitle: data.jobTitle?.trim() || null,
            email: data.email || null,
            phone: data.phone || null,
            organizationId: orgId,
            labels: labels.length ? labels : null,
          },
        });
        toast({ title: t("contacts.personUpdated") });
      } else {
        const created = await createPerson.mutateAsync({
          data: {
            name: data.name,
            jobTitle: data.jobTitle?.trim() || undefined,
            email: data.email || undefined,
            phone: data.phone || undefined,
            organizationId: orgId ?? undefined,
            labels: labels.length ? labels : undefined,
          },
        });
        toast({ title: t("contacts.personCreated") });
        onCreated?.(created);
      }
      queryClient.invalidateQueries({ queryKey: getListPersonsQueryKey() });
      // The contacts grids read from the hand-written /search endpoints, whose
      // cache keys differ from the generated hooks' — invalidate those too so
      // the visible table reflects the save. Organizations are included because
      // a person's org assignment changes that org's contact count.
      queryClient.invalidateQueries({ queryKey: ["persons", "search"] });
      queryClient.invalidateQueries({ queryKey: ["organizations", "search"] });
      setOpen(false);
      if (!isEdit) form.reset(defaults());
    } catch (e) {
      toast({
        title: isEdit ? t("contacts.personUpdateFailed") : t("contacts.personCreateFailed"),
        variant: "destructive",
      });
    }
  };

  const pending = createPerson.isPending || updatePerson.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("contacts.editPersonTitle") : t("contacts.addPersonTitle")}</DialogTitle>
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
              name="jobTitle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("common.jobTitle")}{" "}
                    <span className="font-normal text-subtle">
                      ({t("common.optional")})
                    </span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("contacts.jobTitlePlaceholder")}
                      {...field}
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
                    <Input type="email" {...field} />
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
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="organizationId"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>{t("common.organization")}</FormLabel>
                  <AsyncSelect
                    value={field.value || ""}
                    valueLabel={orgLabel}
                    allValue=""
                    allLabel={t("deals.create.noOrg")}
                    placeholder={t("common.searchOrganizations")}
                    loadOptions={loadOrganizationOptions}
                    minChars={1}
                    inModal
                    onChange={(v, label) => {
                      field.onChange(v ?? "");
                      setOrgLabel(label);
                    }}
                    triggerClassName="w-full"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">{t("deals.field.labels")}</div>
              <LabelsEditor
                entity="person"
                labels={labels}
                onChange={setLabels}
                inModal
              />
            </div>
            <Button
              type="submit"
              disabled={pending}
              className="w-full bg-primary text-primary-foreground hover:bg-primary-hover"
            >
              {pending ? t("contacts.savingDots") : t("common.save")}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
