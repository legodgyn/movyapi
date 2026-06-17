import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { getCurrentUser, hasToken } from "./lib/auth";
import { firstAllowedPath, hasPermission } from "./lib/localUsers";
import { AdminUsers } from "./pages/AdminUsers";
import { AdminUsersV1 } from "./pages/AdminUsersV1";
import { Analytics } from "./pages/Analytics";
import { ApiManager } from "./pages/ApiManager";
import { BmSettings } from "./pages/BmSettings";
import { Broadcast } from "./pages/Broadcast";
import { Campaigns } from "./pages/Campaigns";
import { CloudTemplates } from "./pages/CloudTemplates";
import { Contacts } from "./pages/Contacts";
import { EmbeddedSignup } from "./pages/EmbeddedSignup";
import { Flows } from "./pages/Flows";
import { ListTools } from "./pages/ListTools";
import { Login } from "./pages/Login";
import { Media } from "./pages/Media";
import { MetaTemplates } from "./pages/MetaTemplates";
import { RegisteredSenders } from "./pages/RegisteredSenders";
import { Security } from "./pages/Security";
import { SenderRegistration } from "./pages/SenderRegistration";
import { SenderWabas } from "./pages/SenderWabas";
import { TemplateCreator } from "./pages/TemplateCreator";
import { VirtualNumbers } from "./pages/VirtualNumbers";

function Protected() {
  const { pathname } = useLocation();
  if (!hasToken()) return <Navigate to="/auth" replace />;
  const user = getCurrentUser();
  if (user && !hasPermission(user, pathname)) return <Navigate to={firstAllowedPath(user)} replace />;
  return <AppShell />;
}

function AuthGate() {
  const user = getCurrentUser();
  if (hasToken()) return <Navigate to={firstAllowedPath(user)} replace />;
  return <Login />;
}

export function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthGate />} />
      <Route element={<Protected />}>
        <Route path="/" element={<TemplateCreator />} />
        <Route path="/broadcast" element={<Broadcast mode="simple" />} />
        <Route path="/broadcast-random" element={<Broadcast mode="random" />} />
        <Route path="/contatos" element={<Contacts />} />
        <Route path="/flows" element={<Flows />} />
        <Route path="/media" element={<Media />} />
        <Route path="/transmission-analytics" element={<Analytics />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/bm-settings" element={<BmSettings />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/meta-templates" element={<MetaTemplates />} />
        <Route path="/list-cleaner" element={<ListTools mode="process" />} />
        <Route path="/retries" element={<ListTools mode="retry" />} />
        <Route path="/cloud-templates" element={<CloudTemplates />} />
        <Route path="/embedded-signup" element={<EmbeddedSignup />} />
        <Route path="/admin/handle-manager" element={<ApiManager />} />
        <Route path="/admin/analytics" element={<Analytics />} />
        <Route path="/admin/v1/sender-wabas" element={<SenderWabas />} />
        <Route path="/admin/sender-registration" element={<SenderRegistration />} />
        <Route path="/admin/registered-senders" element={<RegisteredSenders />} />
        <Route path="/admin/virtual-numbers" element={<VirtualNumbers />} />
        <Route path="/transmissoes" element={<Broadcast mode="simple" />} />
        <Route path="/admin/v1/users" element={<AdminUsersV1 />} />
        <Route path="/admin/v1/security" element={<Security />} />
      </Route>
      <Route path="*" element={<Navigate to={hasToken() ? "/" : "/auth"} replace />} />
    </Routes>
  );
}
