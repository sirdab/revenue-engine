import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useLocation, Link } from "wouter";
import { useEffect } from "react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

// Sirdab Logo imported as requested
import logo from "@/assets/brand/sirdab-logo.webp";
import { Button } from "@/components/ui/button";
import { useI18n, type Translate } from "@/lib/i18n/i18n";

// Built per render with `t` so the validation messages follow the language.
const loginSchema = (t: Translate) =>
  z.object({
    email: z.string().email({ message: t("auth.validation.email") }),
    password: z.string().min(8, { message: t("auth.validation.passwordMin") }),
    rememberMe: z.boolean().default(false),
  });

type LoginFormValues = z.infer<ReturnType<typeof loginSchema>>;

export default function LoginPage() {
  const { t } = useI18n();
  const [showPassword, setShowPassword] = useState(false);
  const { login, isLoggingIn, user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      setLocation("/home");
    }
  }, [user, setLocation]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema(t)),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  async function onSubmit(data: LoginFormValues) {
    try {
      await login({ email: data.email, password: data.password });
      toast({
        title: t("auth.login.welcomeTitle"),
        description: t("auth.login.welcomeBody"),
      });
    } catch (err: any) {
      toast({
        title: t("auth.login.failedTitle"),
        description: err?.message || t("auth.login.invalidCredentials"),
        variant: "destructive"
      });
    }
  }

  return (
    // Fixed to the viewport (no page scroll): the brand image always fills
    // its panel edge-to-edge, and only the form column scrolls when the
    // window is short.
    <div className="h-[100dvh] w-full flex overflow-hidden bg-background">
      {/* Left side: Visual / Brand panel (hidden on smaller screens) */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-surface-whisper items-center justify-center overflow-hidden border-e">
        <div className="absolute inset-0 z-0">
          <img 
            src="/side-bg.png" 
            alt="Logistics background" 
            className="w-full h-full object-cover"
            onError={(e) => {
              // Fallback if image fails to load
              (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiNmMThmYWZjIi8+PC9zdmc+';
            }}
          />
          {/* A subtle overlay to ensure it feels deep and sophisticated */}
          <div className="absolute inset-0 bg-gradient-to-br from-brand-900/10 to-gray-900/20 mix-blend-multiply" />
        </div>
        
        {/* Optional text or graphic overlay could go here */}
      </div>

      {/* Right side: Login Form */}
      <div className="flex-1 flex flex-col overflow-y-auto overscroll-contain px-6 py-12 lg:px-16 xl:px-24">
        {/* my-auto centers vertically when there's room but, unlike
            justify-center on the scroll container, never clips the top
            when the window is shorter than the form. */}
        <div className="w-full max-w-[400px] mx-auto my-auto flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-700">
          
          <div className="mb-10">
            <img 
              src={logo} 
              alt="Sirdab" 
              className="h-8 w-auto mb-8" 
              onError={(e) => {
                // Fallback to text if logo fails to load for any reason during preview
                e.currentTarget.style.display = 'none';
                const sibling = e.currentTarget.nextElementSibling;
                if (sibling) (sibling as HTMLElement).style.display = 'block';
              }}
            />
            {/* Hidden fallback text in case image fails */}
            <div className="hidden text-2xl font-heading font-bold text-primary mb-8 tracking-tight">Sirdab</div>

            <h1 className="text-3xl font-heading font-semibold text-foreground tracking-tight mb-2">
              {t("auth.login.title")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("auth.login.subtitle")}
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground font-medium">{t("auth.workEmail")}</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="name@company.com" 
                        type="email" 
                        autoComplete="email"
                        autoFocus
                        className="h-12 bg-card px-4 border-border transition-colors focus-visible:ring-primary/20 focus-visible:border-primary"
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
                    <FormLabel className="text-foreground font-medium">{t("common.password")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input 
                          placeholder="••••••••" 
                          type={showPassword ? "text" : "password"} 
                          autoComplete="current-password"
                          className="h-12 bg-card px-4 pe-10 border-border transition-colors focus-visible:ring-primary/20 focus-visible:border-primary"
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

              <div className="flex items-center justify-between">
                <FormField
                  control={form.control}
                  name="rememberMe"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormControl>
                        <Checkbox 
                          checked={field.value} 
                          onCheckedChange={field.onChange} 
                          className="border-input data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-sm font-medium text-muted-foreground cursor-pointer">
                          {t("auth.rememberMe")}
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
                
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  {t("auth.forgotPassword")}
                </Link>
              </div>

              <Button 
                type="submit" 
                className="w-full h-12 text-base font-medium shadow-sm hover:shadow transition-all bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={isLoggingIn}
              >
                {isLoggingIn ? (
                  <>
                    <Loader2 className="me-2 h-5 w-5 animate-spin" />
                    {t("auth.signingIn")}
                  </>
                ) : (
                  t("common.signIn")
                )}
              </Button>
            </form>
          </Form>

        </div>
      </div>
    </div>
  );
}
