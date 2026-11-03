import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, MailCheck } from "lucide-react";
import { Link } from "wouter";

import { useForgotPassword } from "@workspace/api-client-react";
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
import { AuthShell } from "@/components/auth/auth-shell";
import { useI18n, type Translate } from "@/lib/i18n/i18n";

const schema = (t: Translate) =>
  z.object({
    email: z.string().email({ message: t("auth.validation.email") }),
  });

type Values = z.infer<ReturnType<typeof schema>>;

export default function ForgotPasswordPage() {
  const { t, tNode } = useI18n();
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const forgot = useForgotPassword();

  const form = useForm<Values>({
    resolver: zodResolver(schema(t)),
    defaultValues: { email: "" },
  });

  async function onSubmit(data: Values) {
    try {
      await forgot.mutateAsync({ data: { email: data.email } });
    } catch {
      // The endpoint is intentionally generic — never reveal whether the
      // account exists, so we show the same confirmation regardless.
    } finally {
      setSubmittedEmail(data.email);
    }
  }

  if (submittedEmail) {
    return (
      <AuthShell
        title={t("auth.forgot.checkEmail")}
        subtitle={
          tNode("auth.forgot.sentBody", {
            email: (
              <span className="font-medium text-foreground">{submittedEmail}</span>
            ),
          })
        }
        footer={
          <Link
            href="/"
            className="font-medium text-primary hover:text-primary/80 transition-colors"
          >
            {t("auth.backToSignIn")}
          </Link>
        }
      >
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          <MailCheck className="h-5 w-5 shrink-0 text-primary" />
          <span>
            {t("auth.forgot.noEmail")}
          </span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.resetPassword")}
      subtitle={t("auth.forgot.subtitle")}
      footer={
        <Link
          href="/"
          className="font-medium text-primary hover:text-primary/80 transition-colors"
        >
          {t("auth.backToSignIn")}
        </Link>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-medium">
                  {t("auth.workEmail")}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="name@company.com"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    className="h-12 bg-card px-4 border-slate-200 transition-colors focus-visible:ring-primary/20 focus-visible:border-primary"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            className="w-full h-12 text-base font-medium shadow-sm hover:shadow transition-all bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={forgot.isPending}
          >
            {forgot.isPending ? (
              <>
                <Loader2 className="me-2 h-5 w-5 animate-spin" />
                {t("auth.forgot.sending")}
              </>
            ) : (
              t("auth.forgot.send")
            )}
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
