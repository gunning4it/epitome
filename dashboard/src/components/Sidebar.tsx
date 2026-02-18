import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  User,
  Table2,
  Brain,
  Network,
  ShieldCheck,
  Activity,
  Bot,
  CreditCard,
  Settings,
  LogOut,
  Menu,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/hooks/useApi';
import { authApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/profile', label: 'Profile', icon: User },
  { path: '/tables', label: 'Tables', icon: Table2 },
  { path: '/memories', label: 'Memories', icon: Brain },
  { path: '/graph', label: 'Knowledge Graph', icon: Network },
  { path: '/review', label: 'Review', icon: ShieldCheck },
  { path: '/activity', label: 'Activity', icon: Activity },
  { path: '/agents', label: 'Agents', icon: Bot },
  { path: '/billing', label: 'Billing', icon: CreditCard },
  { path: '/settings', label: 'Settings', icon: Settings },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Sign out locally even if API call fails
    }
    queryClient.clear();
    navigate('/');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="px-6 py-5">
        <span className="text-lg font-semibold text-foreground tracking-tight">
          Epitome
        </span>
      </div>
      <Separator className="bg-sidebar-border" />

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'text-primary bg-sidebar-accent border-l-2 border-primary font-medium'
                  : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <Separator className="bg-sidebar-border" />
      <div className="px-4 py-4">
        <div className="text-sm text-muted-foreground truncate mb-2">
          {session?.email || ''}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-muted-foreground hover:text-foreground gap-2 px-0"
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile: Sheet overlay */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden fixed top-4 left-4 z-40"
          >
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Desktop: Fixed sidebar */}
      <aside className="hidden lg:block w-64 bg-sidebar border-r border-sidebar-border h-screen shrink-0">
        <SidebarNav />
      </aside>
    </>
  );
}
