import React, { createContext, useContext, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCurrentUser, getGetCurrentUserQueryKey, getGetCurrentUserQueryOptions, useLogin, useLogout } from "@workspace/api-client-react";
import type { User, LoginInput } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (data: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  isLoggingIn: boolean;
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
  const logoutMutation = useLogout();

  const login = async (data: LoginInput) => {
    await loginMutation.mutateAsync({ data });
    // Drop any cached data from a previous user's session in this tab
    // (e.g. creator-private drafts cached under non-user-scoped keys).
    queryClient.clear();
    // clear() removes the current-user query entirely, so invalidateQueries
    // would be a no-op; fetchQuery (with the generated queryFn) guarantees a
    // fresh fetch that the useGetCurrentUser hook then picks up from cache.
    await queryClient.fetchQuery(getGetCurrentUserQueryOptions());
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
    // Wipe the whole cache so a subsequent same-tab login as a different
    // user can't render this user's private drafts from cache.
    queryClient.clear();
    // Re-seed the current-user key so the auth context immediately reflects
    // the logged-out state without a loading flash.
    queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
    setLocation("/");
  };

  const isLoading = isUserLoading;

  return (
    <AuthContext.Provider value={{ 
      user: user || null, 
      isLoading, 
      login, 
      logout,
      isLoggingIn: loginMutation.isPending
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
