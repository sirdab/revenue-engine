import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Link, useLocation } from "wouter";

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
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";
import { useI18n, type Translate } from "@/lib/i18n/i18n";

// Creating a workspace: its name plus the first user, who becomes its admin.
// The server sets the session cookie on success, so the person lands in the
// app exactly as they would after signing in. The password rules mirror the
// server's validatePasswordStrength so a weak one is caught here first.
const signupSchema = (t: Translate) =>
  z.object({
    workspaceName: z
      .string()
      .trim()
      .min(1, { message: t("auth.signup.workspaceRequired") })
      .max(120),
    name: z
      .string()
      .trim()
      .min(1, { message: t("auth.signup.nameRequired") })
      .max(120),
    email: z.string().email({ message: t("auth.validation.email") }),
    password: z
      .string()
      .min(8, { message: t("auth.validation.passwordMin") })
      .regex(/[a-zA-Z]/, { message: t("auth.validation.letter") })
      .regex(/[0-9]/, { message: t("auth.validation.number") }),
  });

type SignupFormValues = z.infer<ReturnType<typeof signupSchema>>;

const inputClass =
  "h-12 bg-card px-4 border-input transition-colors focus-visible:ring-primary/20 focus-visible:border-primary";

export default function SignupPage() {
  const { t, locale } = useI18n();
  const { signup, isSigningUp, user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (user) setLocation("/home");
  }, [user, setLocation]);

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema(t)),
    defaultValues: { workspaceName: "", name: "", email: "", password: "" },
  });

  async function onSubmit(data: SignupFormValues) {
    try {
      // The page's language and the browser's zone seed the new workspace's
      // pipeline names and regional settings (changeable in Settings).
      let timezone: string | undefined;
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      } catch {
        timezone = undefined;
      }
      await signup({ ...data, locale, timezone });
      toast({ title: t("auth.signup.welcomeTitle", { workspace: data.workspaceName }) });
    } catch (err) {
      const status = (err as { status?: unknown } | null)?.status;
      if (status === 409) {
        form.setError("email", { message: t("auth.signup.emailTaken") });
        return;
      }
      toast({
        title: t("auth.signup.failedTitle"),
        description: errorMessage(err),
        variant: "destructive",
      });
    }
  }

  return (
    <AuthShell
      title={t("auth.signup.title")}
      subtitle={t("auth.signup.subtitle")}
      footer={
        <p className="text-center text-muted-foreground">
          {t("auth.signup.haveAccount")}{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:text-primary/80 transition-colors"
          >
            {t("common.signIn")}
          </Link>
        </p>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="workspaceName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-medium">
                  {t("auth.signup.workspaceName")}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("auth.signup.workspacePlaceholder")}
                    autoComplete="organization"
                    autoFocus
                    className={inputClass}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-medium">
                  {t("auth.signup.yourName")}
                </FormLabel>
                <FormControl>
                  <Input autoComplete="name" className={inputClass} {...field} />
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
                <FormLabel className="text-foreground font-medium">
                  {t("auth.workEmail")}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="name@company.com"
                    type="email"
                    autoComplete="email"
                    className={inputClass}
                    {...field}
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
                <FormLabel className="text-foreground font-medium">
                  {t("common.password")}
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className={`${inputClass} pe-10`}
                      {...field}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                      className="absolute end-3 top-1/2 -translate-y-1/2 rounded-md text-subtle hover:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            size="touch"
            className="w-full"
            disabled={isSigningUp}
          >
            {isSigningUp ? (
              <>
                <Loader2 className="me-2 h-5 w-5 animate-spin" />
                {t("auth.signup.creating")}
              </>
            ) : (
              t("auth.signup.submit")
            )}
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
