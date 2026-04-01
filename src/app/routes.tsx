import { createBrowserRouter } from "react-router";
import { InvoiceGeneratorPage } from "./App";
import InvoiceManagement from "./pages/InvoiceManagement";
import ItemManagement from "./pages/ItemManagement";
import ClientManagement from "./pages/ClientManagement";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import { ProtectedRoute } from "./components/ProtectedRoute";

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: Login,
  },
  {
    path: "/auth/callback",
    Component: AuthCallback,
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <InvoiceGeneratorPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/invoices",
    element: (
      <ProtectedRoute>
        <InvoiceManagement />
      </ProtectedRoute>
    ),
  },
  {
    path: "/items",
    element: (
      <ProtectedRoute>
        <ItemManagement />
      </ProtectedRoute>
    ),
  },
  {
    path: "/clients",
    element: (
      <ProtectedRoute>
        <ClientManagement />
      </ProtectedRoute>
    ),
  },
]);