import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Products from "./pages/Products";
import Marketplaces from "./pages/Marketplaces";
import Export from "./pages/Export";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import AgentMonitor from "./pages/AgentMonitor";
import MlAccounts from "./pages/MlAccounts";
import MlPublish from "./pages/MlPublish";
import Login from "./pages/Login";

function DashboardRouter() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/products" component={Products} />
        <Route path="/marketplaces" component={Marketplaces} />
        <Route path="/export" component={Export} />
        <Route path="/logs" component={Logs} />
        <Route path="/settings" component={Settings} />
        <Route path="/agent" component={AgentMonitor} />
        <Route path="/ml-accounts" component={MlAccounts} />
        <Route path="/ml-publish" component={MlPublish} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Switch>
            <Route path="/login" component={Login} />
            <Route component={DashboardRouter} />
          </Switch>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
