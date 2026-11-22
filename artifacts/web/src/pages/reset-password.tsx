import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "wouter";

import {
  useResetPassword,
  useValidateResetToken,
  getValidateResetTokenQueryKey,
} from "@workspace/api-client-react";
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
import { useToast } from "@/hooks/use-toast";
import { AuthShell } from "@/components/auth/auth-shell";
import { useI18n, type Translate } from "@/lib/i18n/i18n";

const schema = (t: Translate) =>
  z
    .object({
      password: z
        .string()
        .min(8, { message: t("auth.validation.passwordMin") })
        .regex(/[a-zA-Z]/, { message: t("auth.validation.letter") })
        .regex(/[0-9]/, { message: t("auth.validation.number") }),
      confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: t("auth.validation.mismatch"),
      path: ["confirmPassword"],
    });

type Values = z.infer<ReturnType<typeof schema>>;

function getToken(): string {
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [token] = useState(getToken);
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);

  const reset = useResetPassword();
  const { data: validity, isLoading: validating } = useValidateResetToken(
    { token },
    {
      query: {
        queryKey: getValidateResetTokenQueryKey({ token }),
        enabled: token.length > 0,
        retry: false,
      },
    },
  );

  const form = useForm<Values>({
    resolver: zodResolver(schema(t)),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(data: Values) {
    try {
      await reset.mutateAsync({ data: { token, password: data.password } });
      setDone(true);
    } catch (err: any) {
      toast({
        title: t("auth.reset.failedTitle"),
        description:
          err?.message || t("auth.reset.expiredBody"),
        variant: "destructive",
      });
    }
  }

  // Success state
  if (done) {
    return (
      <AuthShell
        title={t("auth.reset.updatedTitle")}
        subtitle={t("auth.reset.updatedSubtitle")}
      >
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-body text-foreground mb-6">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
          <span>{t("auth.reset.allSet")}</span>
        </div>
        <Button
          asChild
          size="touch"
          className="w-full"
        >
          <Link href="/login">{t("auth.reset.continue")}</Link>
        </Button>
      </AuthShell>
    );
  }

  // Invalid / missing / expired token
  const invalid = !token || (!validating && validity?.valid === false);
  if (invalid) {
    return (
      <AuthShell
        title={t("auth.reset.linkExpired")}
        subtitle={t("auth.reset.linkExpiredSubtitle")}
        footer={
          <Link
            href="/login"
            className="font-medium text-primary hover:text-primary/80 transition-colors"
          >
            {t("auth.backToSignIn")}
          </Link>
        }
      >
        <div className="flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-body text-foreground mb-6">
          <XCircle className="h-5 w-5 shrink-0 text-destructive" />
          <span>{t("auth.reset.onceOnly")}</span>
        </div>
        <Button
          asChild
          size="touch"
          className="w-full"
        >
          <Link href="/forgot-password">{t("auth.reset.requestNew")}</Link>
        </Button>
      </AuthShell>
    );
  }

  // Still validating the token
  if (validating) {
    return (
      <AuthShell title={t("auth.resetPassword")}>
        <div className="flex items-center gap-2 text-muted-foreground text-body">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("auth.reset.verifying")}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.reset.chooseTitle")}
      subtitle={t("auth.reset.chooseSubtitle")}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-medium">
                  {t("auth.reset.newPassword")}
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      placeholder="••••••••"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      autoFocus
                      size="touch" inputClassName="pe-10"
                      {...field}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                      className="absolute end-3 top-1/2 -translate-y-1/2 rounded-md text-subtle hover:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-medium">
                  {t("auth.reset.confirmPassword")}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="••••••••"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    size="touch"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            size="touch"
                className="w-full"
            disabled={reset.isPending}
          >
            {reset.isPending ? (
              <>
                <Loader2 className="me-2 h-5 w-5 animate-spin" />
                {t("auth.reset.updating")}
              </>
            ) : (
              t("auth.reset.update")
            )}
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
