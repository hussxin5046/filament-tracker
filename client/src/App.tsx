import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { HandheldShell } from '@/components/layout/HandheldShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, Loading } from '@/components/ui/Display';
import { ConfirmProvider } from '@/components/ui/Modal';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { FocusProvider } from '@/context/FocusContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { useWorkspace, WorkspaceProvider } from '@/context/WorkspaceContext';
import { handheldRemembered } from '@/lib/handheld';
import { ActivityPage } from '@/pages/ActivityPage';
import { AuthPage } from '@/pages/AuthPage';
import { NoticesPage, PrivacyPage, TermsPage } from '@/pages/LegalPages';
import { ConfirmEmailPage } from '@/pages/ConfirmEmailPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/PasswordResetPages';
import { InventoryPage } from '@/pages/InventoryPage';
import { HandheldHomePage, HandheldItemPage, HandheldLocationPage, HandheldLocationsPage } from '@/pages/HandheldPages';
import { JobsPage } from '@/pages/JobsPage';
import { LabelLinkPage } from '@/pages/LinkPages';
import { LocationsPage } from '@/pages/LocationsPage';
import { OverviewPage } from '@/pages/MachineOverviewPage';
import { MachinesPage } from '@/pages/MachinesPage';
import { MaintenancePage } from '@/pages/MaintenancePage';
import { NewWorkspacePage } from '@/pages/NewWorkspacePage';
import { ReorderPage } from '@/pages/ReorderPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SubmitRequestPage } from '@/pages/SubmitRequestPage';
import { TrackRequestPage } from '@/pages/TrackRequestPage';

function RequireAuth() {
  const { user, loading, error, retry } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user && error) {
    return (
      <EmptyState icon={WifiOff} title="Cannot reach the server" action={<Button variant="primary" onClick={retry}>Try again</Button>}>
        {error} You are still signed in.
      </EmptyState>
    );
  }
  // Remember where they were headed (a scanned label, a shared link) so signing in takes them there.
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <Outlet />;
}

function RequireWorkspace({ handheld = false }: { handheld?: boolean }) {
  const { workspace, loading, error, retry } = useWorkspace();
  if (loading) return <Loading label="Opening your workspace" />;
  if (!workspace && error) {
    return (
      <EmptyState icon={WifiOff} title="Cannot load your workspaces" action={<Button variant="primary" onClick={retry}>Try again</Button>}>
        {error}
      </EmptyState>
    );
  }
  if (!workspace) return <Navigate to="/new-workspace" replace />;
  // Keyed so that switching workspace resets every screen's local state.
  return (
    <FocusProvider key={workspace.id} workspaceId={workspace.id}>
      {handheld ? <HandheldShell /> : <AppShell />}
    </FocusProvider>
  );
}

/** A device set to handheld mode opens it, including from its home-screen icon, which always starts at "/". */
function HomePage() {
  return handheldRemembered() ? <Navigate to="/handheld" replace /> : <OverviewPage />;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <ThemeProvider>
            <WorkspaceProvider>
              <Routes>
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/register" element={<AuthPage mode="register" />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/notices" element={<NoticesPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/confirm-email" element={<ConfirmEmailPage />} />
                {/* Open to anyone holding the link: sending a job request and following its progress. */}
                <Route path="/submit/:token" element={<SubmitRequestPage />} />
                <Route path="/request/:token" element={<TrackRequestPage />} />
                <Route element={<RequireAuth />}>
                  <Route path="/new-workspace" element={<NewWorkspacePage />} />
                  {/* What a QR label or NFC sticker opens: /s/<item id> and /l/<location id>. */}
                  <Route path="/s/:id" element={<LabelLinkPage kind="item" />} />
                  <Route path="/l/:id" element={<LabelLinkPage kind="location" />} />
                  <Route element={<RequireWorkspace />}>
                    <Route index element={<HomePage />} />
                    <Route path="inventory" element={<InventoryPage />} />
                    <Route path="locations" element={<LocationsPage />} />
                    <Route path="locations/:id" element={<LocationsPage />} />
                    <Route path="machines" element={<MachinesPage />} />
                    <Route path="jobs" element={<JobsPage />} />
                    <Route path="maintenance" element={<MaintenancePage />} />
                    <Route path="reorder" element={<ReorderPage />} />
                    <Route path="activity" element={<ActivityPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    {/* Appearance used to be a page of its own; old links land in its Settings section. */}
                    <Route path="appearance" element={<Navigate to="/settings?tab=appearance" replace />} />
                  </Route>
                  {/* Handheld mode: scanning, items and locations only, for a mobile computer with a scanner built in. */}
                  <Route path="handheld" element={<RequireWorkspace handheld />}>
                    <Route index element={<HandheldHomePage />} />
                    <Route path="locations" element={<HandheldLocationsPage />} />
                    <Route path="item/:id" element={<HandheldItemPage />} />
                    <Route path="location/:id" element={<HandheldLocationPage />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </WorkspaceProvider>
            </ThemeProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
