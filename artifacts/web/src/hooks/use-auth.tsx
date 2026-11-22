import React, { createContext, useContext, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCurrentUser, getGetCurrentUserQueryKey, getGetCurrentUserQueryOptions, useLogin, useLogout, useSignup } from "@workspace/api-client-react";
import type { User, LoginInput, SignupInput } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { setDisplayDefaults } from "@/lib/format";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (data: LoginInput) => Promise<void>;
  /** Creates a workspace with its first (admin) user and signs them in. */
  signup: (data: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
  isLoggingIn: boolean;
  isSigningUp: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: user, isLoading: isUserLoading, error } = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      retry: false,
    }
  });

  const loginMutation = useLogin();
  const signupMutation = useSignup();
  const logoutMutation = useLogout();

  // After the server has set the session cookie (login or signup).
  const startSession = async () => {
    // Drop any cached data from a previous user's session in this tab
    // (e.g. creator-private drafts cached under non-user-scoped keys).
    queryClient.clear();
    // clear() removes the current-user query entirely, so invalidateQueries
    // would be a no-op; fetchQuery (with the generated queryFn) guarantees a
    // fresh fetch that the useGetCurrentUser hook then picks up from cache.
    await queryClient.fetchQuery(getGetCurrentUserQueryOptions());
  };

  const login = async (data: LoginInput) => {
    await loginMutation.mutateAsync({ data });
    await startSession();
  };

  const signup = async (data: SignupInput) => {
    await signupMutation.mutateAsync({ data });
    await startSession();
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
    // Wipe the whole cache so a subsequent same-tab login as a different
    // user can't render this user's private drafts from cache.
    queryClient.clear();
    // Re-seed the current-user key so the auth context immediately reflects
    // the logged-out state without a loading flash.
    queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
    setLocation("/login");
  };

  const isLoading = isUserLoading;

  // Written during render, before any child formats a date or an amount:
  // the app behind AuthGuard only renders once the user is known.
  if (user) {
    setDisplayDefaults({ currency: user.defaultCurrency, timeZone: user.timezoneName });
  }

  return (
    <AuthContext.Provider value={{ 
      user: user || null, 
      isLoading, 
      login, 
      signup,
      logout,
      isLoggingIn: loginMutation.isPending,
      isSigningUp: signupMutation.isPending,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
